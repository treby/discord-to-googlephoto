/**
 * 初回OAuth認可用CLIスクリプト。
 *
 * 使い方:
 *   1. .env に GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を設定
 *   2. npm run get-refresh-token
 *   3. 表示されたURLをブラウザで開き、Googleアカウントで認可
 *   4. localhostへ自動リダイレクトされ、コンソールに refresh_token が表示される
 *   5. 表示された値を .env の GOOGLE_REFRESH_TOKEN に転記する
 *
 * 注: Googleは旧来のOOB(コードコピペ)フローを廃止したため、
 * localhostのループバックリダイレクトで認可コードを受け取る方式を採用している。
 * デスクトップアプリ種別のOAuthクライアントであれば http://localhost:* への
 * リダイレクトは事前登録なしで許可される。
 */
import http from "node:http";
import { loadGoogleClientCredentials } from "../config.js";
import { createOAuth2Client, PHOTOS_SCOPE } from "../googlePhotos/client.js";

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

async function main() {
  const { clientId, clientSecret } = loadGoogleClientCredentials();
  const client = createOAuth2Client({
    clientId,
    clientSecret,
    redirectUri: REDIRECT_URI,
  });

  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    scope: [PHOTOS_SCOPE],
    // 既に認可済みでも必ずrefresh_tokenを再発行させる
    prompt: "consent",
  });

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", REDIRECT_URI);
      if (url.pathname !== "/oauth2callback") {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get("error");
      const authCode = url.searchParams.get("code");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (error || !authCode) {
        res.end("<h1>認可に失敗しました</h1><p>ターミナルを確認してください。</p>");
        server.close();
        reject(new Error(`Authorization failed: ${error ?? "no code returned"}`));
        return;
      }
      res.end("<h1>認可が完了しました</h1><p>このタブは閉じて構いません。</p>");
      server.close();
      resolve(authCode);
    });
    server.on("error", reject);
    server.listen(PORT, () => {
      console.log("以下のURLをブラウザで開き、Googleアカウントで認可してください:\n");
      console.log(authUrl);
      console.log(`\n(localhost:${PORT} で認可コードの受信を待機中...)`);
    });
  });

  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "refresh_tokenが返されませんでした。Googleアカウント設定でこのアプリのアクセス権を削除してから再実行してください。",
    );
  }

  console.log("\n=== 取得成功 ===");
  console.log("以下の値を .env の GOOGLE_REFRESH_TOKEN に設定してください:\n");
  console.log(tokens.refresh_token);
}

main().catch((error) => {
  console.error("エラー:", error instanceof Error ? error.message : error);
  process.exit(1);
});
