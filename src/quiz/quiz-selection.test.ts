import assert from "node:assert/strict";
import { test } from "node:test";
import type { Quote } from "../quotes/types";
import {
  buildPollAnswers,
  collectExternalQuotees,
  findCorrectAnswer,
  pickQuizQuote,
  quizConfig,
  roundKindFor,
  shouldHideSenderHint,
  weightedSample,
} from "./quiz-selection";

let nextId = 1;
function quote(overrides: Partial<Quote> & Pick<Quote, "quotee">): Quote {
  const id = String(nextId++);
  return {
    id,
    authorId: "sender-1",
    createdTimestamp: 0,
    link: `https://discord.com/channels/1/2/${id}`,
    sender: "Vena S.",
    body: `"Quote ${id}"`,
    ...overrides,
  };
}

const users = {
  "m1": { id: "m1", name: "Vena S." },
  "m2": { id: "m2", name: "Axel Thornberg" },
  "m3": { id: "m3", name: "Emil S. Winroth" },
};

function corpus(): Quote[] {
  return [
    quote({ quotee: "Vena", quoteeId: "m1" }),
    quote({ quotee: "Axel", quoteeId: "m2" }),
    quote({ quotee: "Ulf", quoteeKey: "ulf", authorId: "m2" }),
    quote({ quotee: "Ulf", quoteeKey: "ulf", authorId: "m3" }),
    quote({ quotee: "ulf", quoteeKey: "ulf", authorId: "m3" }),
    quote({ quotee: "Kasper", quoteeKey: "kasper", authorId: "m2" }),
    quote({ quotee: "Kasper", quoteeKey: "kasper", authorId: "m2" }),
    quote({ quotee: "Kasper", quoteeKey: "kasper", authorId: "m2" }),
    quote({ quotee: "Kasper", quoteeKey: "kasper", authorId: "m2" }),
    quote({ quotee: "Venas mamma", quoteeKey: "venas mamma", authorId: "m1" }),
    quote({ quotee: "Venas mamma", quoteeKey: "venas mamma", authorId: "m3" }),
    quote({ quotee: "Venas mamma", quoteeKey: "venas mamma", authorId: "m3" }),
    quote({ quotee: "Lisa", quoteeKey: "lisa", authorId: "m2" }), // one quote: below threshold
    quote({ quotee: "Okänd", quoteeKey: "okänd" }),
    quote({ quotee: "Okänd", quoteeKey: "okänd" }),
    quote({ quotee: "Okänd", quoteeKey: "okänd" }),
  ];
}

/** Deterministic "random" that walks the given sequence. */
function sequence(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

await test("collectExternalQuotees keeps recurring non-ministers only", () => {
  const externals = collectExternalQuotees(corpus());

  assert.deepEqual([...externals.keys()].sort(), ["kasper", "ulf", "venas mamma"]);
  const ulf = externals.get("ulf");
  assert.equal(ulf?.count, 3);
  assert.equal(ulf?.displayName, "Ulf"); // the most common spelling
  assert.deepEqual([...ulf?.spellings ?? []].sort(), ["Ulf", "ulf"]);
  assert.deepEqual([...ulf?.senders ?? []].sort(), ["m2", "m3"]);
});

await test("roundKindFor classifies ministers, eligible externals and the rest", () => {
  const externals = collectExternalQuotees(corpus());

  assert.equal(roundKindFor(quote({ quotee: "Vena", quoteeId: "m1" }), externals), "minister");
  assert.equal(roundKindFor(quote({ quotee: "Ulf", quoteeKey: "ulf" }), externals), "external");
  assert.equal(roundKindFor(quote({ quotee: "Lisa", quoteeKey: "lisa" }), externals), null);
  assert.equal(roundKindFor(quote({ quotee: "Okänd", quoteeKey: "okänd" }), externals), null);
});

await test("pickQuizQuote honours the round weight and falls back to the other pool", () => {
  const all = corpus();
  const externals = collectExternalQuotees(all);

  const external = pickQuizQuote(all, externals, { random: sequence([0.1, 0, 0]) });
  assert.equal(external?.kind, "external");
  assert.ok(external?.quote.quoteeKey);

  const minister = pickQuizQuote(all, externals, { random: sequence([0.9, 0, 0]) });
  assert.equal(minister?.kind, "minister");
  assert.ok(minister?.quote.quoteeId);

  const onlyMinisters = all.filter(q => q.quoteeId);
  const forced = pickQuizQuote(onlyMinisters, externals, { forceKind: "external" });
  assert.equal(forced, null);
  const fallback = pickQuizQuote(onlyMinisters, externals, { random: sequence([0.1]) });
  assert.equal(fallback?.kind, "minister");

  const onlyExternals = all.filter(q => !q.quoteeId);
  const fallbackExternal = pickQuizQuote(onlyExternals, externals, { random: sequence([0.9]) });
  assert.equal(fallbackExternal?.kind, "external");
});

await test("buildPollAnswers lists every minister in a minister round", () => {
  const externals = collectExternalQuotees(corpus());
  const answers = buildPollAnswers("minister", quote({ quotee: "Vena", quoteeId: "m1" }), externals, users);

  assert.deepEqual(answers, ["Axel Thornberg", "Emil S. Winroth", "Vena S."]);
});

await test("buildPollAnswers mixes the correct external with distractors and ministers", () => {
  const externals = collectExternalQuotees(corpus());
  const target = quote({ quotee: "ulf", quoteeKey: "ulf" });
  const answers = buildPollAnswers("external", target, externals, users, { random: sequence([0.5]) });

  assert.ok(answers.includes("Ulf"), "uses the canonical spelling, not the quote's");
  assert.ok(answers.includes("Kasper"));
  assert.ok(answers.includes("Venas mamma"));
  for (const minister of Object.values(users)) assert.ok(answers.includes(minister.name));
  assert.ok(!answers.includes("Lisa"), "sub-threshold externals are never distractors");
  assert.deepEqual(answers, [...answers].sort((a, b) => a.localeCompare(b, "sv")));
  assert.ok(answers.length <= quizConfig.pollMaxAnswers);
});

await test("buildPollAnswers never exceeds the poll cap or repeats a name", () => {
  const many: Quote[] = [];
  for (let i = 0; i < 30; i++) {
    for (let j = 0; j < 3; j++) many.push(quote({ quotee: `Person ${i}`, quoteeKey: `person ${i}` }));
  }
  const manyUsers = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`u${i}`, { id: `u${i}`, name: `Minister ${i}` }]));
  const externals = collectExternalQuotees(many);
  const target = many[0];
  assert.ok(target);

  const answers = buildPollAnswers("external", target, externals, manyUsers, { random: sequence([0.3, 0.7, 0.1]) });
  assert.equal(answers.length, quizConfig.pollMaxAnswers);
  assert.equal(new Set(answers).size, answers.length);
  assert.ok(answers.includes("Person 0"));
});

await test("findCorrectAnswer matches ministers by name and externals by any spelling", () => {
  const externals = collectExternalQuotees(corpus());
  const answers = [{ text: "Axel Thornberg" }, { text: "Ulf" }, { text: "Kasper" }, { text: null }];

  assert.equal(findCorrectAnswer(quote({ quotee: "Axel", quoteeId: "m2" }), answers, externals, users)?.text, "Axel Thornberg");
  assert.equal(findCorrectAnswer(quote({ quotee: "ulf", quoteeKey: "ulf" }), answers, externals, users)?.text, "Ulf");
  assert.equal(findCorrectAnswer(quote({ quotee: "Lisa", quoteeKey: "lisa" }), answers, externals, users), undefined);
});

await test("shouldHideSenderHint hides single-sender and self-referencing externals", () => {
  const externals = collectExternalQuotees(corpus());

  // Kasper is only ever quoted by m2
  assert.equal(shouldHideSenderHint("external", quote({ quotee: "Kasper", quoteeKey: "kasper", authorId: "m2", sender: "Axel Thornberg" }), externals, ["Axel"]), true);
  // Ulf has several senders and no name overlap
  assert.equal(shouldHideSenderHint("external", quote({ quotee: "Ulf", quoteeKey: "ulf", authorId: "m3", sender: "Emil S. Winroth" }), externals, ["Winroth"]), false);
  // "Venas mamma" posted by Vena spells out the answer
  assert.equal(shouldHideSenderHint("external", quote({ quotee: "Venas mamma", quoteeKey: "venas mamma", authorId: "m1", sender: "Vena S." }), externals, ["Vena"]), true);
  // ...but not when someone else posted it
  assert.equal(shouldHideSenderHint("external", quote({ quotee: "Venas mamma", quoteeKey: "venas mamma", authorId: "m3", sender: "Emil S. Winroth" }), externals, ["Winroth"]), false);
  // Minister rounds keep the hint
  assert.equal(shouldHideSenderHint("minister", quote({ quotee: "Vena", quoteeId: "m1" }), externals, ["Vena"]), false);
});

await test("weightedSample returns distinct items and respects the count", () => {
  const items = [{ n: "a", w: 1 }, { n: "b", w: 100 }, { n: "c", w: 1 }];
  const picked = weightedSample(items, i => i.w, 2, sequence([0.5, 0.5]));

  assert.equal(picked.length, 2);
  assert.equal(picked[0]?.n, "b", "the heavy item wins a mid roll");
  assert.equal(new Set(picked).size, 2);
  assert.deepEqual(weightedSample(items, i => i.w, 10, Math.random).length, 3);
});
