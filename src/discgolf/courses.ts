import fs from "node:fs";
import path from "node:path";

export type Hole = {
  id: string;
  par: number;
};

/** A recorded result for one hole: a stroke count, or "dnf" when the hole wasn't finished. */
export type HoleScore = number | "dnf";

export type Course = {
  name: string;
  aliases: string[];
  holes: Hole[];
};

/**
 * Course file format: first non-empty line is the course name, optionally
 * followed by comma separated aliases ("rosendal, rosen, dgb rosendal").
 * Every following line is "<hole id> <par>", e.g. "1 3" or "X1 3".
 */
export function parseCourseFile(content: string, sourceName: string): Course {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const [nameLine, ...holeLines] = lines;
  const [name, ...aliases] = (nameLine ?? "").split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  if (!name || holeLines.length === 0) {
    throw new Error(`Course file "${sourceName}" must have a name line followed by at least one hole line`);
  }

  const holes: Hole[] = [];
  for (const line of holeLines) {
    const match = /^(\S+)\s+(\d+)$/.exec(line);
    const [, id, parString] = match ?? [];
    if (!id || !parString) throw new Error(`Invalid hole line "${line}" in course file "${sourceName}"`);
    if (holes.some((hole) => hole.id.toLowerCase() === id.toLowerCase())) {
      throw new Error(`Duplicate hole "${id}" in course file "${sourceName}"`);
    }
    holes.push({ id, par: parseInt(parString, 10) });
  }

  return { name, aliases, holes };
}

function courseNames(course: Course): string[] {
  return [course.name, ...course.aliases];
}

export function loadCourses(dir: string): Course[] {
  const courses: Course[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const filePath = path.join(dir, entry);
    if (!fs.statSync(filePath).isFile()) continue;
    const course = parseCourseFile(fs.readFileSync(filePath, "utf8"), entry);
    for (const name of courseNames(course)) {
      if (findCourse(courses, name)) throw new Error(`Duplicate course name or alias "${name}" in course file "${entry}"`);
    }
    courses.push(course);
  }
  return courses;
}

export function findCourse(courses: Course[], name: string): Course | undefined {
  const normalized = name.trim().toLowerCase();
  return courses.find((course) => courseNames(course).some((courseName) => courseName.toLowerCase() === normalized));
}

function findHole(course: Course, holeId: string): Hole | undefined {
  return course.holes.find((hole) => hole.id.toLowerCase() === holeId.toLowerCase());
}

export function coursePar(course: Course): number {
  return course.holes.reduce((sum, hole) => sum + hole.par, 0);
}

// PDGA 811 scores an unplayed or abandoned hole as par plus four
export const DNF_SCORE_OVER_PAR = 4;

/** The strokes a recorded hole adds to the total: the throw count, or par + 4 for a DNF (undefined when the par is unknown). */
export function holeScoreValue(course: Course | undefined, holeId: string, points: HoleScore): number | undefined {
  if (typeof points === "number") return points;
  const hole = course ? findHole(course, holeId) : undefined;
  return hole ? hole.par + DNF_SCORE_OVER_PAR : undefined;
}

/** Score relative to par, counting only the holes the player has recorded. */
export function relativeToPar(course: Course, score: Record<string, HoleScore>): number {
  let relative = 0;
  for (const [holeId, points] of Object.entries(score)) {
    const hole = findHole(course, holeId);
    if (!hole) continue;
    const value = holeScoreValue(course, holeId, points);
    if (value === undefined) continue;
    relative += value - hole.par;
  }
  return relative;
}

export function formatRelative(relative: number): string {
  if (relative > 0) return `+${relative}`;
  if (relative < 0) return `${relative}`;
  return "±0";
}

export type PlayerScore = {
  name: string;
  score: Record<string, HoleScore>;
};

function recordedScore(score: Record<string, HoleScore>, holeId: string): HoleScore | undefined {
  return Object.entries(score).find(([id]) => id.toLowerCase() === holeId.toLowerCase())?.[1];
}

/** Holes in course file order with any recorded holes missing from the course file appended at the end. */
function orderedHoleIds(course: Course | undefined, scores: Record<string, HoleScore>[]): string[] {
  const holeIds = course ? course.holes.map((hole) => hole.id) : [];
  const knownIds = new Set(holeIds.map((id) => id.toLowerCase()));
  const extraIds = new Set<string>();
  for (const score of scores) {
    for (const holeId of Object.keys(score)) {
      if (!knownIds.has(holeId.toLowerCase())) extraIds.add(holeId);
    }
  }
  return [...holeIds, ...[...extraIds].sort((a, b) => a.localeCompare(b, "sv-SE", { numeric: true }))];
}

/**
 * Hole ids the given player has no entry for, among the holes at least one
 * player recorded. Holes nobody recorded count as skipped by the group, not
 * missing. A DNF entry counts as recorded.
 */
export function missingHoles(course: Course | undefined, players: PlayerScore[], score: Record<string, HoleScore>): string[] {
  return orderedHoleIds(course, players.map((player) => player.score)).filter((holeId) =>
    recordedScore(score, holeId) === undefined
    && players.some((player) => recordedScore(player.score, holeId) !== undefined),
  );
}

/**
 * Builds the per-hole summary table. Holes follow the course file order with
 * any recorded holes missing from the course file appended at the end.
 * The Par column is omitted when the course is unknown, and the Saknad column
 * when nobody is missing a score on a played hole.
 */
export function buildScoreTable(course: Course | undefined, players: PlayerScore[]): string {
  const scores = players.map((player) => player.score);
  const rows: { hole: string; par: string; average: string; missing: string }[] = [];
  for (const holeId of orderedHoleIds(course, scores)) {
    const recorded = scores
      .map((score) => recordedScore(score, holeId))
      .filter((points): points is HoleScore => points !== undefined);
    if (recorded.length === 0) continue;
    const finished = recorded.filter((points): points is number => typeof points === "number");
    const average = finished.length > 0
      ? (finished.reduce((sum, points) => sum + points, 0) / finished.length).toFixed(1)
      : "-";
    const hole = course ? findHole(course, holeId) : undefined;
    const missing = players
      .filter((player) => recordedScore(player.score, holeId) === undefined)
      .map((player) => player.name);
    rows.push({ hole: holeId, par: hole ? String(hole.par) : "-", average, missing: missing.join(", ") });
  }

  const hasMissing = rows.some((row) => row.missing.length > 0);
  const headers = ["Hål", ...course ? ["Par"] : [], "Snitt", ...hasMissing ? ["Saknad"] : []];
  const cells = rows.map((row) => [row.hole, ...course ? [row.par] : [], row.average, ...hasMissing ? [row.missing] : []]);
  const widths = headers.map((header, column) => Math.max(header.length, ...cells.map((row) => row[column]?.length ?? 0)));
  const leftAligned = new Set([0, ...hasMissing ? [headers.length - 1] : []]);
  const renderRow = (row: string[]) => row
    .map((cell, column) => leftAligned.has(column) ? cell.padEnd(widths[column] ?? 0) : cell.padStart(widths[column] ?? 0))
    .join("  ")
    .trimEnd();

  const headerLine = renderRow(headers);
  return [headerLine, "-".repeat(headerLine.length), ...cells.map(renderRow)].join("\n");
}
