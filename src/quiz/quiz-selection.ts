import type { Quote } from "../quotes/types";

/*
 * Pure helpers behind the quiz's quote selection and poll construction. Ministers are
 * quizzed exactly as before (every minister is a poll option). Quotes about other
 * recurring people — "externals", grouped by Quote.quoteeKey — get a dynamic option
 * list: the right name plus distractors, since a Discord poll holds at most 10 answers.
 */

export const quizConfig = {
  /** Externals need at least this many quotes to be quizzed about at all. */
  externalMinQuotes: 3,
  /** Chance that a round is about an external rather than a minister. */
  externalRoundWeight: 0.3,
  /** Discord's hard cap on poll answers. */
  pollMaxAnswers: 10,
  /** Distractors drawn from other externals in an external round; ministers fill the rest. */
  externalDistractors: 5,
  /** Discord's cap on poll answer text length. */
  pollAnswerMaxLength: 55,
  /** Quotee keys that are placeholders rather than people. */
  excludedQuoteeKeys: new Set(["okänd", "okänt", "person", "någon"]),
};

export type QuizRoundKind = "minister" | "external";

export type ExternalQuotee = {
  key: string;
  /** Most common spelling, used as the poll answer text. */
  displayName: string;
  /** Every spelling seen in the database, for matching poll answers back to a quote. */
  spellings: Set<string>;
  count: number;
  /** Everyone who has posted a quote by this person. */
  senders: Set<string>;
};

export type UserLike = { id: string; name?: string | null };

/** Group the non-minister quotes by quoteeKey and keep the recurring characters. */
export function collectExternalQuotees(
  quotes: Quote[],
  config: Pick<typeof quizConfig, "externalMinQuotes" | "excludedQuoteeKeys"> = quizConfig,
): Map<string, ExternalQuotee> {
  const spellingCounts = new Map<string, Map<string, number>>();
  const senders = new Map<string, Set<string>>();

  for (const quote of quotes) {
    if (quote.quoteeId || !quote.quoteeKey) continue;
    if (config.excludedQuoteeKeys.has(quote.quoteeKey)) continue;

    const counts = spellingCounts.get(quote.quoteeKey) ?? new Map<string, number>();
    counts.set(quote.quotee, (counts.get(quote.quotee) ?? 0) + 1);
    spellingCounts.set(quote.quoteeKey, counts);

    const senderSet = senders.get(quote.quoteeKey) ?? new Set<string>();
    senderSet.add(quote.authorId);
    senders.set(quote.quoteeKey, senderSet);
  }

  const externals = new Map<string, ExternalQuotee>();
  for (const [key, counts] of spellingCounts) {
    const count = [...counts.values()].reduce((a, b) => a + b, 0);
    if (count < config.externalMinQuotes) continue;

    const [displayName] = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "sv"))[0] ?? [key];
    externals.set(key, {
      key,
      displayName,
      spellings: new Set(counts.keys()),
      count,
      senders: senders.get(key) ?? new Set(),
    });
  }
  return externals;
}

/** Which kind of round a quote belongs to, or null when it can't be quizzed. */
export function roundKindFor(quote: Quote, externals: Map<string, ExternalQuotee>): QuizRoundKind | null {
  if (quote.quoteeId) return "minister";
  if (quote.quoteeKey && externals.has(quote.quoteeKey)) return "external";
  return null;
}

/**
 * Pick the next quiz quote: choose the round kind by weight (falling back to whichever
 * pool still has quotes), then a quotee uniformly within that pool, then one of their
 * quotes. Uniform-per-quotee keeps the ministers with few quotes in rotation.
 */
export function pickQuizQuote(
  available: Quote[],
  externals: Map<string, ExternalQuotee>,
  options: { forceKind?: QuizRoundKind; random?: () => number; config?: Pick<typeof quizConfig, "externalRoundWeight"> } = {},
): { quote: Quote; kind: QuizRoundKind } | null {
  const random = options.random ?? Math.random;
  const config = options.config ?? quizConfig;

  const ministerQuotes = available.filter(q => roundKindFor(q, externals) === "minister");
  const externalQuotes = available.filter(q => roundKindFor(q, externals) === "external");

  let kind: QuizRoundKind;
  if (options.forceKind) {
    kind = options.forceKind;
  }
  else if (externalQuotes.length && (ministerQuotes.length === 0 || random() < config.externalRoundWeight)) {
    kind = "external";
  }
  else {
    kind = "minister";
  }

  const pool = kind === "minister" ? ministerQuotes : externalQuotes;
  if (pool.length === 0) return null;

  const groupOf = (q: Quote) => (kind === "minister" ? q.quoteeId : q.quoteeKey) ?? "";
  const groups = [...new Set(pool.map(groupOf))];
  const group = groups[Math.floor(random() * groups.length)];
  const candidates = pool.filter(q => groupOf(q) === group);
  const quote = candidates[Math.floor(random() * candidates.length)];
  return quote ? { quote, kind } : null;
}

/** Poll answer texts, alphabetical so the position never hints at the answer. */
export function buildPollAnswers(
  kind: QuizRoundKind,
  quote: Quote,
  externals: Map<string, ExternalQuotee>,
  users: Record<string, UserLike>,
  options: { random?: () => number; config?: typeof quizConfig } = {},
): string[] {
  const random = options.random ?? Math.random;
  const config = options.config ?? quizConfig;
  const ministerNames = Object.values(users).map(u => u.name ?? "FEL");

  let answers: string[];
  if (kind === "minister") {
    answers = ministerNames;
  }
  else {
    const correct = quote.quoteeKey ? externals.get(quote.quoteeKey) : undefined;
    if (!correct) throw new Error(`Quote ${quote.id} is not about a known external quotee`);

    const others = [...externals.values()].filter(e => e.key !== correct.key);
    const distractors = weightedSample(others, e => e.count, config.externalDistractors, random)
      .map(e => e.displayName);

    const ministerSlots = Math.max(0, config.pollMaxAnswers - 1 - distractors.length);
    const ministers = weightedSample(ministerNames, () => 1, ministerSlots, random);

    answers = [correct.displayName, ...distractors, ...ministers];
  }

  return [...new Set(answers.map(a => a.slice(0, config.pollAnswerMaxLength)))]
    .sort((a, b) => a.localeCompare(b, "sv"))
    .slice(0, config.pollMaxAnswers);
}

/** Find the poll answer that names the quote's quotee, whichever spelling was used. */
export function findCorrectAnswer<T extends { text: string | null }>(
  quote: Quote,
  answers: Iterable<T>,
  externals: Map<string, ExternalQuotee>,
  users: Record<string, UserLike>,
): T | undefined {
  const accepted = new Set<string>();
  if (quote.quoteeId) {
    const name = users[quote.quoteeId]?.name;
    if (name) accepted.add(name);
  }
  else {
    accepted.add(quote.quotee);
    const external = quote.quoteeKey ? externals.get(quote.quoteeKey) : undefined;
    for (const spelling of external?.spellings ?? []) accepted.add(spelling);
  }

  for (const answer of answers) {
    if (answer.text && accepted.has(answer.text)) return answer;
  }
  return undefined;
}

/**
 * The "written by" hint gives an external round away when only one person ever quotes
 * them, or when the quotee is named after the sender ("Venas mamma", posted by Vena).
 */
export function shouldHideSenderHint(
  kind: QuizRoundKind,
  quote: Quote,
  externals: Map<string, ExternalQuotee>,
  senderVariants: string[],
): boolean {
  if (kind !== "external") return false;

  const external = quote.quoteeKey ? externals.get(quote.quoteeKey) : undefined;
  if (external && external.senders.size <= 1) return true;

  const quotee = quote.quotee.toLowerCase();
  const names = [...senderVariants, quote.sender.split(/\s+/)[0] ?? ""]
    .map(n => n.trim().toLowerCase())
    .filter(n => n.length >= 3);
  return names.some(n => quotee.includes(n));
}

/** Sample up to `count` distinct items, each draw proportional to its weight. */
export function weightedSample<T>(items: T[], weightOf: (item: T) => number, count: number, random: () => number): T[] {
  const remaining = [...items];
  const picked: T[] = [];
  while (picked.length < count && remaining.length) {
    const total = remaining.reduce((sum, item) => sum + weightOf(item), 0);
    let roll = random() * total;
    let index = remaining.findIndex(item => (roll -= weightOf(item)) < 0);
    if (index === -1) index = remaining.length - 1;
    picked.push(...remaining.splice(index, 1));
  }
  return picked;
}
