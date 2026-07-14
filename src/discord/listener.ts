import type { Attachment, Message } from "discord.js";
import type { OAuth2Client } from "../googlePhotos/client.js";
import type { Config } from "../config.js";
import { uploadImageToAlbum } from "../googlePhotos/uploader.js";
import { react } from "./reactions.js";
import { logger } from "../utils/logger.js";

const SUPPORTED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

/** Google Photos API的にも現実的な上限として200MBを超える添付はスキップ(エラー扱い) */
const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;

interface ImageAttachment {
  attachment: Attachment;
  /** "image/png; charset=..." 形式から主要部のみ取り出した値 */
  contentType: string;
}

function toImageAttachment(attachment: Attachment): ImageAttachment | null {
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

async function processImage(
  auth: OAuth2Client,
  config: Config,
  message: Message,
  image: ImageAttachment,
): Promise<void> {
  const { attachment, contentType } = image;
  if (attachment.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `Attachment too large: ${attachment.size} bytes (max ${MAX_FILE_SIZE_BYTES})`,
    );
  }
  const data = await downloadAttachment(attachment);
  await uploadImageToAlbum(auth, config.GOOGLE_PHOTOS_ALBUM_ID, {
    data,
    contentType,
    fileName: attachment.name,
    description: `Discord: ${message.author.tag} / message ${message.id}`,
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

      const images = [...message.attachments.values()]
        .map(toImageAttachment)
        .filter((image): image is ImageAttachment => image !== null);
      if (images.length === 0) {
        logger.debug("No supported image attachments, skipping", {
          messageId: message.id,
        });
        return;
      }

      logger.info("Processing image attachments", {
        messageId: message.id,
        channelId: message.channelId,
        author: message.author.tag,
        count: images.length,
      });

      const results = await Promise.allSettled(
        images.map((image) => processImage(auth, config, message, image)),
      );

      let failureCount = 0;
      results.forEach((result, i) => {
        if (result.status === "rejected") {
          failureCount++;
          logger.error("Attachment upload failed", {
            messageId: message.id,
            channelId: message.channelId,
            fileName: images[i].attachment.name,
            error: result.reason,
          });
        }
      });

      if (failureCount === 0) {
        logger.info("All attachments uploaded successfully", {
          messageId: message.id,
          count: images.length,
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
