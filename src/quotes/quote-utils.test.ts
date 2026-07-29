import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getTimestampFromDiscordLink,
  splitCustomQuoteMeta,
  stripCustomQuoteMeta,
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

await test("getTimestampFromDiscordLink returns null for invalid link", () => {
  assert.equal(getTimestampFromDiscordLink("https://discord.com/channels/1/2/not-a-snowflake"), null);
});

await test("getTimestampFromDiscordLink derives timestamp from snowflake", () => {
  const link = "https://discord.com/channels/1/2/175928847299117063";
  const expected = Number((BigInt("175928847299117063") >> 22n) + 1420070400000n);
  assert.equal(getTimestampFromDiscordLink(link), expected);
});
