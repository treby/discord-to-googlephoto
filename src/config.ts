import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1, "DISCORD_BOT_TOKEN is required"),
  DISCORD_TARGET_CHANNEL_ID: z
    .string()
    .regex(/^\d+$/, "DISCORD_TARGET_CHANNEL_ID must be a snowflake (numeric string)"),
  DISCORD_SUCCESS_EMOJI: z.string().min(1).default("✅"),
  DISCORD_ERROR_EMOJI: z.string().min(1).default("❌"),
  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
  GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET is required"),
  GOOGLE_REFRESH_TOKEN: z.string().min(1, "GOOGLE_REFRESH_TOKEN is required"),
  GOOGLE_PHOTOS_ALBUM_ID: z.string().min(1, "GOOGLE_PHOTOS_ALBUM_ID is required"),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(): Config {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`環境変数の設定が不正です。.env を確認してください:\n${issues}`);
  }
  return result.data;
}

/**
 * CLIスクリプト用: OAuthクライアント情報のみを検証して返す。
 * (get-refresh-token 実行時点では GOOGLE_REFRESH_TOKEN 等は未設定のため)
 */
export function loadGoogleClientCredentials(): {
  clientId: string;
  clientSecret: string;
} {
  const schema = envSchema.pick({
    GOOGLE_CLIENT_ID: true,
    GOOGLE_CLIENT_SECRET: true,
  });
  const result = schema.safeParse(process.env);
  if (!result.success) {
    throw new Error(
      ".env に GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を設定してください",
    );
  }
  return {
    clientId: result.data.GOOGLE_CLIENT_ID,
    clientSecret: result.data.GOOGLE_CLIENT_SECRET,
  };
}
