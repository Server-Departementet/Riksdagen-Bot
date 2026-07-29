import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getTimestampFromDiscordLink,
  quoteAttributionSplitRegex,
  splitCustomQuoteMeta,
  stripCustomQuoteMeta,
  wordMatchRegex,
} from "./quote-utils";

await test("splitCustomQuoteMeta parses leading metadata", () => {
  const content = `[[{"authorId":"123","link":"https://discord.com/channels/1/2/175928847299117063"}]]\n"Hi" - Vena`;
  const result = splitCustomQuoteMeta(content);

  assert.deepEqual(result.meta, {
    authorId: "123",
    link: "https://discord.com/channels/1/2/175928847299117063",
    createdTimestamp: getTimestampFromDiscordLink("https://discord.com/channels/1/2/175928847299117063") ?? undefined,
  });
  assert.equal(result.content, "\"Hi\" - Vena");
});

await test("splitCustomQuoteMeta treats a blank authorId as unset", () => {
  const content = `[[{"authorId":""}]]\n"Hej" - Axel`;
  const result = splitCustomQuoteMeta(content);

  // An imported quote with no original author has to fall through to whoever posted it here
  assert.equal(result.meta, undefined);
  assert.equal(result.content, "\"Hej\" - Axel");
});

await test("splitCustomQuoteMeta keeps the fields that are actually set", () => {
  const content = `[[{"authorId":"  ","sender":" Vena "}]]\n"Hej" - Axel`;
  const result = splitCustomQuoteMeta(content);

  assert.deepEqual(result.meta, { sender: "Vena" });
});

await test("stripCustomQuoteMeta removes metadata prefix only", () => {
  const content = `[[{"authorId":"123"}]]\n"Hej" - Axel`;
  assert.equal(stripCustomQuoteMeta(content), "\"Hej\" - Axel");
});

await test("quoteAttributionSplitRegex splits attribution for ASCII names", () => {
  const parts = "\"Hej\" - Axel".split(quoteAttributionSplitRegex).map(s => s.trim());
  assert.deepEqual(parts, ["\"Hej\"", "Axel"]);
});

await test("quoteAttributionSplitRegex splits attribution for names starting with non-ASCII letters", () => {
  const parts = "\"Nämen\" - Åsa".split(quoteAttributionSplitRegex).map(s => s.trim());
  assert.deepEqual(parts, ["\"Nämen\"", "Åsa"]);
});

await test("quoteAttributionSplitRegex ignores dashes inside the quote body", () => {
  const parts = "\"Nå - kanske\" - Örjan".split(quoteAttributionSplitRegex).map(s => s.trim());
  assert.deepEqual(parts, ["\"Nå - kanske\"", "Örjan"]);
});

await test("wordMatchRegex matches whole words only, with Unicode boundaries", () => {
  assert.equal("Åsa och jag".replace(wordMatchRegex(["Åsa"]), "Agnes"), "Agnes och jag");
  // "Åsan" contains "Åsa" but is a different word; ASCII \b would have replaced it
  assert.equal("Åsan och jag".replace(wordMatchRegex(["Åsa"]), "Agnes"), "Åsan och jag");
  assert.equal("Viggos mor".replace(wordMatchRegex(["Viggo"]), "Vena"), "Viggos mor");
});

await test("getTimestampFromDiscordLink returns null for invalid link", () => {
  assert.equal(getTimestampFromDiscordLink("https://discord.com/channels/1/2/not-a-snowflake"), null);
});

await test("getTimestampFromDiscordLink derives timestamp from snowflake", () => {
  const link = "https://discord.com/channels/1/2/175928847299117063";
  const expected = Number((BigInt("175928847299117063") >> 22n) + 1420070400000n);
  assert.equal(getTimestampFromDiscordLink(link), expected);
});
