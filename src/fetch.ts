import { env } from "node:process";
import { Client, Events, GatewayIntentBits, Message as DiscordMessage, User as DiscordUser } from "discord.js";

/** Message id's of messages to be ignored */
const messageBlacklist = [
  "1167426858887958568", // Formatting test message
]

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
          if (
            !message.author.bot
            &&
            message.type === 0
            &&
            !messageBlacklist.includes(message.id)
          ) {
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

export function fetchUsers(userIds: string[]): Promise<DiscordUser[]> {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

  return new Promise((resolve, reject) => {
    client.once(Events.ClientReady, async readyClient => {
      console.info(`Logged in as ${readyClient.user.tag}!`);
      try {
        const users = await Promise.all(userIds.filter(i => typeof i === "string").map(id => client.users.fetch(id)));
        const nicknames = await Promise.all(userIds.map(async id => {
          const guild = await readyClient.guilds.fetch(env.DISCORD_GUILD_ID || "SOMETHING_WENT_WRONG")
          return guild.members.fetch(id).then(member => member.nickname)
        }));
        users.forEach((user, index) => {
          // @ts-expect-error - discord.js types lie
          user.nickname = nicknames[index];
        });
        console.info("Fetched", users.length, "users from Discord.");
        resolve(users);
      }
      catch (error) {
        console.error("Failed to fetch users:", error);
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
  });
}