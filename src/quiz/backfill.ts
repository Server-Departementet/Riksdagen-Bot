import "dotenv/config";
import type { Collection, Message } from "discord.js";
import { Client as DiscordClient, GatewayIntentBits, MessageType } from "discord.js";
import { PrismaClient } from "@/lib/prisma/generated/client";
import { makeMariaDBAdapter } from "@/lib/prisma";
import { fromQuoteRow } from "../quotes/quote-db";
import { collectExternalQuotees, findCorrectAnswer } from "./quiz-selection";
import type { QuizRoundRecord } from "./quiz-rounds";
import { syncQuizToWebDatabases } from "./web-sync";
import {
  fetchPollVotes,
  parseQuizQuestion,
  parseQuizResult,
  resolveCorrectAnswer,
  saveQuizRound,
  votesFrom,
} from "./quiz-rounds";

/*
 * Rebuild the QuizRound/QuizVote tables from the quiz channel: every poll, who voted
 * for what, and which option was right. Safe to re-run; each round is upserted and its
 * votes replaced, then the web databases get a fresh copy. This is also the recovery
 * path if the bot database is ever lost.
 *
 *   tsx src/quiz/backfill.ts [--dry-run]
 */

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set in environment variables");
const DATABASE_URL = process.env.DATABASE_URL;
if (!process.env.DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN is not set in environment variables");
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!process.env.REGERINGEN_GUILD_ID) throw new Error("REGERINGEN_GUILD_ID is not set in environment variables");
const REGERINGEN_GUILD_ID = process.env.REGERINGEN_GUILD_ID;
if (!process.env.QUIZ_CHANNEL_ID) throw new Error("QUIZ_CHANNEL_ID is not set in environment variables");
const QUIZ_CHANNEL_ID = process.env.QUIZ_CHANNEL_ID;

const isDryRun = process.argv.includes("--dry-run");

const discordClient = new DiscordClient({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessagePolls],
});
const prisma = new PrismaClient(makeMariaDBAdapter(DATABASE_URL));

main()
  .then(() => {
    console.info("Script finished successfully");
    process.exitCode = 0;
  })
  .catch((err: unknown) => {
    console.error("Script failed with error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await discordClient.destroy();
    await prisma.$disconnect();
  });

async function main() {
  await discordClient.login(DISCORD_BOT_TOKEN);
  const guild = await discordClient.guilds.fetch(REGERINGEN_GUILD_ID);
  const channel = await guild.channels.fetch(QUIZ_CHANNEL_ID);
  if (!channel?.isTextBased()) {
    throw new Error("Quiz channel is missing or not text-based");
  }

  // The whole channel, oldest first
  const messages: Message[] = [];
  let before: string | undefined = undefined;
  for (;;) {
    const page: Collection<string, Message> = await channel.messages.fetch({ limit: 100, before });
    if (!page.size) break;
    messages.push(...page.values());
    before = page.last()?.id;
  }
  messages.reverse();
  console.info(`Fetched ${messages.length} messages from the quiz channel`);

  // The channel history includes quizzes from the previous bot application
  const botMessages = messages.filter(m => m.author.bot && m.type === MessageType.Default);
  const questions = new Map<number, Message>();
  const results = new Map<number, { message: Message; winnerIds: string[] }>();
  for (const message of botMessages) {
    const question = message.poll ? parseQuizQuestion(message.content) : null;
    if (question) {
      if (questions.has(question.number)) console.warn(`Quiz #${question.number} was posted twice, keeping the first`);
      else questions.set(question.number, message);
      continue;
    }
    const result = parseQuizResult(message.content);
    if (result) {
      if (results.has(result.number)) console.warn(`Quiz #${result.number} has two result posts, keeping the first`);
      else results.set(result.number, { message, winnerIds: result.winnerIds });
    }
  }
  console.info(`Found ${questions.size} quiz polls and ${results.size} result posts`);

  const quotes = new Map((await prisma.quote.findMany()).map(row => [row.id, fromQuoteRow(row)]));
  const externals = collectExternalQuotees([...quotes.values()]);
  const users = Object.fromEntries((await prisma.user.findMany()).map(u => [u.id, u]));
  const ministerNames = new Set(Object.values(users).map(u => u.name));

  let saved = 0;
  const problems: string[] = [];
  for (const [number, message] of [...questions].sort((a, b) => a[0] - b[0])) {
    const { quoteId } = parseQuizQuestion(message.content) ?? { quoteId: "" };
    const quote = quotes.get(quoteId);
    const options = [...message.poll?.answers.values() ?? []].map(a => a.text ?? "");

    const round: QuizRoundRecord = {
      number,
      messageId: message.id,
      quoteId,
      kind: quote ? (quote.quoteeId ? "minister" : "external") : "minister",
      options,
      postedAt: message.createdAt,
    };

    const result = results.get(number);
    if (result) {
      const votes = await fetchPollVotes(message);
      const quoteAnswer = quote
        ? findCorrectAnswer(quote, votes, externals, users)?.text
        : undefined;
      const { answer, warning } = resolveCorrectAnswer(votes, result.winnerIds, quoteAnswer);
      if (warning) problems.push(`#${number}: ${warning}`);
      if (answer) {
        // Without the quote, a minister's name as the answer is the only hint of the kind
        if (!quote) round.kind = ministerNames.has(answer) ? "minister" : "external";
        round.result = {
          messageId: result.message.id,
          closedAt: result.message.createdAt,
          correctAnswer: answer,
          votes: votesFrom(votes),
        };
      }
      else {
        problems.push(`#${number}: stored without its result, the correct answer is unknown`);
      }
    }
    if (!quote) problems.push(`#${number}: quote ${quoteId} is not in the database`);

    if (isDryRun) {
      const r = round.result;
      console.info(`#${number} ${round.kind} quote ${quoteId}: ${r ? `"${r.correctAnswer}", ${r.votes.filter(v => v.answer === r.correctAnswer).length}/${r.votes.length} right` : "open"}`);
    }
    else {
      await saveQuizRound(prisma, round);
      saved += 1;
    }
  }

  for (const problem of problems) console.warn(problem);
  console.info(isDryRun
    ? `Dry run, would have saved ${questions.size} rounds`
    : `Saved ${saved} rounds`);

  if (!isDryRun) await syncQuizToWebDatabases(prisma);
}
