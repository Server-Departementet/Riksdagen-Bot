/**
 * Course records live in a pool of bot-owned Discord messages that are both
 * the display and the storage (no data on our own server, per the channel
 * consensus 2026-07-27): an index message carrying the title, the "senast
 * uppdaterad" stamp and the signature reactions, plus one message per course
 * listing every player's personal best, lowest first, so the top line is the
 * course record. When a score changes, that course's message is deleted and
 * resent (with mention pings suppressed), sinking it to the bottom so the
 * least played courses migrate to the top.
 */

/** Celebration marker set when a score actually changes: personal record or new course record. */
export type RecordFlag = "pr" | "rekord";

export type RecordEntry = {
  /** Discord user id - or comma-joined sorted ids for a co-op team. */
  userId: string;
  points: number;
  /** YYYY-MM-DD (Stockholm time) of the round. */
  date: string;
  /** URL of the round's /räkna board message; the date renders as a link to it. */
  link?: string;
  /**
   * Only /räkna runs that change a score rewrite flags (clearing the previous
   * ones); reformatting and no-change counts pass them through untouched.
   */
  flag?: RecordFlag;
};

export type CourseRecords = { course: string; entries: RecordEntry[] }[];

const RECORDS_TITLE = "## Rekord";
const RECORDS_SUBTEXT = "-# Uppdateras automatiskt vid /räkna";
const courseLineRegex = /^### (.+)$/;
// The optional token between score and mentions is the player's signature emoji
// (the lookahead keeps it from swallowing a team's first mention); a co-op team
// entry has one mention per member; the date is either plain or a masked link
// to the round's /räkna board
const entryLineRegex = /^`(\d+)` (?:(?!<@)\S+ )?(<@\d+>(?: <@\d+>)*) (?:\[(\d{4}-\d{2}-\d{2})\]\((\S+)\)|(\d{4}-\d{2}-\d{2}))( \[.+\])?$/;

const FLAG_TEXT: Record<RecordFlag, string> = {
  pr: "[PR 🎉]",
  rekord: "[Rekord!! 🥳]",
};

function flagFromText(text: string | undefined): RecordFlag | undefined {
  if (text === FLAG_TEXT.pr) return "pr";
  if (text === FLAG_TEXT.rekord) return "rekord";
  return undefined;
}

const RECORDS_SIGNATURE_HINT = "-# Reagera på det här meddelandet — din reaktion blir din signatur-emoji i listorna";

/** The index message: title, subtext, signature hint, and the "senast uppdaterad" stamp. */
export function formatRecordsHeader(updatedAt: Date): string {
  const stamp = updatedAt.toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", dateStyle: "short", timeStyle: "short" });
  return [RECORDS_TITLE, RECORDS_SUBTEXT, RECORDS_SIGNATURE_HINT, `-# Senast uppdaterad ${stamp}`].join("\n");
}

/** One course's pool message. */
export function formatCourseSection(section: CourseRecords[number], signatures: Record<string, string>): string {
  const lines = [...section.entries]
    .sort((a, b) => a.points - b.points || a.date.localeCompare(b.date))
    .map((entry) => {
      const signature = signatures[entry.userId];
      const mentions = entry.userId.split(",").map((id) => `<@${id}>`).join(" ");
      const date = entry.link ? `[${entry.date}](${entry.link})` : entry.date;
      const flag = entry.flag ? ` ${FLAG_TEXT[entry.flag]}` : "";
      return `\`${entry.points}\`${signature ? ` ${signature}` : ""} ${mentions} ${date}${flag}`;
    });
  return [`### ${section.course}`, ...lines].join("\n");
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
    const [, points, mentions, linkedDate, link, plainDate, flagText] = entryMatch ?? [];
    const date = linkedDate ?? plainDate;
    if (!current || !points || !mentions || !date) continue;
    const userId = [...mentions.matchAll(/<@(\d+)>/g)]
      .flatMap((m) => m[1] ? [m[1]] : [])
      .sort()
      .join(",");
    const flag = flagFromText(flagText?.trim());
    current.entries.push({
      userId,
      points: parseInt(points, 10),
      date,
      ...link ? { link } : {},
      ...flag ? { flag } : {},
    });
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

  const improvedEntries: RecordEntry[] = [];
  for (const result of results) {
    const existing = section.entries.find((entry) => entry.userId === result.userId);
    if (!existing) {
      const entry = { ...result };
      section.entries.push(entry);
      improvedEntries.push(entry);
    }
    else if (result.points < existing.points) {
      existing.points = result.points;
      existing.date = result.date;
      if (result.link) existing.link = result.link;
      else delete existing.link;
      improvedEntries.push(existing);
    }
  }

  // An actual score change moves the celebration flags: clear the old ones, flag
  // every improvement as a PR. It also sinks the course to the bottom of the board.
  // No change means the previous flags and order stay put.
  if (improvedEntries.length > 0) {
    for (const s of records) {
      for (const entry of s.entries) delete entry.flag;
    }
    for (const entry of improvedEntries) entry.flag = "pr";
    records.splice(records.indexOf(section), 1);
    records.push(section);
  }

  const best = [...section.entries].sort((a, b) => a.points - b.points || a.date.localeCompare(b.date))[0];
  if (best && (previousBest === undefined || best.points < previousBest)) {
    // A new course best is always one of this round's improvements
    best.flag = "rekord";
    return { improved: improvedEntries.length > 0, newCourseBest: best };
  }
  return { improved: improvedEntries.length > 0 };
}
