import { env } from "node:process";
// ENV guard
["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_QUOTE_CHANNEL_ID"].forEach((variableName) => {
  if (!env[variableName]) {
    console.error(`Error: Environment variable ${variableName} is not set.`);
    process.exit(1);
  }
});

import { Client, Events, GatewayIntentBits, Message as DiscordMessage } from "discord.js";
import type { Message as PrismaMessage } from "../prisma/generated/prisma/index.js";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { MessageKeys } from "./types.ts";

/** 
 * Discord
 */
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent] });

client.on(Events.ClientReady, async readyClient => {
  console.info(`Logged in as ${readyClient.user.tag}!`);
  await readQuotes();
});

client.login(env.DISCORD_BOT_TOKEN || "")
  .then(() => console.log("Bot is online!"))
  .catch(error => console.error("Failed to log in:", error));


async function readQuotes() {
  const cache = JSON.parse(readFileSync("./quotes.json", "utf-8")) as DiscordMessage[];
  const cacheDate = statSync("./quotes.json").mtime;
  const today = new Date();
  const cacheTime = 10 * 60 * 1000; // 10 minutes in milliseconds
  if (cache.length > 0 && (today.getTime() - cacheDate.getTime()) < cacheTime) {
    console.info("Using cached quotes from quotes.json");
    await writeQuotesToDB(cache);
    return;
  }

  const channel = await client.channels.fetch(env.DISCORD_QUOTE_CHANNEL_ID || "SOMETHING_WENT_WRONG");
  if (!channel || !channel.isTextBased()) {
    console.error("Failed to fetch the quote channel or it is not a text channel.");
    return;
  }

  const batchSize = 100;
  const buffer: DiscordMessage[] = [];
  let lastMessageId: string | null = null;
  let hasMoreMessages = true;
  let hardLimitCount = 0;
  while (hasMoreMessages) {
    if (hardLimitCount >= 10000) {
      console.warn("Hard limit reached, stopping message fetch.");
      break;
    }
    hardLimitCount++;

    console.info(`Fetching messages from channel ${channel.id}... (${buffer.length}...)`);

    const options: { limit?: number; before?: string } = { limit: batchSize };
    if (lastMessageId) {
      options.before = lastMessageId;
    }

    const messages = await channel.messages.fetch({ ...options, cache: true });
    if (messages.size === 0) {
      hasMoreMessages = false;
      continue;
    }

    messages.forEach(message => {
      if (!message.author.bot) {
        buffer.push(message);
      }
    });

    lastMessageId = messages.last()?.id || null;
  }

  console.log(buffer.length, "messages fetched from the quote channel.");

  // Write the buffer to quotes.json
  console.info("Writing quotes to quotes.json...");
  writeFileSync("./quotes.json", JSON.stringify(buffer), "utf-8");

  if (buffer.length > 0) {
    console.info("Writing quotes to the database...");
    await writeQuotesToDB(buffer);
  }
  else {
    console.warn("No messages found in the quote channel.");
  }
}

async function writeQuotesToDB(messages: DiscordMessage[]) {
}