import type { Client, MessageReaction, PartialMessageReaction, PartialUser, User } from "discord.js";
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

/** Same member as the :winroth: easter egg; unset disables this one too. */
const WINROTH_USER_ID = process.env.WINROTH_USER_ID;
const SCISSORS = "✂️";

/** Reaction emoji arrive with or without the emoji-style selector (U+FE0F). */
function isScissors(name: string | null): boolean {
  return name !== null && name.replaceAll("️", "") === SCISSORS.replaceAll("️", "");
}

async function onReactionAdd(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
  if (user.bot) return;
  if (!isScissors(reaction.emoji.name)) return;
  // The message is partial when it predates the current process - fetch resolves the author
  const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
  if (message.author.id !== WINROTH_USER_ID) return;
  const full = reaction.partial ? await reaction.fetch() : reaction;
  if (full.me) return;
  await message.react(SCISSORS);
  logInfo("Joined a scissors reaction", { messageId: message.id, guildId: message.guildId, reactorId: user.id });
}

/**
 * When someone reacts ✂️ on a WINROTH_USER_ID message, the bot joins in with
 * its own ✂️. Requires the GuildMessageReactions intent plus the Message and
 * Reaction partials - without them, reactions on uncached messages emit nothing.
 */
export function registerScissors(client: Client) {
  if (!WINROTH_USER_ID) {
    logInfo("WINROTH_USER_ID is not set, scissors reactions disabled");
    return;
  }
  client.on(Events.MessageReactionAdd, (reaction, user) => {
    onReactionAdd(reaction, user).catch((err: unknown) => {
      logError("Error joining scissors reaction", err, { messageId: reaction.message.id });
    });
  });
  logInfo("Scissors reactions registered", { userId: WINROTH_USER_ID });
}
