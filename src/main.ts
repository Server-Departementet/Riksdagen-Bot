import { env } from "node:process";
// ENV guard
["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_QUOTE_CHANNEL_ID"].forEach((variableName) => {
  if (!env[variableName]) {
    console.error(`Error: Environment variable ${variableName} is not set.`);
    process.exit(1);
  }
});
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { Message as DiscordMessage } from "discord.js";
import { fetchQuotes } from "./fetch.ts";

const cacheDuration = 10 * 60 * 1000; // 10 minutes in milliseconds

async function getQuotes() {
  const cacheDate = statSync("./quotes.json")?.mtime;
  if (cacheDate && (new Date().getTime() - cacheDate.getTime()) < cacheDuration) {
    const cache = JSON.parse(readFileSync("./quotes.json", "utf-8")) as DiscordMessage[];
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

await getQuotes()
  .then(() => console.info("Quotes fetched and cached successfully."))