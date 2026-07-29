import assert from "node:assert/strict";
import { test } from "node:test";
import type { CourseRecords } from "./records";
import { applyRoundResults, formatRecords, parseRecords } from "./records";

await test("formatRecords and parseRecords round-trip", () => {
  const records: CourseRecords = [
    {
      course: "rosendal",
      entries: [
        { userId: "2", points: 43, date: "2026-06-15" },
        { userId: "1", points: 41, date: "2026-07-20" },
      ],
    },
    { course: "domarringen", entries: [{ userId: "3", points: 36, date: "2026-07-27" }] },
  ];

  const content = formatRecords(records);
  assert.equal(content, [
    "## Banrekord",
    "-# Uppdateras automatiskt vid /räkna",
    "",
    "### domarringen",
    "`36` <@3> 2026-07-27",
    "### rosendal",
    "`41` <@1> 2026-07-20",
    "`43` <@2> 2026-06-15",
  ].join("\n"));

  assert.deepEqual(parseRecords(content), [
    { course: "domarringen", entries: [{ userId: "3", points: 36, date: "2026-07-27" }] },
    {
      course: "rosendal",
      entries: [
        { userId: "1", points: 41, date: "2026-07-20" },
        { userId: "2", points: 43, date: "2026-06-15" },
      ],
    },
  ]);
});

await test("parseRecords of the seed message is empty", () => {
  assert.deepEqual(parseRecords("uwu <3"), []);
});

await test("applyRoundResults keeps personal bests and reports a new course best", () => {
  const records: CourseRecords = [];

  // First round on a course sets the record
  const first = applyRoundResults(records, "rosendal", [
    { userId: "1", points: 45, date: "2026-06-14" },
    { userId: "2", points: 43, date: "2026-06-14" },
  ]);
  assert.equal(first.improved, true);
  assert.deepEqual(first.newCourseBest, { userId: "2", points: 43, date: "2026-06-14" });

  // Worse or equal results change nothing
  const worse = applyRoundResults(records, "rosendal", [{ userId: "1", points: 45, date: "2026-07-01" }]);
  assert.equal(worse.improved, false);
  assert.equal(worse.newCourseBest, undefined);

  // A personal best that doesn't beat the course record improves silently
  const personal = applyRoundResults(records, "rosendal", [{ userId: "1", points: 44, date: "2026-07-10" }]);
  assert.equal(personal.improved, true);
  assert.equal(personal.newCourseBest, undefined);

  // Beating the course record is reported; the section adopts the caller's casing
  const best = applyRoundResults(records, "Rosendal", [{ userId: "1", points: 41, date: "2026-07-20" }]);
  assert.deepEqual(best.newCourseBest, { userId: "1", points: 41, date: "2026-07-20" });

  assert.deepEqual(records, [{
    course: "Rosendal",
    entries: [
      { userId: "1", points: 41, date: "2026-07-20" },
      { userId: "2", points: 43, date: "2026-06-14" },
    ],
  }]);
});
