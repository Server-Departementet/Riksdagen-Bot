import type { Client, Message, PartialMessage } from "discord.js";
import { EmbedBuilder, Events } from "discord.js";

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

if (!process.env.MONITORING_GUILD_ID) throw new Error("MONITORING_GUILD_ID is not set in environment variables");
const MONITORING_GUILD_ID = process.env.MONITORING_GUILD_ID;
if (!process.env.MONITORING_LOG_CHANNEL_ID) throw new Error("MONITORING_LOG_CHANNEL_ID is not set in environment variables");
const MONITORING_LOG_CHANNEL_ID = process.env.MONITORING_LOG_CHANNEL_ID;

const EDIT_COLOR = 0xf0b132;
const DELETE_COLOR = 0xd83c3e;

/** Embed field values cap at 1024 characters. */
function clip(content: string): string {
  return content.length > 1000 ? `${content.slice(0, 997)}…` : content;
}

function contentField(content: string | null | undefined): string {
  if (content === null || content === undefined) return "*okänt (meddelandet fanns inte i cachen)*";
  if (content.length === 0) return "*inget textinnehåll*";
  return clip(content);
}

async function fetchLogChannel(client: Client) {
  const channel = await client.channels.fetch(MONITORING_LOG_CHANNEL_ID);
  if (!channel?.isTextBased() || !("send" in channel)) throw new Error("Monitoring channel not found or is not text-based");
  return channel;
}

/** Events from other guilds, from bots, and from the log channel itself are not monitored. */
function shouldMonitor(message: Message | PartialMessage): boolean {
  if (message.guildId !== MONITORING_GUILD_ID) return false;
  if (message.channelId === MONITORING_LOG_CHANNEL_ID) return false;
  if (message.author?.bot) return false;
  return true;
}

async function onMessageUpdate(client: Client, oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) {
  if (!shouldMonitor(newMessage)) return;
  // The fetch fails if the message was deleted right after the edit - the delete handler covers that
  const message = newMessage.partial ? await newMessage.fetch() : newMessage;
  if (message.author.bot) return;
  const oldContent = oldMessage.partial ? undefined : oldMessage.content;
  // Discord emits MessageUpdate without a content change when link embeds resolve - pure noise
  if (oldContent !== undefined && oldContent === message.content) return;

  const embed = new EmbedBuilder()
    .setColor(EDIT_COLOR)
    .setTitle("Meddelande redigerat")
    .setDescription(`<@${message.author.id}> redigerade ett [meddelande](${message.url}) i <#${message.channelId}>`)
    .addFields(
      { name: "Före", value: contentField(oldContent) },
      { name: "Efter", value: contentField(message.content) },
    )
    .setFooter({ text: `Meddelande-ID: ${message.id}` })
    .setTimestamp(new Date());

  const logChannel = await fetchLogChannel(client);
  await logChannel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  logInfo("Logged message edit", { messageId: message.id, channelId: message.channelId, authorId: message.author.id });
}

async function onMessageDelete(client: Client, message: Message | PartialMessage) {
  if (!shouldMonitor(message)) return;

  const author = message.author ? `<@${message.author.id}>` : "*okänd användare*";
  const attachmentNote = message.attachments.size > 0 ? `\nBilagor: ${message.attachments.size}` : "";
  const embed = new EmbedBuilder()
    .setColor(DELETE_COLOR)
    .setTitle("Meddelande raderat")
    .setDescription(`Ett meddelande av ${author} raderades i <#${message.channelId}>${attachmentNote}`)
    .addFields({ name: "Innehåll", value: contentField(message.partial ? undefined : message.content) })
    .setFooter({ text: `Meddelande-ID: ${message.id}` })
    .setTimestamp(new Date());

  const logChannel = await fetchLogChannel(client);
  await logChannel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  logInfo("Logged message delete", { messageId: message.id, channelId: message.channelId, authorId: message.author?.id });
}

/**
 * Logs edits and deletes in the monitored guild to the monitoring channel.
 * Requires the GuildMessages + MessageContent intents and the Message partial
 * on the client; without the partial, uncached messages emit no events at all.
 */
export function registerMonitor(client: Client) {
  client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
    onMessageUpdate(client, oldMessage, newMessage).catch((err: unknown) => {
      logError("Error logging message edit", err, { messageId: newMessage.id });
    });
  });

  client.on(Events.MessageDelete, (message) => {
    onMessageDelete(client, message).catch((err: unknown) => {
      logError("Error logging message delete", err, { messageId: message.id });
    });
  });

  // Bulk deletes (e.g. a moderation purge) skip the MessageDelete event
  client.on(Events.MessageBulkDelete, (messages) => {
    void (async () => {
      for (const message of messages.values()) {
        await onMessageDelete(client, message);
      }
    })().catch((err: unknown) => {
      logError("Error logging bulk message delete", err, { count: messages.size });
    });
  });

  logInfo("Monitor registered", { guildId: MONITORING_GUILD_ID, logChannelId: MONITORING_LOG_CHANNEL_ID });
}
