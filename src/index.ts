import { Client, Events, GatewayIntentBits } from "discord.js";
import { loadConfig } from "./config.js";
import { createOAuth2Client } from "./googlePhotos/client.js";
import { createMessageListener } from "./discord/listener.js";
import { logger } from "./utils/logger.js";

async function main() {
  const config = loadConfig();

  const googleAuth = createOAuth2Client({
    clientId: config.GOOGLE_CLIENT_ID,
    clientSecret: config.GOOGLE_CLIENT_SECRET,
    refreshToken: config.GOOGLE_REFRESH_TOKEN,
  });

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
    ],
  });

  client.once(Events.ClientReady, (readyClient) => {
    logger.info("Discord bot is ready", {
      user: readyClient.user.tag,
      targetChannelId: config.DISCORD_TARGET_CHANNEL_ID,
    });
  });

  client.on(Events.MessageCreate, createMessageListener(googleAuth, config));

  client.on(Events.Error, (error) => {
    logger.error("Discord client error", { error });
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection", { error: reason });
  });

  await client.login(config.DISCORD_BOT_TOKEN);
}

main().catch((error) => {
  logger.error("Fatal error during startup", { error });
  process.exit(1);
});
