// node --env-file .env src/roles.ts

const env: { "DISCORD_GUILD_ID": string } = process.env as any;
["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_QUOTE_CHANNEL_ID", "DISCORD_GUILD_ID"].forEach((variableName) => {
  if (!process.env[variableName]) {
    console.error(`Error: Environment variable ${variableName} is not set.`);
    process.exit(1);
  }
});
import { Client, GatewayIntentBits } from "discord.js";
import fs from "node:fs";

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.login(process.env.DISCORD_BOT_TOKEN);

client.once("ready", async () => {
  console.info(`Logged in as ${client.user?.tag}!`);
  if (!env.DISCORD_GUILD_ID) throw new Error("DISCORD_GUILD_ID is not set");
  const guild = await client.guilds.fetch(env.DISCORD_GUILD_ID);
  const roles = (await guild.roles.fetch())
    .map(r => ({
      name: r.name,
      id: r.id,
      color: r.hexColor,
      order: r.rawPosition,
      createdAt: r.createdAt,
    }))
    .filter(r => r.name.includes("minister"));

  console.dir(roles, { depth: 1 });
  fs.writeFileSync("./roles.json", JSON.stringify(roles), "utf-8");

  client.destroy();
});
