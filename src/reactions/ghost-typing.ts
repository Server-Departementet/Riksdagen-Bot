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

const GHOST_TYPING_CHANCE = 0.005;
const GHOST_TYPING_MIN_MS = 4 * 60_000;
const GHOST_TYPING_MAX_MS = 6 * 60_000;
// The typing indicator expires after ~10 s, so it must be re-triggered to persist
const TYPING_REFRESH_MS = 8_000;

/** Channels currently being ghost-typed in, so sessions never stack. */
const activeChannels = new Set<string>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ghostType(message: Message) {
  const channel = message.channel;
  if (!("sendTyping" in channel)) return;
  const durationMs = GHOST_TYPING_MIN_MS + Math.random() * (GHOST_TYPING_MAX_MS - GHOST_TYPING_MIN_MS);
  const deadline = Date.now() + durationMs;
  activeChannels.add(channel.id);
  logInfo("Ghost typing started", { channelId: channel.id, guildId: message.guildId, durationMs: Math.round(durationMs) });
  try {
    while (Date.now() < deadline) {
      await channel.sendTyping();
      await sleep(TYPING_REFRESH_MS);
    }
    logInfo("Ghost typing finished", { channelId: channel.id });
  }
  finally {
    activeChannels.delete(channel.id);
  }
}

/**
 * On any human message there is a small chance the bot starts "typing" in that
 * channel for around five minutes - and then never sends anything. One session
 * per channel at a time; needs SendMessages permission in the channel.
 */
export function registerGhostTyping(client: Client) {
  client.on(Events.MessageCreate, (message) => {
    if (message.author.bot) return;
    if (activeChannels.has(message.channelId)) return;
    if (Math.random() >= GHOST_TYPING_CHANCE) return;
    ghostType(message).catch((err: unknown) => {
      activeChannels.delete(message.channelId);
      logError("Error while ghost typing", err, { channelId: message.channelId });
    });
  });
  logInfo("Ghost typing registered", { chance: GHOST_TYPING_CHANCE });
}
