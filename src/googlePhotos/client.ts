import { google } from "googleapis";

// googleapisが内部で使うgoogle-auth-libraryのコピーと型を一致させるため、
// 実際に生成するインスタンスの型から導出する
export type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export const PHOTOS_SCOPE =
  "https://www.googleapis.com/auth/photoslibrary.appendonly";

export const PHOTOS_API_BASE = "https://photoslibrary.googleapis.com/v1";

export interface GoogleAuthOptions {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  redirectUri?: string;
}

/**
 * OAuth2クライアントを生成する。refreshTokenを渡した場合、
 * アクセストークンの自動更新は googleapis ライブラリ側が行う。
 */
export function createOAuth2Client(options: GoogleAuthOptions): OAuth2Client {
  const client = new google.auth.OAuth2(
    options.clientId,
    options.clientSecret,
    options.redirectUri,
  );
  if (options.refreshToken) {
    client.setCredentials({ refresh_token: options.refreshToken });
  }
  return client;
}

/** 現在有効なアクセストークンを取得する（期限切れなら自動リフレッシュされる）。 */
export async function getAccessToken(client: OAuth2Client): Promise<string> {
  const { token } = await client.getAccessToken();
  if (!token) {
    throw new Error("Failed to obtain Google access token");
  }
  return token;
}
