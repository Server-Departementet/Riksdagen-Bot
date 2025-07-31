import { env } from "node:process";
// ENV guard
["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_QUOTE_CHANNEL_ID"].forEach((variableName) => {
  if (!env[variableName]) {
    console.error(`Error: Environment variable ${variableName} is not set.`);
    process.exit(1);
  }
});

import { Client, Events, GatewayIntentBits, Message as DiscordMessage } from "discord.js";
import { DatabaseSync } from "node:sqlite";
import type { Message } from "./types.js";

/** 
 * DB
 */
const quoteDB = new DatabaseSync(`db/quotes-${new Date().toISOString().replace(/T.*/, "")}.db`);

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

    const messages = await channel.messages.fetch(options);
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

  // Write buffer to db as messages in the message table
  const trimmedMessages: Message[] = buffer.map(m => ({
    id: m.id,
    attachments: m.attachments,
    author: m.author,
    components: m.components,
    content: m.content,
    createdTimestamp: m.createdTimestamp,
    editedTimestamp: m.editedTimestamp,
    embeds: m.embeds,
    mentions: m.mentions,
    pinned: m.pinned,
    reactions: m.reactions,
    messageSnapshots: m.messageSnapshots,
    url: m.url,
    reference: m.reference,
  }));

  // Create table if it doesn't exist
  quoteDB.exec(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    attachments TEXT,
    author TEXT,
    components TEXT,
    content TEXT,
    createdTimestamp INTEGER,
    editedTimestamp INTEGER,
    embeds TEXT,
    mentions TEXT,
    pinned INTEGER,
    reactions TEXT,
    url TEXT,
    reference TEXT
  )`);

  // Insert messages into the table
  const insert = quoteDB.prepare(`INSERT INTO messages (id, attachments, author, components, content, createdTimestamp, editedTimestamp, embeds, mentions, pinned, reactions, url, reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const message of trimmedMessages) {
    insert.run(
      message.id,
      JSON.stringify(message.attachments),
      message.author.id,
      JSON.stringify(message.components),
      message.content,
      message.createdTimestamp,
      message.editedTimestamp,
      JSON.stringify(message.embeds),
      JSON.stringify(message.mentions),
      message.pinned ? 1 : 0,
      JSON.stringify(message.reactions),
      message.url,
      message.reference ? JSON.stringify(message.reference) : null
    );
  }

  // Log the number of messages inserted
  console.log(`${trimmedMessages.length} messages inserted into the database.`);

  process.exit(0);
}