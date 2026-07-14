import type { Message } from "discord.js";
import { logger } from "../utils/logger.js";

/**
 * メッセージにリアクションを付与する。
 * リアクション失敗（権限不足・絵文字不正など）でプロセスを落とさないよう
 * ここで捕捉してログのみ残す。
 */
export async function react(message: Message, emoji: string): Promise<void> {
  try {
    await message.react(emoji);
  } catch (error) {
    logger.error("Failed to add reaction", {
      messageId: message.id,
      channelId: message.channelId,
      emoji,
      error,
    });
  }
}
