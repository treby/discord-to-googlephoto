import { describe, expect, it, vi } from "vitest";
import type { Message } from "discord.js";
import { react } from "./reactions.js";

function fakeMessage(reactImpl: (emoji: string) => Promise<unknown>): Message {
  return {
    id: "msg-1",
    channelId: "chan-1",
    react: vi.fn(reactImpl),
  } as unknown as Message;
}

describe("react", () => {
  it("message.reactが成功→そのまま完了", async () => {
    const message = fakeMessage(async () => undefined);

    await expect(react(message, "✅")).resolves.toBeUndefined();
    expect(message.react).toHaveBeenCalledWith("✅");
  });

  it("message.reactが例外→捕捉されて例外が外へ伝播しない", async () => {
    const message = fakeMessage(async () => {
      throw new Error("Missing Permissions");
    });

    await expect(react(message, "❌")).resolves.toBeUndefined();
    expect(message.react).toHaveBeenCalledWith("❌");
  });
});
