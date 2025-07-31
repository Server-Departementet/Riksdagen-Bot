import { env } from "node:process";
// ENV guard
["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_QUOTE_CHANNEL_ID", "DISCORD_GUILD_ID"].forEach((variableName) => {
  if (!env[variableName]) {
    console.error(`Error: Environment variable ${variableName} is not set.`);
    process.exit(1);
  }
});
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { Message as DiscordMessage, quote, User as DiscordUser } from "discord.js";
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

async function getUsers(messages: DiscordMessage[]): Promise<DiscordUser[]> {
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

const quotedCount: Record<string, number> = {};
const authorCount: Record<string, number> = {};

const altNameMap: Record<string, string> = {
  "Viggo": "Vena",
  "Viggos pappa": "Venas pappa",
  "Viggos mamma": "Venas mamma",
  "Viggos mor": "Venas mor",
};

const quotes: {
  author: string;
  authorId: string;
  quote: string;
  quoted: string;
  context: string;
  url: string;
}[] = [];

let i = -1;
for (const message of messages) {
  i++;

  const content = message.content;

  const url = `https://discord.com/channels/${env.DISCORD_GUILD_ID}/${env.DISCORD_QUOTE_CHANNEL_ID}/${message.id}`;

  if (!content) {
    console.log(url);
    console.dir(message, { depth: null });
    break;
  }

  const isMultipleLines = content.includes("\n");
  if (isMultipleLines) {
    console.log("Skipping multi line");
    continue;
  }

  const author = users.find(u => u.id ===
    // @ts-expect-error - Discord.js is lying
    message.authorId
  ) as DiscordUser & { nickname: string };

  const [body, meta] = content.split(new RegExp(`[?:${quoteCharacters.join("")}]\\s?-\\s?`), 2).map(s => s.trim());
  const quote = body.substring(1, body.length - 1).trim();

  const [_match, quoted, context] = Array.from(meta.match(/(.*?)((?:\s(?:som|om|till|efter|i|när|medan|\()|,|$).*)/) || []).map(s => s.replace(/^,/, "").trim());

  // if (meta.includes(" ")) {
  //   console.log(`\x1b[90m${i} ${url}\x1b[0m`);
  //   console.log(`\x1b[90m${content}\x1b[0m`);
  //   console.log("Author:", author.nickname);
  //   console.log("Quote:", quote);
  //   console.log("Quoted:", quoted);
  //   console.log("Context:", context);
  //   console.log("");
  // }

  const attributedName = altNameMap[quoted] || quoted;
  if (quotedCount[attributedName]) quotedCount[attributedName]++;
  else quotedCount[attributedName] = 1;

  if (authorCount[author.nickname]) authorCount[author.nickname]++;
  else authorCount[author.nickname] = 1;

  quotes.push({
    author: author.nickname,
    authorId: author.id,
    quote: quote,
    quoted: attributedName,
    context: context,
    url: url,
  });
}

// const authorsWithLinks = Object.fromEntries(Object.keys(authorCount)
//   .map(a => {
//     return [a, quotes.filter(q => q.author === a).map(q => q.url).join(", ")];
//   }));

// const quotedWithLinks = Object.fromEntries(Object.keys(quotedCount)
//   .map(q => {
//     return [q, quotes.filter(quote => quote.quoted === q).map(q => `"${q.url}"`).join(", ")];
//   }));

// const sortedQuotedWithLinks = Object.entries(quotedWithLinks)
//   .sort((a, b) => b[1].split(", ").length - a[1].split(", ").length)
//   .map(([name, links]) => `"${name}": [${links}]`)
//   .join(",\n\t");

// writeFileSync("./quoted.json", `{\n\t${sortedQuotedWithLinks}\n}`, "utf-8");


// const sortedAuthorCount = Object.entries(authorCount).sort((a, b) => b[1] - a[1]).map(([name, count]) => `"${name}": ${count}`).join(",\n\t");
// const sortedQuotedCount = Object.entries(quotedCount).sort((a, b) => b[1] - a[1]).map(([name, count]) => `"${name}": ${count}`).join(",\n\t");

// writeFileSync("./author.json", `{\n\t${sortedAuthorCount}\n}`, "utf-8");