import {
  getAccessToken,
  PHOTOS_API_BASE,
  type OAuth2Client,
} from "./client.js";
import { logger } from "../utils/logger.js";

/** リトライ対象外として即失敗させるエラー（401など） */
export class NonRetryableError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "NonRetryableError";
  }
}

class RetryableError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "RetryableError";
  }
}

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 一時的なエラー(5xx/429)のみ最大2回まで指数バックオフでリトライする。
 * 認証エラー(401)等はNonRetryableErrorとして即座に投げる。
 */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (error instanceof NonRetryableError || attempt === MAX_RETRIES) {
        throw error;
      }
      const delay = BASE_DELAY_MS * 2 ** attempt;
      logger.warn(`${label} failed, retrying`, {
        attempt: attempt + 1,
        delayMs: delay,
        error,
      });
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Photos Library APIの「concurrent write request」クォータ対策として、
 * 書き込み系リクエスト(uploads/batchCreate/albums)を1件ずつ直列実行するグローバルキュー。
 * 添付が複数のメッセージや、複数メッセージがほぼ同時に届いた場合でも
 * 同時に複数の書き込みリクエストが飛ばないようにする。
 */
let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "(failed to read response body)";
  }
}

/**
 * Photos APIへのPOSTリクエスト共通処理。
 * アクセストークン取得(自動リフレッシュ込み)とHTTPエラーの分類、
 * 一時的エラーのリトライまでを担い、成功時のResponseを返す。
 */
async function photosPost(
  auth: OAuth2Client,
  options: {
    label: string;
    path: string;
    headers: Record<string, string>;
    body: string | Uint8Array;
  },
): Promise<Response> {
  return withRetry(options.label, () =>
    enqueueWrite(async () => {
      const token = await getAccessToken(auth);
      const response = await fetch(`${PHOTOS_API_BASE}${options.path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, ...options.headers },
        body: options.body,
      });
      if (!response.ok) {
        const message = `${options.label}: HTTP ${response.status} ${await readErrorBody(response)}`;
        if (response.status >= 500 || response.status === 429) {
          throw new RetryableError(message, response.status);
        }
        throw new NonRetryableError(message, response.status);
      }
      return response;
    }),
  );
}

/**
 * Step 1: バイナリをアップロードして uploadToken を得る。
 * https://photoslibrary.googleapis.com/v1/uploads
 */
export async function uploadBytes(
  auth: OAuth2Client,
  data: Buffer,
  contentType: string,
): Promise<string> {
  const response = await photosPost(auth, {
    label: "uploadBytes",
    path: "/uploads",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Goog-Upload-Content-Type": contentType,
      "X-Goog-Upload-Protocol": "raw",
    },
    body: new Uint8Array(data),
  });
  const uploadToken = await response.text();
  if (!uploadToken) {
    throw new NonRetryableError("uploadBytes: empty upload token returned");
  }
  return uploadToken;
}

export interface NewMediaItem {
  uploadToken: string;
  fileName: string;
  description?: string;
}

interface BatchCreateResponse {
  newMediaItemResults?: Array<{
    uploadToken: string;
    status?: { code?: number; message?: string };
    mediaItem?: { id: string; filename?: string };
  }>;
}

/**
 * Step 2: mediaItems.batchCreate でメディアアイテムを作成し、
 * 同時に指定アルバムへ追加する。
 * 一部アイテムの失敗もエラーとして扱う（呼び出し側でメッセージ単位の成否を判定するため）。
 */
export async function createMediaItems(
  auth: OAuth2Client,
  albumId: string,
  items: NewMediaItem[],
): Promise<void> {
  if (items.length === 0) return;

  const response = await photosPost(auth, {
    label: "batchCreate",
    path: "/mediaItems:batchCreate",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      albumId,
      newMediaItems: items.map((item) => ({
        description: item.description,
        simpleMediaItem: {
          uploadToken: item.uploadToken,
          fileName: item.fileName,
        },
      })),
    }),
  });
  const result = (await response.json()) as BatchCreateResponse;

  const failed = (result.newMediaItemResults ?? []).filter(
    // 成功時 status.code は 0 または未設定
    (r) => r.status?.code !== undefined && r.status.code !== 0,
  );
  if (failed.length > 0) {
    throw new NonRetryableError(
      `batchCreate: ${failed.length} item(s) failed: ` +
        failed.map((f) => f.status?.message ?? "unknown error").join("; "),
    );
  }
}

/**
 * 画像・動画1件をアップロードしてアルバムへ追加する（2ステップをまとめたヘルパー）。
 */
export async function uploadMediaToAlbum(
  auth: OAuth2Client,
  albumId: string,
  media: {
    data: Buffer;
    contentType: string;
    fileName: string;
    description?: string;
  },
): Promise<void> {
  const uploadToken = await uploadBytes(auth, media.data, media.contentType);
  await createMediaItems(auth, albumId, [
    {
      uploadToken,
      fileName: media.fileName,
      description: media.description,
    },
  ]);
}

/**
 * アルバムを新規作成してIDとタイトルを返す（scripts/createAlbum.ts から利用）。
 * photoslibrary.appendonly スコープで作成でき、本アプリが作成したアルバムのみ
 * batchCreate の albumId に指定できる。
 */
export async function createAlbum(
  auth: OAuth2Client,
  title: string,
): Promise<{ id: string; title: string; productUrl?: string }> {
  const response = await photosPost(auth, {
    label: "createAlbum",
    path: "/albums",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ album: { title } }),
  });
  return (await response.json()) as {
    id: string;
    title: string;
    productUrl?: string;
  };
}
