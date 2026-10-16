import type { Message } from "discord.js";
import { Client as DiscordClient, GatewayIntentBits } from "discord.js";

// Pings ministers whose Spotify link broke (token refresh failed) in the music
// channel. Deduped against the channel's latest message: when that is already
// the bot's ping for the same people, a keycap tally reaction is added instead
// of a new ping, so repeated 15-minute runs count up rather than spam.

const MUSIC_CHANNEL_ID = process.env.MUSIC_CHANNEL_ID;
const TALLY_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

function sameSet(a: Iterable<string>, b: Iterable<string>): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  return setA.size === setB.size && [...setA].every((id) => setB.has(id));
}

async function addTally(message: Message): Promise<number | undefined> {
  // A REST-fetched message carries the bot's own reactions, so the current
  // tally is simply how many keycaps the bot has already added
  const mine = message.reactions.cache.filter((reaction) => reaction.me && TALLY_EMOJI.includes(reaction.emoji.name ?? ""));
  const next = TALLY_EMOJI[mine.size];
  if (next === undefined) return undefined;
  await message.react(next);
  return mine.size + 1;
}

export async function notifyBrokenSpotifyLinks(userIds: readonly string[]) {
  if (userIds.length === 0) return;
  if (!MUSIC_CHANNEL_ID) {
    console.info("MUSIC_CHANNEL_ID is not set, skipping broken Spotify link ping.");
    return;
  }
  if (!process.env.DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN is not set in environment variables");
  const canonicalUrl = process.env.CANONICAL_URL ?? "https://riksdagen.net";

  const client = new DiscordClient({ intents: [GatewayIntentBits.Guilds] });
  try {
    await client.login(process.env.DISCORD_BOT_TOKEN);
    const channel = await client.channels.fetch(MUSIC_CHANNEL_ID);
    if (!channel?.isTextBased() || !("send" in channel)) throw new Error("Music channel not found or is not text-based");

    const latest = (await channel.messages.fetch({ limit: 1 })).first();
    if (latest && latest.author.id === client.user?.id && sameSet(latest.mentions.users.keys(), userIds)) {
      const tally = await addTally(latest);
      console.info(tally === undefined
        ? `Broken Spotify link ping already at max tally for ${userIds.join(", ")}, no-op.`
        : `Broken Spotify link ping unchanged for ${userIds.join(", ")}, tally now ${tally}.`);
      return;
    }

    const mentions = userIds.map((id) => `<@${id}>`).join(" ");
    const noun = userIds.length === 1 ? "din Spotify-koppling har gått sönder" : "era Spotify-kopplingar har gått sönder";
    await channel.send(`${mentions} ${noun} - koppla om på ${canonicalUrl}/spotify`);
    console.info(`Pinged ${userIds.join(", ")} about broken Spotify links.`);
  } finally {
    await client.destroy();
  }
}
