/**
 * Google Photosアルバム作成用CLIスクリプト。
 *
 * 使い方:
 *   npm run create-album -- "アルバム名"
 *
 * 事前に .env の GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN
 * が設定されている必要がある（get-refresh-token を先に実行すること）。
 *
 * 注: Google Photos APIの制約上、batchCreateでアルバムに追加できるのは
 * 「このアプリ自身が作成したアルバム」のみ。既存アルバムのIDは使えないため、
 * 必ずこのスクリプトでアルバムを作成すること。
 */
import "dotenv/config";
import { createOAuth2Client } from "../googlePhotos/client.js";
import { createAlbum } from "../googlePhotos/uploader.js";

async function main() {
  const title = process.argv[2];
  if (!title) {
    console.error('使い方: npm run create-album -- "アルバム名"');
    process.exit(1);
  }

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } =
    process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    console.error(
      ".env に GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN を設定してください。",
    );
    console.error("(refresh tokenは npm run get-refresh-token で取得できます)");
    process.exit(1);
  }

  const client = createOAuth2Client({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    refreshToken: GOOGLE_REFRESH_TOKEN,
  });

  const album = await createAlbum(client, title);

  console.log("\n=== アルバム作成成功 ===");
  console.log(`タイトル: ${album.title}`);
  if (album.productUrl) console.log(`URL: ${album.productUrl}`);
  console.log("\n以下の値を .env の GOOGLE_PHOTOS_ALBUM_ID に設定してください:\n");
  console.log(album.id);
}

main().catch((error) => {
  console.error("エラー:", error instanceof Error ? error.message : error);
  process.exit(1);
});
