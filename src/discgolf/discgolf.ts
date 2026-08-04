import "dotenv/config";
import path from "node:path";
import type { ChatInputCommandInteraction, Message } from "discord.js";
import { Client as DiscordClient, Events, GatewayIntentBits, MessageFlags, Partials, REST, Routes, SlashCommandBuilder } from "discord.js";
import type { Course, HoleScore } from "./courses";
import { buildScoreTable, courseNameFrom, courseTotal, findCourse, formatRelative, holeScoreValue, loadCourses, missingHoles, parseScoreLine, relativeToPar } from "./courses";
import type { CourseRecords, RecordEntry } from "./records";
import { applyRoundResults, formatRecords, parseRecords } from "./records";

// Logger utility
function log(level: "INFO" | "WARN" | "ERROR", message: string, data?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  const extra = data ? ` ${JSON.stringify(data)}` : "";
  console.log(`[${timestamp}] [${level}] ${message}${extra}`);
}

function logInfo(message: string, data?: Record<string, unknown>) {
  log("INFO", message, data);
}

function logWarn(message: string, data?: Record<string, unknown>) {
  log("WARN", message, data);
}

function logError(message: string, error?: unknown, data?: Record<string, unknown>) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  log("ERROR", message, { ...data, error: errorMsg });
}

logInfo("Starting Discord Discgolf Bot");

const courses = loadCourses(path.join(import.meta.dirname, "courses"));
logInfo("Loaded courses", { count: courses.length, names: courses.map((course) => course.name) });

if (!process.env.DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN is not set in environment variables");
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!process.env.DISCORD_BOT_CLIENT_ID) throw new Error("DISCORD_BOT_CLIENT_ID is not set in environment variables");
const DISCORD_BOT_CLIENT_ID = process.env.DISCORD_BOT_CLIENT_ID;
if (!process.env.DISCGOLF_GUILD_ID) throw new Error("DISCGOLF_GUILD_ID is not set in environment variables");
const DISCGOLF_GUILD_ID = process.env.DISCGOLF_GUILD_ID;
if (!process.env.DISCGOLF_READ_CHANNEL_ID) throw new Error("DISCGOLF_READ_CHANNEL_ID is not set in environment variables");
const DISCGOLF_READ_CHANNEL_ID = process.env.DISCGOLF_READ_CHANNEL_ID;
if (!process.env.DISCGOLF_WRITE_CHANNEL_ID) throw new Error("DISCGOLF_WRITE_CHANNEL_ID is not set in environment variables");
const DISCGOLF_WRITE_CHANNEL_ID = process.env.DISCGOLF_WRITE_CHANNEL_ID;
if (!process.env.DISCGOLF_RECORD_CHANNEL_ID) throw new Error("DISCGOLF_RECORD_CHANNEL_ID is not set in environment variables");
const DISCGOLF_RECORD_CHANNEL_ID = process.env.DISCGOLF_RECORD_CHANNEL_ID;
if (!process.env.DISCGOLF_RECORD_MESSAGE_ID) throw new Error("DISCGOLF_RECORD_MESSAGE_ID is not set in environment variables");
const DISCGOLF_RECORD_MESSAGE_ID = process.env.DISCGOLF_RECORD_MESSAGE_ID;

const discordClient = new DiscordClient({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessages,
  ],
  // Without the Message partial, edits to uncached messages (e.g. a course name
  // edited into an old score message after a restart) emit no MessageUpdate event
  partials: [Partials.Message],
});

const commands = [
  new SlashCommandBuilder()
    .setName("räkna")
    .setDescription("Räknar poäng från senaste banan"),
  new SlashCommandBuilder()
    .setName("formatera")
    .setDescription("Formaterar om banrekord-meddelandet"),
  new SlashCommandBuilder()
    .setName("hjälp")
    .setDescription("Förklarar poängsyntax och botens funktioner"),
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Svarar med pong och latens"),
].map((command) => command.toJSON());

async function registerCommands() {
  const rest = new REST().setToken(DISCORD_BOT_TOKEN);
  logInfo("Registering commands", { guildId: DISCGOLF_GUILD_ID, commandCount: commands.length });
  await rest.put(
    Routes.applicationGuildCommands(DISCORD_BOT_CLIENT_ID, DISCGOLF_GUILD_ID),
    { body: commands },
  );
  logInfo("Successfully registered guild application (/) commands");
}

discordClient.once(Events.ClientReady, (client) => {
  logInfo("Discord client is ready", { userId: client.user.id, username: client.user.tag });
  registerCommands()
    .then(() => {
      logInfo("Finished registering commands");
    })
    .catch((err: unknown) => {
      logError("Error registering commands", err);
    });
});

// Handle interactions
discordClient.on(Events.InteractionCreate, (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  logInfo("Chat input command received", {
    commandName: interaction.commandName,
    userId: interaction.user.id,
    username: interaction.user.username,
    interactionId: interaction.id,
    guildId: interaction.guildId,
  });

  dispatchCommands(interaction)
    .catch((err: unknown) => {
      logError("Error handling command", err, {
        commandName: interaction.commandName,
        userId: interaction.user.id,
        interactionId: interaction.id,
      });
      if (interaction.replied || interaction.deferred) {
        interaction.followUp({ content: "There was an error while executing this command!", flags: MessageFlags.Ephemeral }).catch(console.error);
      } else {
        interaction.reply({ content: "There was an error while executing this command!", flags: MessageFlags.Ephemeral }).catch(console.error);
      }
    });
});

async function dispatchCommands(interaction: ChatInputCommandInteraction) {
  switch (interaction.commandName) {
    case "räkna":
      await räkna(interaction);
      return;
    case "formatera":
      await formatera(interaction);
      return;
    case "hjälp":
      await hjälp(interaction);
      return;
    case "ping":
      await ping(interaction);
      return;
    default:
      logWarn("Unknown command", { commandName: interaction.commandName });
      await interaction.reply({ content: "Unknown command.", flags: MessageFlags.Ephemeral });
  }
}

const COURSE_ACK_KNOWN = "✅";
const COURSE_ACK_UNKNOWN = "❓";

/**
 * Acknowledges a course message with ✅ (in the catalog, pars available) or
 * ❓ (course-like but unknown). Runs on new and edited messages, so fixing a
 * typo or editing a course name into a score message updates the reaction.
 */
async function ackCourseMessage(message: Message) {
  if (message.author.bot) return;
  if (message.channelId !== DISCGOLF_READ_CHANNEL_ID) return;

  const courseName = courseNameFrom(courses, message.content);
  const desired = courseName === undefined
    ? undefined
    : findCourse(courses, courseName) ? COURSE_ACK_KNOWN : COURSE_ACK_UNKNOWN;

  for (const emoji of [COURSE_ACK_KNOWN, COURSE_ACK_UNKNOWN]) {
    const existing = message.reactions.cache.find((reaction) => reaction.emoji.name === emoji && reaction.me);
    if (emoji !== desired && existing) await existing.users.remove();
    if (emoji === desired && !existing) await message.react(emoji);
  }
  if (desired) {
    logInfo("Acknowledged course message", { messageId: message.id, courseName, known: desired === COURSE_ACK_KNOWN });
  }
}

discordClient.on(Events.MessageCreate, (message) => {
  ackCourseMessage(message).catch((err: unknown) => {
    logError("Error acknowledging course message", err, { messageId: message.id });
  });
});

discordClient.on(Events.MessageUpdate, (_oldMessage, newMessage) => {
  void (async () => {
    const message = newMessage.partial ? await newMessage.fetch() : newMessage;
    await ackCourseMessage(message);
  })().catch((err: unknown) => {
    logError("Error acknowledging edited message", err, { messageId: newMessage.id });
  });
});

async function hjälp(interaction: ChatInputCommandInteraction) {
  logInfo("hjälp command started", { userId: interaction.user.id, interactionId: interaction.id });
  const content = [
    "## Så funkar poängräkningen",
    "**Starta en runda:** skicka banans namn som ett eget meddelande — eller som första raden i ditt första poängmeddelande om du glömde. Allt som inte ser ut som en poängrad tolkas som ett bannamn. Botten reagerar ✅ när banan finns i katalogen och ❓ när den är okänd (då finns inga par).",
    "**Logga poäng:** en rad per hål: `<hål> <kast>`, t.ex. `4 5` eller `X1 3`.",
    "**DNF:** skriv något som inte är en siffra som poäng, t.ex. `5 dnf` — hålet räknas som par + 4 (PDGA 811).",
    "**/räkna:** räknar ihop senaste rundan och skickar resultatet. Rättat en felskriven poäng? Kör /räkna igen så uppdateras resultatet istället för att skickas om.",
    "**Saknade hål:** den som missat att skriva ett hål syns i kolumnen Saknad och blir pingad under tabellen. Hål som ingen skrivit räknas som överhoppade av gruppen.",
    "**Banrekord:** uppdateras automatiskt vid /räkna. Bara hela rundor räknas (alla numrerade hål — X-hål är frivilliga extrahål). Nya rekord flaggas med [PR 🎉] eller [Banrekord!! 🥳] tills nästa poängändring, och banan flyttas längst ner så att de minst spelade banorna klättrar uppåt.",
    "**Signatur:** din reaktion på banrekord-meddelandet blir din emoji på rekordlistan.",
    "**/formatera:** ritar om banrekord-meddelandet utan att räkna något (plockar t.ex. upp nya signaturer).",
  ].join("\n");
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  logInfo("hjälp command finished", { interactionId: interaction.id });
}

async function ping(interaction: ChatInputCommandInteraction) {
  logInfo("ping command started", { userId: interaction.user.id, interactionId: interaction.id });
  const latency = Math.round(discordClient.ws.ping);
  const roundtrip = Date.now() - interaction.createdTimestamp;
  await interaction.reply({
    content: `Pong! 🏓 WebSocket: ${latency}ms, svarstid: ${roundtrip}ms`,
    flags: MessageFlags.Ephemeral,
  });
  logInfo("ping command finished", { latency, roundtrip, interactionId: interaction.id });
}

await discordClient.login(DISCORD_BOT_TOKEN);
logInfo("Bot logged in and listening for interactions");

async function räkna(interaction: ChatInputCommandInteraction) {
  const sender = interaction.member?.user;
  logInfo("räkna command started", { userId: sender?.id, username: sender?.username, interactionId: interaction.id });

  if (!sender) {
    logError("Could not determine sender", undefined, { interactionId: interaction.id });
    await interaction.reply({ content: "Could not determine sender.", flags: MessageFlags.Ephemeral });
    return;
  }

  const readChannel = await discordClient.channels.fetch(DISCGOLF_READ_CHANNEL_ID);
  if (!readChannel?.isTextBased()) {
    logError("Read channel not found or is not text-based", undefined, { channelId: DISCGOLF_READ_CHANNEL_ID, interactionId: interaction.id });
    await interaction.reply({ content: "Read channel not found or is not text-based.", flags: MessageFlags.Ephemeral });
    return;
  }
  const writeChannel = await discordClient.channels.fetch(DISCGOLF_WRITE_CHANNEL_ID);
  if (!writeChannel?.isTextBased()) {
    logError("Write channel not found or is not text-based", undefined, { channelId: DISCGOLF_WRITE_CHANNEL_ID, interactionId: interaction.id });
    await interaction.reply({ content: "Write channel not found or is not text-based.", flags: MessageFlags.Ephemeral });
    return;
  }

  logInfo("Fetching messages", { userId: sender.id, readChannelId: readChannel.id, limit: 100, interactionId: interaction.id });
  const allMessages = (await readChannel.messages.fetch({ limit: 100 })).filter(m => !m.author.bot);
  logInfo("Messages fetched", { count: allMessages.size, interactionId: interaction.id });

  const courseMessage = allMessages.filter(m =>
    courseNameFrom(courses, m.content) !== undefined,
  ).first();

  const courseName = courseMessage ? courseNameFrom(courses, courseMessage.content) : undefined;
  if (!courseMessage || !courseName) {
    logWarn("No course message found", { userId: sender.id, interactionId: interaction.id });
    await interaction.reply({ content: `Hittade ingen bana i dem senaste 100 meddelandena.`, flags: MessageFlags.Ephemeral });
    return;
  }

  logInfo("Course message found", {
    messageId: courseMessage.id,
    courseName,
    timestamp: courseMessage.createdTimestamp,
    interactionId: interaction.id,
  });

  const course = findCourse(courses, courseName);
  if (!course) {
    logWarn("No course file matches course message, pars will be unavailable", { course: courseName, interactionId: interaction.id });
  }

  const guild = interaction.guild ?? await discordClient.guilds.fetch(DISCGOLF_GUILD_ID);
  await guild.members.fetch();
  // Includes the round's start time so two rounds on the same course and day get distinct headers
  const fancyDate = new Date(courseMessage.createdTimestamp).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", dateStyle: "long", timeStyle: "short" });
  const results: { memberId: string; name: string; points: number; score: Record<string, HoleScore> }[] = [];
  for (const member of guild.members.cache.values()) {
    if (member.user.bot) continue;
    const { points, score } = getUserScore(member.id, allMessages.toJSON(), courseMessage, course);
    if (Object.keys(score).length === 0) continue;
    results.push({ memberId: member.id, name: member.displayName, points, score });
  }

  if (results.length === 0) {
    await interaction.reply({ content: `Inga resultat hittades att skicka för banan ${courseName}.`, flags: MessageFlags.Ephemeral });
    return;
  }

  results.sort((a, b) => a.points - b.points);
  const lines = results.map(({ memberId, points, score }) =>
    `<@${memberId}> - totalt ${points}${formatScoreSuffix(course, score)}`,
  );
  const players = results.map(({ name, score }) => ({ name, score }));
  const table = buildScoreTable(course, players);
  // Mentions inside a code block neither render nor ping, so the reminders go after the table
  const missingLines = results
    .map(({ memberId, score }) => {
      const missing = missingHoles(course, players, score);
      return missing.length > 0 ? `<@${memberId}> har missat att skriva hål ${missing.join(", ")}` : undefined;
    })
    .filter((line): line is string => line !== undefined);
  // Records survive on Discord as a bot-owned message, so a failed update must not eat the scoreboard
  let recordLine = "";
  if (course) {
    try {
      const newCourseBest = await updateCourseRecords(course, courseMessage, results);
      if (newCourseBest) recordLine = `\n🏆 Nytt banrekord: ${newCourseBest.points} av <@${newCourseBest.userId}>!`;
    }
    catch (err) {
      logError("Failed to update course records", err, { course: course.name, interactionId: interaction.id });
    }
  }

  const boardHeader = `-# ${fancyDate}\n${courseName}\n`;
  const out = boardHeader + `${lines.join("\n")}\n\`\`\`\n${table}\n\`\`\``
    + (missingLines.length > 0 ? `\n${missingLines.join("\n")}` : "")
    + recordLine;
  if (!("send" in writeChannel)) {
    logError("Write channel is not text-based", undefined, { channelId: writeChannel.id, interactionId: interaction.id });
    await interaction.reply({ content: "Write channel is not text-based.", flags: MessageFlags.Ephemeral });
    return;
  }

  // A rerun for the same round (e.g. a mistyped score was corrected) edits the previous
  // board instead of posting a duplicate an admin would have to delete. The header
  // includes the round's start time, so it uniquely identifies the round's board even
  // when newer messages (corrections, the next round) have arrived after it.
  const botId = discordClient.user?.id;
  const recentWriteMessages = await writeChannel.messages.fetch({ limit: 50 });
  // Boards from before 2026-07-29 have no time in the header - match them too so they
  // get upgraded in place instead of duplicated
  const legacyDate = new Date(courseMessage.createdTimestamp).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", dateStyle: "long" });
  const legacyHeader = `-# ${legacyDate}\n${courseName}\n`;
  const previousBoard = botId !== undefined
    ? recentWriteMessages.find((m) =>
      m.author.id === botId
      && (m.content.startsWith(boardHeader) || m.content.startsWith(legacyHeader)))
    : undefined;

  if (previousBoard) {
    await previousBoard.edit(out);
    logInfo("Edited previous score message", { messageId: previousBoard.id, channelId: writeChannel.id, interactionId: interaction.id });
    await interaction.reply({ content: `Uppdaterade det senaste resultatet med ${lines.length} resultat.`, flags: MessageFlags.Ephemeral });
  }
  else {
    const sent = await writeChannel.send(out);
    logInfo("Sent aggregated score message", { messageId: sent.id, channelId: writeChannel.id, interactionId: interaction.id });
    await interaction.reply({ content: `Skickade ett meddelande med ${lines.length} resultat.`, flags: MessageFlags.Ephemeral });
  }
}

function getUserScore(userId: string, messages: Message[], courseMessage: Message, course: Course | undefined): {
  points: number;
  score: Record<string, HoleScore>;
} {
  const score: Record<string, HoleScore> = {};
  logInfo("Calculating score for user", { userId, courseMessageId: courseMessage.id, course: courseMessage.content });
  for (const message of messages) {
    if (message.author.id !== userId) continue;
    // The round-start message itself may carry the author's scores below the course name
    const isRoundStart = message.id === courseMessage.id;
    if (!isRoundStart) {
      if (message.createdTimestamp <= courseMessage.createdTimestamp) continue;
      if (courseNameFrom(courses, message.content) !== undefined) continue;
    }

    const messageLines = message.content.split("\n");
    for (const line of isRoundStart ? messageLines.slice(1) : messageLines) {
      const parsed = parseScoreLine(line);
      if (!parsed) continue;
      score[parsed.holeId] = parsed.points;
      logInfo("Parsed score line", { messageId: message.id, hole: parsed.holeId, points: parsed.points });
    }
  }

  const points = Object.entries(score).reduce((sum, [holeId, holeScore]) => sum + (holeScoreValue(course, holeId, holeScore) ?? 0), 0);
  logInfo("Finished calculating user score", { userId, totalPoints: points, entries: score });
  return { points, score };
}

/** Folds the round's full-course results into the record message; returns the new course best if one was set. */
async function updateCourseRecords(course: Course, courseMessage: Message, results: { memberId: string; score: Record<string, HoleScore> }[]): Promise<RecordEntry | undefined> {
  const roundDate = new Date(courseMessage.createdTimestamp).toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
  const eligible: RecordEntry[] = results
    .map(({ memberId, score }) => ({ userId: memberId, points: courseTotal(course, score), date: roundDate }))
    .filter((entry): entry is RecordEntry => entry.points !== undefined);

  const recordMessage = await fetchRecordMessage();
  const records = parseRecords(recordMessage.content);
  const { improved, newCourseBest } = applyRoundResults(records, course.name, eligible);
  // Edited on every /räkna, improved or not - "Senast uppdaterad" doubles as proof
  // that the latest count verified the records
  await renderRecordMessage(recordMessage, records);
  logInfo("Updated record message", { course: course.name, eligibleCount: eligible.length, improved, newBest: newCourseBest?.points });
  return newCourseBest;
}

/** Re-renders the record message in place: current signatures, formatting, and timestamp. */
async function formatera(interaction: ChatInputCommandInteraction) {
  logInfo("formatera command started", { userId: interaction.user.id, interactionId: interaction.id });
  const recordMessage = await fetchRecordMessage();
  const records = parseRecords(recordMessage.content);
  await renderRecordMessage(recordMessage, records);
  logInfo("formatera command finished", { interactionId: interaction.id });
  await interaction.reply({ content: "Banrekord-meddelandet har formaterats om.", flags: MessageFlags.Ephemeral });
}

async function fetchRecordMessage(): Promise<Message> {
  const recordChannel = await discordClient.channels.fetch(DISCGOLF_RECORD_CHANNEL_ID);
  if (!recordChannel?.isTextBased()) throw new Error("Record channel not found or is not text-based");
  // force skips the message cache - the bot gets no reaction gateway events, so a
  // cached copy would keep the reaction (signature) state from when it was first fetched
  return await recordChannel.messages.fetch({ message: DISCGOLF_RECORD_MESSAGE_ID, force: true });
}

async function renderRecordMessage(recordMessage: Message, records: CourseRecords): Promise<void> {
  const signatures = await signaturesFromReactions(recordMessage);
  await recordMessage.edit(formatRecords(records, signatures, new Date()));
}

/** Each player's signature emoji is their own reaction on the record message; their first reaction wins. */
async function signaturesFromReactions(message: Message): Promise<Record<string, string>> {
  const signatures: Record<string, string> = {};
  for (const reaction of message.reactions.cache.values()) {
    const emoji = reaction.emoji.toString();
    const users = await reaction.users.fetch();
    for (const user of users.values()) {
      if (user.bot) continue;
      signatures[user.id] ??= emoji;
    }
  }
  return signatures;
}

function formatScoreSuffix(course: Course | undefined, score: Record<string, HoleScore>): string {
  const parts: string[] = [];
  if (course) parts.push(formatRelative(relativeToPar(course, score)));
  const dnfHoles = Object.entries(score).filter(([, points]) => points === "dnf").map(([hole]) => hole);
  if (dnfHoles.length > 0) parts.push(`DNF: ${dnfHoles.join(", ")}`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}