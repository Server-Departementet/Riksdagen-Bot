import { env } from "node:process";
// ENV guard
["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_QUOTE_CHANNEL_ID", "DISCORD_GUILD_ID"].forEach((variableName) => {
  if (!env[variableName]) {
    console.error(`Error: Environment variable ${variableName} is not set.`);
    process.exit(1);
  }
});
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { Message as DiscordMessage } from "discord.js";
import { fetchQuotes, fetchUsers } from "./fetch.ts";

// Create cache files if they don't exist
if (!existsSync("./quotes.json")) writeFileSync("./quotes.json", JSON.stringify([]), "utf-8");
if (!existsSync("./users.json")) writeFileSync("./users.json", JSON.stringify([]), "utf-8");

const cacheDuration = 30 * 60 * 1000; // 30 minutes in milliseconds

async function getQuotes() {
  const cacheDate = statSync("./quotes.json")?.mtime;
  const cache = JSON.parse(readFileSync("./quotes.json", "utf-8")) as DiscordMessage[];
  if (cache.length && (new Date().getTime() - cacheDate.getTime()) < cacheDuration) {
    console.info("Using cached quotes.json");
    return cache;
  }
  else {
    console.info("Fetching quotes from Discord...");
    const messages = await fetchQuotes();
    if (messages.length === 0) {
      console.warn("No messages fetched, using empty cache.");
      return [];
    }
    console.info("Fetched", messages.length, "messages from Discord.");
    writeFileSync("./quotes.json", JSON.stringify(messages), "utf-8");
    return messages;
  }
}

async function getUsers(messages: DiscordMessage[]) {
  const cacheDate = statSync("./users.json")?.mtime;
  const cache = JSON.parse(readFileSync("./users.json", "utf-8"));
  if (cache.length && (new Date().getTime() - cacheDate.getTime()) < cacheDuration) {
    console.info("Using cached users.json");
    return cache;
  }
  else {
    console.info("Fetching users from Discord...");
    const userIds = Array.from(new Set(messages.map(m =>
      // @ts-expect-error - discord.js types lie
      m.authorId
    )));
    const users = await fetchUsers(userIds);
    if (users.length === 0) {
      console.warn("No users fetched, using empty cache.");
      return [];
    }
    console.info("Fetched", users.length, "users from Discord.");
    writeFileSync("./users.json", JSON.stringify(users), "utf-8");
    return users;
  }
}

const messages = await getQuotes()
const users = await getUsers(messages);

const quoteCharacters = ['"', "'", "“", "‘", "”", "’", "«", "»"];

const quoteeCount: Record<string, number> = {};

for (const message of messages) {
  const content = message.content;

  if (!content) {
    console.dir(message, { depth: null });
    break;
  }

  const openingQuote = quoteCharacters.map(c => content.indexOf(c)).filter(i => i !== -1).sort((a, b) => a - b)[0];
  const closingQuote = quoteCharacters.map(c => content.lastIndexOf(c)).filter(i => i !== -1).sort((a, b) => b - a)[0];

  const body = content.substring(openingQuote + 1, closingQuote);

  console.log(`\x1b[90m${content}\x1b[0m`);
  console.log(body);

  console.log("");
}
// https://discord.com/channels/1167416170769563750/1167423681648136202/1167427335247646791