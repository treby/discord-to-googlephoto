import type { Attachment, Message } from "discord.js";
import exifr from "exifr";
import type { OAuth2Client } from "../googlePhotos/client.js";
import type { Config } from "../config.js";
import { uploadMediaToAlbum } from "../googlePhotos/uploader.js";
import { react } from "./reactions.js";
import { logger } from "../utils/logger.js";

const SUPPORTED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
] as const;

/** Google Photos APIのuploadMedia制約として200MBを超える添付はスキップ(エラー扱い) */
const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;

interface MediaAttachment {
  attachment: Attachment;
  /** "image/png; charset=..." 形式から主要部のみ取り出した値 */
  contentType: string;
}

function toMediaAttachment(attachment: Attachment): MediaAttachment | null {
  const type = attachment.contentType?.split(";")[0]?.trim().toLowerCase();
  if (!type || !(SUPPORTED_CONTENT_TYPES as readonly string[]).includes(type)) {
    return null;
  }
  return { attachment, contentType: type };
}

async function downloadAttachment(attachment: Attachment): Promise<Buffer> {
  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(
      `Failed to download attachment: HTTP ${response.status} (${attachment.url})`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * 画像のEXIFから撮影日時を取り出す。EXIFを持たない画像・動画・解析失敗時はnull。
 */
async function extractCaptureDate(
  data: Buffer,
  contentType: string,
): Promise<Date | null> {
  if (!contentType.startsWith("image/")) return null;
  try {
    const exif = await exifr.parse(data, ["DateTimeOriginal", "CreateDate"]);
    const date: unknown = exif?.DateTimeOriginal ?? exif?.CreateDate;
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  } catch {
    return null;
  }
}

/**
 * 例: "撮影者: treby / 撮影日時: 2026/07/14 23:15:00 / URL: https://discord.com/channels/..."
 * 撮影日時が取れない場合: "作成者: treby / URL: https://discord.com/channels/..."
 */
function buildDescription(message: Message, captureDate: Date | null): string {
  const displayName =
    message.member?.displayName ?? message.author.displayName;
  const authorLabel = captureDate ? "撮影者" : "作成者";
  const parts: string[] = [`${authorLabel}: ${displayName}`];
  if (captureDate) {
    const pad = (n: number) => String(n).padStart(2, "0");
    parts.push(
      `撮影日時: ${captureDate.getFullYear()}/${pad(captureDate.getMonth() + 1)}/${pad(captureDate.getDate())} ` +
        `${pad(captureDate.getHours())}:${pad(captureDate.getMinutes())}:${pad(captureDate.getSeconds())}`,
    );
  }
  parts.push(`URL: ${message.url}`);
  return parts.join(" / ");
}

async function processAttachment(
  auth: OAuth2Client,
  config: Config,
  message: Message,
  media: MediaAttachment,
): Promise<void> {
  const { attachment, contentType } = media;
  if (attachment.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `Attachment too large: ${attachment.size} bytes (max ${MAX_FILE_SIZE_BYTES})`,
    );
  }
  const data = await downloadAttachment(attachment);
  const captureDate = await extractCaptureDate(data, contentType);
  await uploadMediaToAlbum(auth, config.GOOGLE_PHOTOS_ALBUM_ID, {
    data,
    contentType,
    fileName: attachment.name,
    description: buildDescription(message, captureDate),
  });
}

/**
 * messageCreateイベントハンドラを生成する。
 * 例外はすべてここで捕捉し、gateway接続を維持する。
 */
export function createMessageListener(auth: OAuth2Client, config: Config) {
  return async (message: Message): Promise<void> => {
    try {
      if (message.channelId !== config.DISCORD_TARGET_CHANNEL_ID) return;
      if (message.author.bot) return;

      const media = [...message.attachments.values()]
        .map(toMediaAttachment)
        .filter((item): item is MediaAttachment => item !== null);
      if (media.length === 0) {
        logger.debug("No supported media attachments, skipping", {
          messageId: message.id,
        });
        return;
      }

      logger.info("Processing media attachments", {
        messageId: message.id,
        channelId: message.channelId,
        author: message.author.tag,
        count: media.length,
      });

      const results = await Promise.allSettled(
        media.map((item) => processAttachment(auth, config, message, item)),
      );

      let failureCount = 0;
      results.forEach((result, i) => {
        if (result.status === "rejected") {
          failureCount++;
          logger.error("Attachment upload failed", {
            messageId: message.id,
            channelId: message.channelId,
            fileName: media[i].attachment.name,
            error: result.reason,
          });
        }
      });

      if (failureCount === 0) {
        logger.info("All attachments uploaded successfully", {
          messageId: message.id,
          count: media.length,
        });
        await react(message, config.DISCORD_SUCCESS_EMOJI);
      } else {
        await react(message, config.DISCORD_ERROR_EMOJI);
      }
    } catch (error) {
      // ハンドラ内の想定外エラーでプロセスを落とさない
      logger.error("Unhandled error in message listener", {
        messageId: message.id,
        channelId: message.channelId,
        error,
      });
      await react(message, config.DISCORD_ERROR_EMOJI);
    }
  };
}
