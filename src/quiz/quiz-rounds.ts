import type { Message } from "discord.js";
import type { PrismaClient } from "@/lib/prisma/generated/client";
import type { QuizRoundKind } from "./quiz-selection";

/*
 * Reading quiz rounds back out of the quiz channel and storing them as QuizRound/QuizVote
 * rows. quiz.ts records each round as it goes; backfill.ts rebuilds them all from the
 * channel history, so the channel doubles as the backup of the quiz tables.
 */

export type PollOptionVotes = { text: string; voterIds: string[] };

export type QuizRoundRecord = {
  number: number;
  messageId: string;
  quoteId: string;
  kind: QuizRoundKind;
  options: string[];
  postedAt: Date;
  /** Present once the results are posted; the votes are only stored for closed rounds. */
  result?: {
    messageId: string;
    closedAt: Date;
    correctAnswer: string;
    votes: { userId: string; answer: string }[];
  };
};

/** "# Citat Quiz #12 ... -# *id: 123*" → the round number and quote id. */
export function parseQuizQuestion(content: string): { number: number; quoteId: string } | null {
  const number = /^# citat quiz #(\d+)/i.exec(content)?.[1];
  const quoteId = /id: (\d+)/.exec(content)?.[1];
  return number && quoteId ? { number: Number(number), quoteId } : null;
}

/** "## Citat Quiz #12 Resultat ... Grattis till <@1> <@2>" → the round number and winners. */
export function parseQuizResult(content: string): { number: number; winnerIds: string[] } | null {
  const number = /^## citat quiz #(\d+) resultat/i.exec(content)?.[1];
  if (!number) return null;
  return { number: Number(number), winnerIds: [...content.matchAll(/<@(\d+)>/g)].map(m => m[1] ?? "") };
}

/**
 * Work out which poll option was the right one. The announced winners are what the
 * scoreboard counted, so the option whose voters are exactly the winners wins; the
 * answer derived from the quote is the fallback when nobody guessed right (or the quote
 * has since been deleted, in which case only the winners can tell).
 */
export function resolveCorrectAnswer(
  options: PollOptionVotes[],
  winnerIds: string[],
  quoteAnswer: string | undefined,
): { answer: string | null; warning?: string } {
  if (winnerIds.length) {
    const winners = new Set(winnerIds);
    const matches = options.filter(o => o.voterIds.length === winners.size && o.voterIds.every(id => winners.has(id)));
    if (matches.length === 1 && matches[0]) {
      const answer = matches[0].text;
      return quoteAnswer && quoteAnswer !== answer
        ? { answer, warning: `winners voted "${answer}" but the quote says "${quoteAnswer}"` }
        : { answer };
    }
    if (quoteAnswer) return { answer: quoteAnswer, warning: "no option's voters match the announced winners" };
    return { answer: null, warning: "no option's voters match the announced winners and the quote is unknown" };
  }
  return quoteAnswer ? { answer: quoteAnswer } : { answer: null, warning: "nobody won and the quote is unknown" };
}

/** Every option of a poll with the ids of everyone who picked it. */
export async function fetchPollVotes(message: Message): Promise<PollOptionVotes[]> {
  if (!message.poll) throw new Error(`Message ${message.id} has no poll`);
  const options: PollOptionVotes[] = [];
  for (const answer of message.poll.answers.values()) {
    const voterIds: string[] = [];
    // Answers with no votes are skipped to spare the rate limit
    while (voterIds.length < answer.voteCount) {
      const page = await answer.voters.fetch({ limit: 100, after: voterIds.at(-1) });
      if (!page.size) break;
      voterIds.push(...page.keys());
    }
    options.push({ text: answer.text ?? "", voterIds });
  }
  return options;
}

export function votesFrom(options: PollOptionVotes[]): { userId: string; answer: string }[] {
  return options.flatMap(o => o.voterIds.map(userId => ({ userId, answer: o.text })));
}

/** Upsert a round; a closed round's votes replace whatever was stored before. */
export async function saveQuizRound(prisma: PrismaClient, round: QuizRoundRecord): Promise<void> {
  const data = {
    messageId: round.messageId,
    quoteId: round.quoteId,
    kind: round.kind,
    options: round.options,
    postedAt: round.postedAt,
    ...round.result
      ? {
        resultMessageId: round.result.messageId,
        correctAnswer: round.result.correctAnswer,
        closedAt: round.result.closedAt,
      }
      : {},
  };
  const upsert = prisma.quizRound.upsert({
    where: { number: round.number },
    create: { number: round.number, ...data },
    update: data,
  });
  if (!round.result) {
    await upsert;
    return;
  }

  const { correctAnswer, votes } = round.result;
  await prisma.$transaction([
    upsert,
    prisma.quizVote.deleteMany({ where: { roundNumber: round.number } }),
    prisma.quizVote.createMany({
      data: votes.map(v => ({ roundNumber: round.number, ...v, correct: v.answer === correctAnswer })),
    }),
  ]);
}
