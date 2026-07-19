import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuth2Client } from "./client.js";
import { PHOTOS_API_BASE } from "./client.js";
import {
  createAlbum,
  createMediaItems,
  NonRetryableError,
  uploadBytes,
} from "./uploader.js";

const fakeAuth = {
  getAccessToken: async () => ({ token: "fake-token" }),
} as unknown as OAuth2Client;

function fakeResponse(options: {
  ok?: boolean;
  status?: number;
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
}): Response {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    text: options.text ?? (async () => ""),
    json: options.json ?? (async () => ({})),
  } as unknown as Response;
}

describe("uploader", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("uploadBytes", () => {
    it("成功時: レスポンスボディのテキストがuploadTokenとして返る", async () => {
      fetchMock.mockResolvedValueOnce(
        fakeResponse({ text: async () => "upload-token-123" }),
      );

      const result = await uploadBytes(
        fakeAuth,
        Buffer.from("hello"),
        "image/jpeg",
      );

      expect(result).toBe("upload-token-123");
    });

    it("送信リクエストに必要なヘッダーが付いている", async () => {
      fetchMock.mockResolvedValueOnce(
        fakeResponse({ text: async () => "token" }),
      );

      await uploadBytes(fakeAuth, Buffer.from("hello"), "image/png");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${PHOTOS_API_BASE}/uploads`);
      expect(init.headers["X-Goog-Upload-Protocol"]).toBe("raw");
      expect(init.headers["X-Goog-Upload-Content-Type"]).toBe("image/png");
      expect(init.headers["Authorization"]).toBe("Bearer fake-token");
      expect(Buffer.from(init.body)).toEqual(Buffer.from("hello"));
    });

    it("空ボディなら例外", async () => {
      fetchMock.mockResolvedValueOnce(fakeResponse({ text: async () => "" }));

      await expect(
        uploadBytes(fakeAuth, Buffer.from("hello"), "image/jpeg"),
      ).rejects.toThrowError(NonRetryableError);
    });
  });

  describe("リトライ制御 (photosPost経由)", () => {
    it("500系 → リトライされ、最大2回(計3試行)で成功すればその値が返る", async () => {
      vi.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce(
          fakeResponse({ ok: false, status: 500, text: async () => "err1" }),
        )
        .mockResolvedValueOnce(
          fakeResponse({ ok: false, status: 500, text: async () => "err2" }),
        )
        .mockResolvedValueOnce(
          fakeResponse({ text: async () => "final-token" }),
        );

      const promise = uploadBytes(fakeAuth, Buffer.from("data"), "image/jpeg");
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);

      await expect(promise).resolves.toBe("final-token");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("3試行すべて500なら例外", async () => {
      vi.useFakeTimers();
      fetchMock.mockResolvedValue(
        fakeResponse({ ok: false, status: 500, text: async () => "err" }),
      );

      const promise = uploadBytes(fakeAuth, Buffer.from("data"), "image/jpeg");
      const assertion = expect(promise).rejects.toThrowError();
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await assertion;

      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("429 → リトライされる", async () => {
      vi.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce(
          fakeResponse({ ok: false, status: 429, text: async () => "rate limited" }),
        )
        .mockResolvedValueOnce(
          fakeResponse({ text: async () => "final-token" }),
        );

      const promise = uploadBytes(fakeAuth, Buffer.from("data"), "image/jpeg");
      await vi.advanceTimersByTimeAsync(1000);

      await expect(promise).resolves.toBe("final-token");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("401 → リトライされず1回で即例外", async () => {
      fetchMock.mockResolvedValueOnce(
        fakeResponse({ ok: false, status: 401, text: async () => "unauthorized" }),
      );

      await expect(
        uploadBytes(fakeAuth, Buffer.from("data"), "image/jpeg"),
      ).rejects.toThrowError(NonRetryableError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("createMediaItems", () => {
    it("albumId と newMediaItems が正しいJSONで送られる", async () => {
      fetchMock.mockResolvedValueOnce(
        fakeResponse({ json: async () => ({ newMediaItemResults: [] }) }),
      );

      await createMediaItems(fakeAuth, "album-1", [
        { uploadToken: "tok-1", fileName: "a.jpg", description: "desc-1" },
      ]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${PHOTOS_API_BASE}/mediaItems:batchCreate`);
      const body = JSON.parse(init.body);
      expect(body.albumId).toBe("album-1");
      expect(body.newMediaItems).toEqual([
        {
          description: "desc-1",
          simpleMediaItem: { uploadToken: "tok-1", fileName: "a.jpg" },
        },
      ]);
    });

    it("newMediaItemResults に失敗ステータスが1件でもあれば例外", async () => {
      fetchMock.mockResolvedValueOnce(
        fakeResponse({
          json: async () => ({
            newMediaItemResults: [
              { uploadToken: "tok-1", status: { code: 0 } },
              {
                uploadToken: "tok-2",
                status: { code: 3, message: "invalid file" },
              },
            ],
          }),
        }),
      );

      await expect(
        createMediaItems(fakeAuth, "album-1", [
          { uploadToken: "tok-1", fileName: "a.jpg" },
          { uploadToken: "tok-2", fileName: "b.jpg" },
        ]),
      ).rejects.toThrowError(NonRetryableError);
    });

    it("全成功(status.code未設定 or 0)なら正常終了", async () => {
      fetchMock.mockResolvedValueOnce(
        fakeResponse({
          json: async () => ({
            newMediaItemResults: [
              { uploadToken: "tok-1" },
              { uploadToken: "tok-2", status: { code: 0 } },
            ],
          }),
        }),
      );

      await expect(
        createMediaItems(fakeAuth, "album-1", [
          { uploadToken: "tok-1", fileName: "a.jpg" },
          { uploadToken: "tok-2", fileName: "b.jpg" },
        ]),
      ).resolves.toBeUndefined();
    });

    it("itemsが空配列ならfetchを呼ばずに正常終了", async () => {
      await expect(
        createMediaItems(fakeAuth, "album-1", []),
      ).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("createAlbum", () => {
    it("タイトルがリクエストに含まれ、レスポンスのid/titleが返る", async () => {
      fetchMock.mockResolvedValueOnce(
        fakeResponse({
          json: async () => ({ id: "album-id-1", title: "My Album" }),
        }),
      );

      const result = await createAlbum(fakeAuth, "My Album");

      expect(result).toEqual({ id: "album-id-1", title: "My Album" });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${PHOTOS_API_BASE}/albums`);
      const body = JSON.parse(init.body);
      expect(body.album.title).toBe("My Album");
    });
  });
});
