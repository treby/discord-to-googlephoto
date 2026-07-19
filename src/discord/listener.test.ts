import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment, Message } from "discord.js";
import type { OAuth2Client } from "../googlePhotos/client.js";
import type { Config } from "../config.js";

vi.mock("../googlePhotos/uploader.js", () => ({
  uploadMediaToAlbum: vi.fn(),
}));

import { uploadMediaToAlbum } from "../googlePhotos/uploader.js";
import {
  buildDescription,
  createMessageListener,
  extractCaptureDate,
  toMediaAttachment,
} from "./listener.js";

const uploadMediaToAlbumMock = vi.mocked(uploadMediaToAlbum);

const fakeAuth = {
  getAccessToken: async () => ({ token: "fake-token" }),
} as unknown as OAuth2Client;

const config: Config = {
  DISCORD_BOT_TOKEN: "token",
  DISCORD_TARGET_CHANNEL_ID: "111",
  DISCORD_SUCCESS_EMOJI: "✅",
  DISCORD_ERROR_EMOJI: "❌",
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
  GOOGLE_REFRESH_TOKEN: "refresh",
  GOOGLE_PHOTOS_ALBUM_ID: "album-1",
};

function fakeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: "att-1",
    name: "photo.jpg",
    url: "https://cdn.discord.com/photo.jpg",
    contentType: "image/jpeg",
    size: 1024,
    ...overrides,
  } as unknown as Attachment;
}

function fakeMessage(
  overrides: {
    channelId?: string;
    authorBot?: boolean;
    attachments?: Attachment[];
    authorDisplayName?: string;
    memberDisplayName?: string | null;
    reactImpl?: (emoji: string) => Promise<unknown>;
  } = {},
): Message {
  const attachmentsMap = new Map(
    (overrides.attachments ?? []).map((a) => [a.id, a]),
  );
  return {
    id: "msg-1",
    channelId: overrides.channelId ?? "111",
    url: "https://discord.com/channels/1/111/msg-1",
    author: {
      bot: overrides.authorBot ?? false,
      tag: "user#0001",
      displayName: overrides.authorDisplayName ?? "AuthorDisplay",
    },
    member:
      overrides.memberDisplayName === null
        ? null
        : { displayName: overrides.memberDisplayName ?? "MemberDisplay" },
    attachments: attachmentsMap,
    react: vi.fn(overrides.reactImpl ?? (async () => undefined)),
  } as unknown as Message;
}

describe("toMediaAttachment", () => {
  const supportedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "video/mp4",
    "video/quicktime",
    "video/webm",
  ];

  it.each(supportedTypes)("対応タイプ %s が対象になる", (contentType) => {
    const attachment = fakeAttachment({ contentType });
    const result = toMediaAttachment(attachment);
    expect(result).not.toBeNull();
    expect(result?.contentType).toBe(contentType);
  });

  it('"image/png; charset=utf-8" のような形式でも対象になる', () => {
    const attachment = fakeAttachment({ contentType: "image/png; charset=utf-8" });
    const result = toMediaAttachment(attachment);
    expect(result).not.toBeNull();
    expect(result?.contentType).toBe("image/png");
  });

  it("非対応タイプはnull", () => {
    const attachment = fakeAttachment({ contentType: "application/pdf" });
    expect(toMediaAttachment(attachment)).toBeNull();
  });

  it("contentTypeがnullならnull", () => {
    const attachment = fakeAttachment({ contentType: null });
    expect(toMediaAttachment(attachment)).toBeNull();
  });
});

describe("buildDescription", () => {
  it("撮影日時ありの場合、撮影者/撮影日時/URLの形式になる", () => {
    const message = fakeMessage({ memberDisplayName: "たろう" });
    const captureDate = new Date(2026, 0, 5, 9, 5, 3); // 1月5日 9:05:03 (ローカル)

    const description = buildDescription(message, captureDate);

    expect(description).toBe(
      "撮影者: たろう / 撮影日時: 2026/01/05 09:05:03 / URL: https://discord.com/channels/1/111/msg-1",
    );
  });

  it("撮影日時なしの場合、作成者/URLの形式で「撮影日時:」を含まない", () => {
    const message = fakeMessage({ memberDisplayName: "たろう" });

    const description = buildDescription(message, null);

    expect(description).toBe(
      "作成者: たろう / URL: https://discord.com/channels/1/111/msg-1",
    );
    expect(description).not.toContain("撮影日時:");
  });

  it("表示名はmember.displayName優先", () => {
    const message = fakeMessage({
      memberDisplayName: "メンバー表示名",
      authorDisplayName: "作者表示名",
    });

    const description = buildDescription(message, null);

    expect(description).toContain("メンバー表示名");
    expect(description).not.toContain("作者表示名");
  });

  it("memberがない場合はauthor.displayNameを使う", () => {
    const message = fakeMessage({
      memberDisplayName: null,
      authorDisplayName: "作者表示名",
    });

    const description = buildDescription(message, null);

    expect(description).toContain("作者表示名");
  });
});

describe("extractCaptureDate", () => {
  const DATE_STR = "2026:07:14 23:15:00\0"; // 20 bytes

  function buildExifApp1(): Buffer {
    const tiff = Buffer.alloc(64);
    tiff.write("II", 0, "ascii");
    tiff.writeUInt16LE(0x002a, 2);
    tiff.writeUInt32LE(8, 4); // IFD0 offset
    tiff.writeUInt16LE(1, 8); // IFD0: 1 entry
    tiff.writeUInt16LE(0x8769, 10); // ExifIFDPointer
    tiff.writeUInt16LE(4, 12); // LONG
    tiff.writeUInt32LE(1, 14);
    tiff.writeUInt32LE(26, 18); // -> Exif IFD offset
    tiff.writeUInt32LE(0, 22);
    tiff.writeUInt16LE(1, 26); // ExifIFD: 1 entry
    tiff.writeUInt16LE(0x9003, 28); // DateTimeOriginal
    tiff.writeUInt16LE(2, 30); // ASCII
    tiff.writeUInt32LE(20, 32);
    tiff.writeUInt32LE(44, 36); // -> 文字列 offset
    tiff.writeUInt32LE(0, 40);
    tiff.write(DATE_STR, 44, "ascii");
    const exifHeader = Buffer.from("Exif\0\0", "ascii");
    const app1Len = Buffer.alloc(2);
    app1Len.writeUInt16BE(2 + exifHeader.length + tiff.length);
    return Buffer.concat([Buffer.from([0xff, 0xe1]), app1Len, exifHeader, tiff]);
  }

  // 1x1のEXIFなしJPEG(base64)
  const plainJpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==",
    "base64",
  );
  const exifJpeg = Buffer.concat([
    plainJpeg.subarray(0, 2),
    buildExifApp1(),
    plainJpeg.subarray(2),
  ]);

  it("EXIF付きJPEG → DateTimeOriginalのDateが返る", async () => {
    const date = await extractCaptureDate(exifJpeg, "image/jpeg");

    expect(date).not.toBeNull();
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(6); // 0始まり: 7月
    expect(date?.getDate()).toBe(14);
    expect(date?.getHours()).toBe(23);
    expect(date?.getMinutes()).toBe(15);
    expect(date?.getSeconds()).toBe(0);
  });

  it("EXIFなしJPEG → null (例外にならない)", async () => {
    const date = await extractCaptureDate(plainJpeg, "image/jpeg");
    expect(date).toBeNull();
  });

  it("video/mp4 → 解析せずnull", async () => {
    const date = await extractCaptureDate(Buffer.from("not a real video"), "video/mp4");
    expect(date).toBeNull();
  });
});

describe("createMessageListener", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    uploadMediaToAlbumMock.mockReset();
    fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("対象外チャンネルのメッセージ→何もしない", async () => {
    const handler = createMessageListener(fakeAuth, config);
    const message = fakeMessage({
      channelId: "999",
      attachments: [fakeAttachment()],
    });

    await handler(message);

    expect(uploadMediaToAlbumMock).not.toHaveBeenCalled();
    expect(message.react).not.toHaveBeenCalled();
  });

  it("Bot自身のメッセージ→何もしない", async () => {
    const handler = createMessageListener(fakeAuth, config);
    const message = fakeMessage({
      authorBot: true,
      attachments: [fakeAttachment()],
    });

    await handler(message);

    expect(uploadMediaToAlbumMock).not.toHaveBeenCalled();
    expect(message.react).not.toHaveBeenCalled();
  });

  it("添付なし→何もしない", async () => {
    const handler = createMessageListener(fakeAuth, config);
    const message = fakeMessage({ attachments: [] });

    await handler(message);

    expect(uploadMediaToAlbumMock).not.toHaveBeenCalled();
    expect(message.react).not.toHaveBeenCalled();
  });

  it("非対応添付のみ→何もしない", async () => {
    const handler = createMessageListener(fakeAuth, config);
    const message = fakeMessage({
      attachments: [fakeAttachment({ contentType: "application/pdf" })],
    });

    await handler(message);

    expect(uploadMediaToAlbumMock).not.toHaveBeenCalled();
    expect(message.react).not.toHaveBeenCalled();
  });

  it("対応添付あり・全成功→成功絵文字でreactが呼ばれる", async () => {
    uploadMediaToAlbumMock.mockResolvedValue(undefined);
    const handler = createMessageListener(fakeAuth, config);
    const message = fakeMessage({ attachments: [fakeAttachment()] });

    await handler(message);

    expect(uploadMediaToAlbumMock).toHaveBeenCalledTimes(1);
    expect(message.react).toHaveBeenCalledWith(config.DISCORD_SUCCESS_EMOJI);
  });

  it("一部失敗→失敗絵文字でreactが呼ばれる", async () => {
    uploadMediaToAlbumMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("upload failed"));
    const handler = createMessageListener(fakeAuth, config);
    const message = fakeMessage({
      attachments: [
        fakeAttachment({ id: "att-1", name: "a.jpg" }),
        fakeAttachment({ id: "att-2", name: "b.jpg" }),
      ],
    });

    await handler(message);

    expect(uploadMediaToAlbumMock).toHaveBeenCalledTimes(2);
    expect(message.react).toHaveBeenCalledWith(config.DISCORD_ERROR_EMOJI);
  });

  it("200MB超の添付→失敗扱い(ダウンロードのfetchは呼ばれない)", async () => {
    const handler = createMessageListener(fakeAuth, config);
    const message = fakeMessage({
      attachments: [fakeAttachment({ size: 300 * 1024 * 1024 })],
    });

    await handler(message);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadMediaToAlbumMock).not.toHaveBeenCalled();
    expect(message.react).toHaveBeenCalledWith(config.DISCORD_ERROR_EMOJI);
  });

  it("react自体が例外を投げてもハンドラ全体は例外を外に漏らさない", async () => {
    uploadMediaToAlbumMock.mockResolvedValue(undefined);
    const handler = createMessageListener(fakeAuth, config);
    const message = fakeMessage({
      attachments: [fakeAttachment()],
      reactImpl: async () => {
        throw new Error("Missing Permissions");
      },
    });

    await expect(handler(message)).resolves.toBeUndefined();
    expect(message.react).toHaveBeenCalled();
  });
});
