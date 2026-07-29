/**
 * Course records live in a single bot-owned Discord message that is both the
 * display and the storage (no data on our own server, per the channel
 * consensus 2026-07-27). Each course section lists every player's personal
 * best, lowest first, so the top line is the course record.
 */

export type RecordEntry = {
  userId: string;
  points: number;
  /** YYYY-MM-DD (Stockholm time) of the round. */
  date: string;
};

export type CourseRecords = { course: string; entries: RecordEntry[] }[];

const RECORDS_TITLE = "## Banrekord";
const RECORDS_SUBTEXT = "-# Uppdateras automatiskt vid /räkna";
const courseLineRegex = /^### (.+)$/;
// The optional token between score and mention is the player's signature emoji;
const entryLineRegex = /^`(\d+)` (?:\S+ )?<@(\d+)> (\d{4}-\d{2}-\d{2})$/;

export function formatRecords(records: CourseRecords, signatures: Record<string, string>, updatedAt: Date): string {
  const sections = [...records]
    .sort((a, b) => a.course.localeCompare(b.course, "sv-SE"))
    .map(({ course, entries }) => {
      const lines = [...entries]
        .sort((a, b) => a.points - b.points || a.date.localeCompare(b.date))
        .map((entry) => {
          const signature = signatures[entry.userId];
          return `\`${entry.points}\`${signature ? ` ${signature}` : ""} <@${entry.userId}> ${entry.date}`;
        });
      return [`### ${course}`, ...lines].join("\n");
    });
  const updatedLine = `-# Senast uppdaterad ${updatedAt.toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", dateStyle: "short", timeStyle: "short" })}`;
  return [RECORDS_TITLE, RECORDS_SUBTEXT, "", sections.join("\n"), "", updatedLine].join("\n");
}

/** Parses a record message back into records. Unknown lines are ignored, so a fresh seed message parses as empty. */
export function parseRecords(content: string): CourseRecords {
  const records: CourseRecords = [];
  let current: CourseRecords[number] | undefined;
  for (const line of content.split("\n").map((l) => l.trim())) {
    const courseMatch = courseLineRegex.exec(line);
    if (courseMatch?.[1]) {
      current = { course: courseMatch[1], entries: [] };
      records.push(current);
      continue;
    }
    const entryMatch = entryLineRegex.exec(line);
    const [, points, userId, date] = entryMatch ?? [];
    if (!current || !points || !userId || !date) continue;
    current.entries.push({ userId, points: parseInt(points, 10), date });
  }
  return records;
}

/**
 * Folds a round's eligible results into the records, keeping each player's
 * best (ties keep the earlier record). Returns whether anything changed and,
 * if the course best was set or beaten, the new best.
 */
export function applyRoundResults(records: CourseRecords, courseName: string, results: RecordEntry[]): {
  improved: boolean;
  newCourseBest?: RecordEntry;
} {
  let section = records.find((s) => s.course.toLowerCase() === courseName.toLowerCase());
  if (!section && results.length > 0) {
    section = { course: courseName, entries: [] };
    records.push(section);
  }
  if (!section) return { improved: false };
  // Adopt the caller's casing so older sections migrate to the canonical course name
  section.course = courseName;

  const previousBest = section.entries.length > 0
    ? Math.min(...section.entries.map((entry) => entry.points))
    : undefined;

  let improved = false;
  for (const result of results) {
    const existing = section.entries.find((entry) => entry.userId === result.userId);
    if (!existing) {
      section.entries.push({ ...result });
      improved = true;
    }
    else if (result.points < existing.points) {
      existing.points = result.points;
      existing.date = result.date;
      improved = true;
    }
  }

  const best = [...section.entries].sort((a, b) => a.points - b.points || a.date.localeCompare(b.date))[0];
  if (best && (previousBest === undefined || best.points < previousBest)) {
    return { improved, newCourseBest: best };
  }
  return { improved };
}
