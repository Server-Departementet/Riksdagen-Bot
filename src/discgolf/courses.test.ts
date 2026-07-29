import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import {
  buildScoreTable,
  coursePar,
  courseTotal,
  findCourse,
  formatRelative,
  holeScoreValue,
  courseNameFrom,
  loadCourses,
  missingHoles,
  parseCourseFile,
  parseScoreLine,
  relativeToPar,
} from "./courses";

await test("parseCourseFile parses name and holes", () => {
  const course = parseCourseFile("ultuna\n1 3\n2 4\nX1 3\n", "ultuna");

  assert.equal(course.name, "Ultuna");
  assert.deepEqual(course.aliases, []);
  assert.deepEqual(course.holes, [
    { id: "1", par: 3 },
    { id: "2", par: 4 },
    { id: "X1", par: 3 },
  ]);
});

await test("parseCourseFile parses comma separated aliases in the name line", () => {
  const course = parseCourseFile("rosendal, rosen, dgb rosendal\n1 3\n", "rosendal");

  assert.equal(course.name, "Rosendal");
  assert.deepEqual(course.aliases, ["rosen", "dgb rosendal"]);
});

await test("findCourse matches aliases case-insensitively", () => {
  const courses = [parseCourseFile("rosendal, rosen, dgb rosendal\n1 3\n", "rosendal")];

  assert.equal(findCourse(courses, "Rosen")?.name, "Rosendal");
  assert.equal(findCourse(courses, "DGB Rosendal")?.name, "Rosendal");
  assert.equal(findCourse(courses, "rosendalen"), undefined);
});

await test("parseCourseFile rejects malformed files", () => {
  assert.throws(() => parseCourseFile("bara-ett-namn\n", "trasig"), /at least one hole line/);
  assert.throws(() => parseCourseFile("bana\n1 tre\n", "trasig"), /Invalid hole line/);
  assert.throws(() => parseCourseFile("bana\n1 3\n1 4\n", "trasig"), /Duplicate hole/);
});

await test("loadCourses reads every checked-in course file", () => {
  const courses = loadCourses(path.join(import.meta.dirname, "courses"));

  const kristallen = findCourse(courses, "Kristallen");
  assert.ok(kristallen);
  assert.equal(kristallen.holes.length, 9);
  assert.equal(coursePar(kristallen), 29);

  const ultuna = findCourse(courses, "ULTUNA");
  assert.ok(ultuna);
  assert.equal(ultuna.holes.length, 20);
  assert.ok(ultuna.holes.some((hole) => hole.id === "X1"));

  assert.equal(findCourse(courses, "finnsinte"), undefined);
});

await test("parseScoreLine parses scores and dnf, and rejects junk", () => {
  assert.deepEqual(parseScoreLine("5 11"), { holeId: "5", points: 11 });
  assert.deepEqual(parseScoreLine("X1 3"), { holeId: "X1", points: 3 });
  assert.deepEqual(parseScoreLine("4 dnf"), { holeId: "4", points: "dnf" });
  assert.deepEqual(parseScoreLine("4 fyfan"), { holeId: "4", points: "dnf" });
  assert.equal(parseScoreLine("5 45"), undefined); // above max plausible score
  assert.equal(parseScoreLine("13"), undefined);
  assert.equal(parseScoreLine("hejsan hoppsan"), undefined);
});

await test("courseNameFrom finds the course name on the first line", () => {
  const courses = [parseCourseFile("rosendal, rosen, dgb rosendal\n1 3\n", "rosendal")];

  assert.equal(courseNameFrom(courses, "DGB Rosendal"), "DGB Rosendal"); // known multi-word alias
  assert.equal(courseNameFrom(courses, "Ultuna"), "Ultuna"); // unknown but course-like
  assert.equal(courseNameFrom(courses, "Gränby parken"), "Gränby parken"); // unknown multi-word
  // Course name edited into the top of the first score message
  assert.equal(courseNameFrom(courses, "Rosendal\n1 4\n2 3"), "Rosendal");
  assert.equal(courseNameFrom(courses, "1 4\n2 3"), undefined);
  assert.equal(courseNameFrom(courses, "vi kör kl 13"), undefined); // contains digits
});

await test("courseTotal sums numbered holes only and requires all of them", () => {
  const course = parseCourseFile("bana\n1 3\n2 4\nX1 3", "bana");

  assert.equal(courseTotal(course, { "1": 4, "2": 5 }), 9);
  assert.equal(courseTotal(course, { "1": 4, "2": 5, "X1": 10 }), 9); // extras excluded
  assert.equal(courseTotal(course, { "1": 4, "2": "dnf" }), 4 + 4 + 4); // dnf = par + 4
  assert.equal(courseTotal(course, { "1": 4 }), undefined); // partial round
});

await test("formatRelative formats over, under, and even par", () => {
  assert.equal(formatRelative(3), "+3");
  assert.equal(formatRelative(-2), "-2");
  assert.equal(formatRelative(0), "±0");
});

// Scores from the round in message-demo (Kristallen, 6 juli 2026)
const liljemark = { "1": 4, "2": 5, "3": 5, "4": 3, "5": 11, "6": 5, "7": 3, "8": 8, "9": 5 };
const axel = { "1": 6, "2": 7, "3": 4, "4": 6, "5": 7, "6": 6, "7": 4, "8": 6, "9": 6 };
const winroth = { "1": 5, "2": 4, "3": 5, "4": 6, "5": 20, "6": 5, "7": 4, "8": 5, "9": 7 };

await test("relativeToPar matches the demo round", () => {
  const kristallen = parseCourseFile("kristallen\n1 3\n2 3\n3 3\n4 3\n5 4\n6 3\n7 3\n8 3\n9 4", "kristallen");

  assert.equal(relativeToPar(kristallen, liljemark), 49 - 29);
  assert.equal(relativeToPar(kristallen, axel), 52 - 29);
  assert.equal(relativeToPar(kristallen, winroth), 61 - 29);
});

await test("relativeToPar only counts recorded holes", () => {
  const course = parseCourseFile("bana\n1 3\n2 3\n3 3", "bana");

  assert.equal(relativeToPar(course, { "1": 4 }), 1);
  assert.equal(relativeToPar(course, { "1": 4, "okänt": 10 }), 1);
});

await test("relativeToPar scores dnf holes as par plus four", () => {
  const course = parseCourseFile("bana\n1 3\n2 3\n3 3", "bana");

  assert.equal(relativeToPar(course, { "1": 4, "2": "dnf" }), 1 + 4);
});

await test("holeScoreValue returns throws, or par plus four for dnf", () => {
  const course = parseCourseFile("bana\n1 3", "bana");

  assert.equal(holeScoreValue(course, "1", 5), 5);
  assert.equal(holeScoreValue(course, "1", "dnf"), 3 + 4);
  assert.equal(holeScoreValue(course, "okänt", "dnf"), undefined);
  assert.equal(holeScoreValue(undefined, "1", "dnf"), undefined);
});

await test("missingHoles lists played holes a player skipped, not group-skipped holes", () => {
  const course = parseCourseFile("bana\n1 3\n2 3\n3 3", "bana");
  const a = { name: "A", score: { "1": 4 } };
  const b = { name: "B", score: { "1": 6, "2": 5 } };

  // Hole 3 was skipped by the whole group, so it counts for nobody
  assert.deepEqual(missingHoles(course, [a, b], a.score), ["2"]);
  assert.deepEqual(missingHoles(course, [a, b], b.score), []);
});

await test("missingHoles treats a dnf entry as recorded", () => {
  const course = parseCourseFile("bana\n1 3\n2 3", "bana");
  const a = { name: "A", score: { "1": 4, "2": "dnf" as const } };
  const b = { name: "B", score: { "1": 6, "2": 5 } };

  assert.deepEqual(missingHoles(course, [a, b], a.score), []);
});

await test("buildScoreTable renders pars and averages for the demo round", () => {
  const kristallen = parseCourseFile("kristallen\n1 3\n2 3\n3 3\n4 3\n5 4\n6 3\n7 3\n8 3\n9 4", "kristallen");
  const table = buildScoreTable(kristallen, [
    { name: "Liljemark", score: liljemark },
    { name: "Axel", score: axel },
    { name: "Winroth", score: winroth },
  ]);

  assert.equal(table, [
    "Hål  Par  Snitt",
    "---------------",
    "1      3    5.0",
    "2      3    5.3",
    "3      3    4.7",
    "4      3    5.0",
    "5      4   12.7",
    "6      3    5.3",
    "7      3    3.7",
    "8      3    6.3",
    "9      4    6.0",
  ].join("\n"));
});

await test("buildScoreTable without a course matches the old format", () => {
  const table = buildScoreTable(undefined, [
    { name: "A", score: { "1": 5, "2": 4 } },
    { name: "B", score: { "1": 6, "2": 4 } },
  ]);

  assert.equal(table, [
    "Hål  Snitt",
    "----------",
    "1      5.5",
    "2      4.0",
  ].join("\n"));
});

await test("buildScoreTable adds a Saknad column when a player misses a played hole", () => {
  const course = parseCourseFile("bana\n1 3\n2 3\n3 3", "bana");
  const table = buildScoreTable(course, [
    { name: "A", score: { "1": 4, "2": 5 } },
    { name: "B", score: { "1": 6 } },
  ]);

  assert.equal(table, [
    "Hål  Par  Snitt  Saknad",
    "-----------------------",
    "1      3    5.0",
    "2      3    5.0  B",
  ].join("\n"));
});

await test("buildScoreTable averages only finished holes and marks dnf-only holes", () => {
  const course = parseCourseFile("bana\n1 3\n2 3\n3 3", "bana");
  const table = buildScoreTable(course, [
    { name: "A", score: { "1": 4, "2": "dnf" } },
    { name: "B", score: { "1": 6, "2": 5, "3": "dnf" } },
  ]);

  assert.equal(table, [
    "Hål  Par  Snitt  Saknad",
    "-----------------------",
    "1      3    5.0",
    "2      3    5.0",
    "3      3      -  A",
  ].join("\n"));
});

await test("buildScoreTable skips unplayed holes, appends unknown ones, and says Kast for a solo round", () => {
  const course = parseCourseFile("bana\n1 3\n2 3\n3 3", "bana");
  const table = buildScoreTable(course, [{ name: "A", score: { "1": 4, "10": 6 } }]);

  assert.equal(table, [
    "Hål  Par  Kast",
    "--------------",
    "1      3   4.0",
    "10     -   6.0",
  ].join("\n"));
});
