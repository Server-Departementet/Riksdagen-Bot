import assert from "node:assert/strict";
import { test } from "node:test";
import type { CourseRecords } from "./records";
import { applyRoundResults, formatCourseSection, formatRecordsHeader, parseRecords } from "./records";

await test("formatRecordsHeader stamps the update time", () => {
  assert.equal(formatRecordsHeader(new Date("2026-07-29T12:34:00+02:00")), [
    "## Rekord",
    "-# Uppdateras automatiskt vid /räkna",
    "-# Reagera på det här meddelandet — din reaktion blir din signatur-emoji i listorna",
    "-# Senast uppdaterad 2026-07-29 12:34",
  ].join("\n"));
});

await test("formatCourseSection and parseRecords round-trip, with signatures and links", () => {
  const section: CourseRecords[number] = {
    course: "Rosendal",
    entries: [
      { userId: "2", points: 43, date: "2026-06-15" },
      { userId: "1", points: 41, date: "2026-07-20", link: "https://discord.com/channels/1/2/3" },
    ],
  };

  // User 2 has no signature - the emoji is simply omitted. A linked date renders masked.
  const content = formatCourseSection(section, { "1": "🩷" });
  assert.equal(content, [
    "### Rosendal",
    "`41` 🩷 <@1> [2026-07-20](https://discord.com/channels/1/2/3)",
    "`43` <@2> 2026-06-15",
  ].join("\n"));

  assert.deepEqual(parseRecords(content), [{
    course: "Rosendal",
    entries: [
      { userId: "1", points: 41, date: "2026-07-20", link: "https://discord.com/channels/1/2/3" },
      { userId: "2", points: 43, date: "2026-06-15" },
    ],
  }]);
});

await test("parseRecords of the seed message is empty", () => {
  assert.deepEqual(parseRecords("uwu <3"), []);
});

await test("parseRecords of the index message is empty", () => {
  assert.deepEqual(parseRecords(formatRecordsHeader(new Date("2026-07-29T12:00:00+02:00"))), []);
});

await test("formatCourseSection puts the oldest score on top in a tie", () => {
  const section: CourseRecords[number] = {
    course: "Rosendal",
    entries: [
      { userId: "2", points: 42, date: "2026-07-24" },
      { userId: "1", points: 42, date: "2026-07-20" },
    ],
  };

  const tieLines = formatCourseSection(section, {}).split("\n").filter((line) => line.startsWith("`42`"));
  assert.deepEqual(tieLines, [
    "`42` <@1> 2026-07-20",
    "`42` <@2> 2026-07-24",
  ]);
});

await test("record flags render, round-trip, and survive reformatting", () => {
  const records: CourseRecords = [{
    course: "Rosendal",
    entries: [
      { userId: "1", points: 41, date: "2026-07-20", flag: "rekord" },
      { userId: "2", points: 43, date: "2026-06-15", flag: "pr" },
    ],
  }];

  const content = formatCourseSection(records[0] as CourseRecords[number], {});
  assert.ok(content.includes("`41` <@1> 2026-07-20 [Rekord!! 🥳]"));
  assert.ok(content.includes("`43` <@2> 2026-06-15 [PR 🎉]"));
  // parse → format (what /formatera does) must not lose or move flags
  assert.deepEqual(parseRecords(content), records);
});

await test("a count without score changes leaves existing flags untouched", () => {
  const records: CourseRecords = [{
    course: "Rosendal",
    entries: [{ userId: "1", points: 41, date: "2026-07-20", flag: "rekord" }],
  }];

  const result = applyRoundResults(records, "Rosendal", [{ userId: "1", points: 41, date: "2026-07-29" }]);
  assert.equal(result.improved, false);
  assert.equal(records[0]?.entries[0]?.flag, "rekord");
});

await test("a new score sinks the course to the bottom of the board", () => {
  const records: CourseRecords = [
    { course: "Rosendal", entries: [{ userId: "1", points: 41, date: "2026-07-20" }] },
    { course: "Röbo", entries: [{ userId: "1", points: 49, date: "2026-07-19" }] },
  ];

  // An improvement on Rosendal moves it below Röbo
  applyRoundResults(records, "Rosendal", [{ userId: "1", points: 40, date: "2026-07-29" }]);
  assert.deepEqual(records.map((section) => section.course), ["Röbo", "Rosendal"]);

  // A count without score changes doesn't reorder
  applyRoundResults(records, "Röbo", [{ userId: "1", points: 60, date: "2026-07-30" }]);
  assert.deepEqual(records.map((section) => section.course), ["Röbo", "Rosendal"]);
});

await test("a score change moves the flags: old ones clear, improvements get PR", () => {
  const records: CourseRecords = [
    { course: "Rosendal", entries: [{ userId: "1", points: 41, date: "2026-07-20", flag: "rekord" }] },
    { course: "Röbo", entries: [{ userId: "2", points: 45, date: "2026-07-27", flag: "pr" }] },
  ];

  // A PR on Röbo that doesn't beat the course record
  const result = applyRoundResults(records, "Röbo", [
    { userId: "1", points: 46, date: "2026-07-29" },
    { userId: "2", points: 50, date: "2026-07-29" },
  ]);
  assert.equal(result.improved, true);
  assert.equal(result.newCourseBest, undefined);
  // New PR is flagged; every older flag (other courses included) is cleared
  assert.deepEqual(records[1]?.entries.find((e) => e.userId === "1")?.flag, "pr");
  assert.equal(records[1]?.entries.find((e) => e.userId === "2")?.flag, undefined);
  assert.equal(records[0]?.entries[0]?.flag, undefined);
});

await test("an improvement carries the round's board link, a kept score keeps its link", () => {
  const records: CourseRecords = [{
    course: "Rosendal",
    entries: [{ userId: "1", points: 45, date: "2026-07-01", link: "https://old" }],
  }];

  applyRoundResults(records, "Rosendal", [{ userId: "1", points: 41, date: "2026-07-29", link: "https://new" }]);
  assert.equal(records[0]?.entries[0]?.link, "https://new");

  // A worse result changes nothing, link included
  applyRoundResults(records, "Rosendal", [{ userId: "1", points: 50, date: "2026-07-30", link: "https://newer" }]);
  assert.equal(records[0]?.entries[0]?.link, "https://new");
});

await test("applyRoundResults keeps personal bests and reports a new course best", () => {
  const records: CourseRecords = [];

  // First round on a course sets the record
  const first = applyRoundResults(records, "rosendal", [
    { userId: "1", points: 45, date: "2026-06-14" },
    { userId: "2", points: 43, date: "2026-06-14" },
  ]);
  assert.equal(first.improved, true);
  assert.deepEqual(first.newCourseBest, { userId: "2", points: 43, date: "2026-06-14", flag: "rekord" });

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
  assert.deepEqual(best.newCourseBest, { userId: "1", points: 41, date: "2026-07-20", flag: "rekord" });

  assert.deepEqual(records, [{
    course: "Rosendal",
    entries: [
      { userId: "1", points: 41, date: "2026-07-20", flag: "rekord" },
      { userId: "2", points: 43, date: "2026-06-14" },
    ],
  }]);
});
