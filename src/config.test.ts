import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";

const VALID_ENV = {
  DISCORD_BOT_TOKEN: "test-bot-token",
  DISCORD_TARGET_CHANNEL_ID: "123456789012345678",
  GOOGLE_CLIENT_ID: "test-client-id",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  GOOGLE_REFRESH_TOKEN: "test-refresh-token",
  GOOGLE_PHOTOS_ALBUM_ID: "test-album-id",
} as const;

function stubEnv(overrides: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(overrides)) {
    vi.stubEnv(key, value as string);
  }
}

describe("loadConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("必須環境変数がすべて揃っていれば値を返す", () => {
    stubEnv(VALID_ENV);

    const config = loadConfig();

    expect(config.DISCORD_BOT_TOKEN).toBe(VALID_ENV.DISCORD_BOT_TOKEN);
    expect(config.DISCORD_TARGET_CHANNEL_ID).toBe(
      VALID_ENV.DISCORD_TARGET_CHANNEL_ID,
    );
    expect(config.GOOGLE_CLIENT_ID).toBe(VALID_ENV.GOOGLE_CLIENT_ID);
    expect(config.GOOGLE_CLIENT_SECRET).toBe(VALID_ENV.GOOGLE_CLIENT_SECRET);
    expect(config.GOOGLE_REFRESH_TOKEN).toBe(VALID_ENV.GOOGLE_REFRESH_TOKEN);
    expect(config.GOOGLE_PHOTOS_ALBUM_ID).toBe(VALID_ENV.GOOGLE_PHOTOS_ALBUM_ID);
  });

  it("必須変数が欠けている場合、欠けたキー名を含むエラーメッセージで例外になる", () => {
    stubEnv(VALID_ENV);
    vi.stubEnv("DISCORD_BOT_TOKEN", undefined);

    expect(() => loadConfig()).toThrowError(/DISCORD_BOT_TOKEN/);
  });

  it("DISCORD_SUCCESS_EMOJI / DISCORD_ERROR_EMOJI 未設定時にデフォルトが入る", () => {
    stubEnv(VALID_ENV);
    vi.stubEnv("DISCORD_SUCCESS_EMOJI", undefined);
    vi.stubEnv("DISCORD_ERROR_EMOJI", undefined);

    const config = loadConfig();

    expect(config.DISCORD_SUCCESS_EMOJI).toBe("✅");
    expect(config.DISCORD_ERROR_EMOJI).toBe("❌");
  });

  it("DISCORD_TARGET_CHANNEL_ID が数字列以外なら例外になる", () => {
    stubEnv({ ...VALID_ENV, DISCORD_TARGET_CHANNEL_ID: "not-a-number" });

    expect(() => loadConfig()).toThrowError(/DISCORD_TARGET_CHANNEL_ID/);
  });
});
