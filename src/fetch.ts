import { env } from "node:process";
import { Client, Events, GatewayIntentBits, Message as DiscordMessage } from "discord.js";

export function fetchQuotes(): Promise<DiscordMessage[]> {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent] });

  return new Promise<DiscordMessage[]>((resolve, reject) => {
    client.once(Events.ClientReady, async readyClient => {
      console.info(`Logged in as ${readyClient.user.tag}!`);
      try {
        const messages = await readQuotes();
        resolve(messages);
      }
      catch (error) {
        reject(error);
      }
      finally {
        client.destroy();
      }
    });

    client.login(env.DISCORD_BOT_TOKEN || "")
      .catch(error => {
        console.error("Failed to log in:", error);
        reject(error);
      });

    async function readQuotes() {
      const channel = await client.channels.fetch(env.DISCORD_QUOTE_CHANNEL_ID || "SOMETHING_WENT_WRONG");
      if (!channel || !channel.isTextBased()) {
        throw new Error("Failed to fetch the quote channel or it is not a text channel.");
      }

      const batchSize = 100;
      const buffer: DiscordMessage[] = [];
      let lastMessageId: string | null = null;
      let hasMoreMessages = true;
      let hardLimitCount = 0;
      while (hasMoreMessages) {
        if (hardLimitCount >= 10000) {
          console.warn("Hard limit reached, stopping message fetch.");
          return buffer; // Return what we have so far
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

      return buffer;
    }
  });
}