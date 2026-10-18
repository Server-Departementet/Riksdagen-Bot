import assert from "node:assert/strict";
import { test } from "node:test";
import { parseQuizQuestion, parseQuizResult, resolveCorrectAnswer, votesFrom } from "./quiz-rounds";

const options = [
  { text: "Vena S.", voterIds: ["a", "b"] },
  { text: "Arvid", voterIds: ["c"] },
  { text: "Ulf", voterIds: [] },
];

await test("parses a quiz question", () => {
  const content = "# Citat Quiz #131\nVem sa?\n> \"Vadå spammar?\"\n\n-# *id: 1289616885851099136*";
  assert.deepEqual(parseQuizQuestion(content), { number: 131, quoteId: "1289616885851099136" });
  assert.equal(parseQuizQuestion("# Citat Quiz Scoreboard #0-130"), null);
});

await test("parses a quiz result with and without winners", () => {
  assert.deepEqual(
    parseQuizResult("## Citat Quiz #7 Resultat\n\n## Vena\n> hej\n\nGrattis till <@1> <@22> som gissade rätt!"),
    { number: 7, winnerIds: ["1", "22"] },
  );
  assert.deepEqual(parseQuizResult("## Citat Quiz #8 Resultat\n\nGrattis till *ingen...*!"), { number: 8, winnerIds: [] });
  assert.equal(parseQuizResult("# Citat Quiz #8\nVem sa?"), null);
});

await test("the option voted by exactly the winners is correct", () => {
  assert.deepEqual(resolveCorrectAnswer(options, ["b", "a"], undefined), { answer: "Vena S." });
  assert.deepEqual(resolveCorrectAnswer(options, ["c"], "Arvid"), { answer: "Arvid" });
});

await test("the winners beat the quote when they disagree", () => {
  const { answer, warning } = resolveCorrectAnswer(options, ["c"], "Vena S.");
  assert.equal(answer, "Arvid");
  assert.ok(warning);
});

await test("falls back to the quote when nobody won", () => {
  assert.deepEqual(resolveCorrectAnswer(options, [], "Ulf"), { answer: "Ulf" });
  assert.equal(resolveCorrectAnswer(options, [], undefined).answer, null);
});

await test("winners matching no option fall back to the quote", () => {
  assert.equal(resolveCorrectAnswer(options, ["a"], "Vena S.").answer, "Vena S.");
  assert.equal(resolveCorrectAnswer(options, ["a"], undefined).answer, null);
});

await test("flattens poll options into one vote per voter", () => {
  assert.deepEqual(votesFrom(options), [
    { userId: "a", answer: "Vena S." },
    { userId: "b", answer: "Vena S." },
    { userId: "c", answer: "Arvid" },
  ]);
});
