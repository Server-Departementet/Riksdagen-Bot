import assert from "node:assert/strict";
import { test } from "node:test";
import { filterNearDuplicatePlays, PLAY_DEDUPE_TOLERANCE_MS } from "./play-dedupe";

const play = (trackId: string, iso: string) => ({ trackId, playedAt: new Date(iso) });

await test("drops a play whose stored twin is seconds off", () => {
  // Takeout import wrote 12:00:07, the API reports the same play as 12:00:03
  const candidates = [play("track-a", "2026-08-01T12:00:03.000Z")];
  const existing = [play("track-a", "2026-08-01T12:00:07.000Z")];

  assert.deepEqual(filterNearDuplicatePlays(candidates, existing), []);
});

await test("drops an exact match", () => {
  const candidates = [play("track-a", "2026-08-01T12:00:03.000Z")];

  assert.deepEqual(filterNearDuplicatePlays(candidates, candidates), []);
});

await test("keeps a play of the same track outside the tolerance", () => {
  const candidates = [play("track-a", "2026-08-01T12:05:00.000Z")];
  const existing = [play("track-a", "2026-08-01T12:00:00.000Z")];

  assert.deepEqual(filterNearDuplicatePlays(candidates, existing), candidates);
});

await test("keeps a nearby play of a different track", () => {
  const candidates = [play("track-b", "2026-08-01T12:00:03.000Z")];
  const existing = [play("track-a", "2026-08-01T12:00:03.000Z")];

  assert.deepEqual(filterNearDuplicatePlays(candidates, existing), candidates);
});

await test("tolerance bounds are inclusive", () => {
  const base = Date.parse("2026-08-01T12:00:00.000Z");
  const candidates = [
    { trackId: "track-a", playedAt: new Date(base + PLAY_DEDUPE_TOLERANCE_MS) },
    { trackId: "track-a", playedAt: new Date(base + PLAY_DEDUPE_TOLERANCE_MS + 1) },
  ];
  const existing = [{ trackId: "track-a", playedAt: new Date(base) }];

  assert.deepEqual(filterNearDuplicatePlays(candidates, existing), [candidates[1]]);
});

await test("keeps extra fields on surviving candidates", () => {
  const candidates = [{ ...play("track-a", "2026-08-01T12:00:00.000Z"), userId: "user-1" }];

  assert.deepEqual(filterNearDuplicatePlays(candidates, []), candidates);
});
