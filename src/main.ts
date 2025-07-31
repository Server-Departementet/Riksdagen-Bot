import { env } from "node:process";
// ENV guard
["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_QUOTE_CHANNEL_ID"].forEach((variableName) => {
  if (!env[variableName]) {
    console.error(`Error: Environment variable ${variableName} is not set.`);
    process.exit(1);
  }
});

import { Client, Events, GatewayIntentBits } from "discord.js";
import sql from "node:sqlite";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on(Events.ClientReady, async readyClient => {
  console.info(`Logged in as ${readyClient.user.tag}!`);
  await readQuotes();
});

client.login(env.DISCORD_BOT_TOKEN || "")
  .then(() => console.log("Bot is online!"))
  .catch(error => console.error("Failed to log in:", error));


async function readQuotes() {
  const channel = await client.channels.fetch(env.DISCORD_QUOTE_CHANNEL_ID || "SOMETHING_WENT_WRONG");
  if (!channel || !channel.isTextBased()) {
    console.error("Failed to fetch the quote channel or it is not a text channel.");
    return;
  }
  const messages = await channel.messages.fetch({ limit: 100 });
  if (messages.size === 0) {
    console.log("No messages found in the quote channel.");
    return;
  }
  messages.forEach(message => {
    if (message.author.bot) return; // Skip bot messages
    console.log(`Quote from ${message.author.tag}: ${message.content}`);
  });
  console.log(`Total quotes fetched: ${messages.size}`);
}