// node --env-file .env src/roles.ts

const env: { "DISCORD_GUILD_ID": string } = process.env as any;
["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_QUOTE_CHANNEL_ID", "DISCORD_GUILD_ID"].forEach((variableName) => {
  if (!process.env[variableName]) {
    console.error(`Error: Environment variable ${variableName} is not set.`);
    process.exit(1);
  }
});
import { Client, GatewayIntentBits, Message } from "discord.js";
import fs from "node:fs";

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.login(process.env.DISCORD_BOT_TOKEN);

client.once("ready", async () => {
  console.info(`Logged in as ${client.user?.tag}!`);

  const guild = await client.guilds.fetch(env.DISCORD_GUILD_ID);

  const channels = await guild.channels.fetch();
  console.log("Channels fetched:", channels.size);

  console.log("Fetching messages from channels...");
  const messages = await Promise.all(channels.map(async channel => {
    if (!channel?.isTextBased()) {
      return [];
    }

    // Paginate through messages
    let lastMessageId: string | null = null;
    let hasMoreMessages = true;
    const buffer: Message[] = [];
    while (hasMoreMessages) {
      console.log("Working on channel", channel.id, "buffer size", buffer.length);

      const options: { limit: number; before?: string } = { limit: 100 };
      if (lastMessageId) {
        options.before = lastMessageId;
      }
      const msgs = await channel.messages.fetch(options);
      if (msgs.size === 0) {
        hasMoreMessages = false;
        continue;
      }

      msgs.forEach(m => buffer.push(m));

      lastMessageId = msgs.last()?.id || null;

      // Hard limit
      if (buffer.length >= 1000000) {
        hasMoreMessages = false;
      }
    }

    const msgs = buffer;

    return msgs.map(m => ({
      content: m.content,
      author: m.author.username,
      channel: channel.name,
      createdAt: m.createdAt,
      link: `https://discord.com/channels/${env.DISCORD_GUILD_ID}/${channel.id}/${m.id}`,
    }));
  }));
  console.log("Messages fetched from channels:", messages.length);

  // Write to file
  fs.writeFileSync("./all_messages.json", JSON.stringify(messages.flat()), "utf-8");

  client.destroy();
});
