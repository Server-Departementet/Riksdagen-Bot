import type { Client, Message } from "discord.js";
import { Events } from "discord.js";

// Logger utility
function log(level: "INFO" | "WARN" | "ERROR", message: string, data?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  const extra = data ? ` ${JSON.stringify(data)}` : "";
  console.log(`[${timestamp}] [${level}] ${message}${extra}`);
}

function logInfo(message: string, data?: Record<string, unknown>) {
  log("INFO", message, data);
}

function logError(message: string, error?: unknown, data?: Record<string, unknown>) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  log("ERROR", message, { ...data, error: errorMsg });
}

/** The member whose messages occasionally earn a :winroth:. Unset disables the feature. */
const WINROTH_USER_ID = process.env.WINROTH_USER_ID;
const WINROTH_EMOJI_NAME = "winroth";
const WINROTH_CHANCE = 0.01;

/**
 * Picks the :winroth: custom emoji, preferring the message's own guild so the
 * reaction never depends on external-emoji permissions. Falls back to any guild
 * the bot is in - Discord lets a bot react with emoji from every guild it belongs to.
 */
function findWinrothEmoji(client: Client, message: Message) {
  const local = message.guild?.emojis.cache.find((emoji) => emoji.name === WINROTH_EMOJI_NAME);
  return local ?? client.emojis.cache.find((emoji) => emoji.name === WINROTH_EMOJI_NAME);
}

async function onMessageCreate(client: Client, message: Message) {
  if (message.author.bot) return;
  if (message.author.id !== WINROTH_USER_ID) return;
  if (Math.random() >= WINROTH_CHANCE) return;

  const emoji = findWinrothEmoji(client, message);
  if (!emoji) {
    logError("No :winroth: emoji available in any guild", undefined, { messageId: message.id, guildId: message.guildId });
    return;
  }
  await message.react(emoji);
  logInfo("Reacted with :winroth:", { messageId: message.id, guildId: message.guildId, emojiGuildId: emoji.guild.id });
}

/**
 * Reacts with :winroth: to 1% of the WINROTH_USER_ID member's messages, in every
 * guild the bot is in. Requires the GuildMessages intent on the client; the emoji cache fills
 * from GUILD_CREATE at startup, and GuildEmojisAndStickers keeps it current.
 */
export function registerWinroth(client: Client) {
  if (!WINROTH_USER_ID) {
    logInfo("WINROTH_USER_ID is not set, winroth reactions disabled");
    return;
  }
  client.on(Events.MessageCreate, (message) => {
    onMessageCreate(client, message).catch((err: unknown) => {
      logError("Error reacting with :winroth:", err, { messageId: message.id });
    });
  });
  logInfo("Winroth reactions registered", { userId: WINROTH_USER_ID, chance: WINROTH_CHANCE });
}
