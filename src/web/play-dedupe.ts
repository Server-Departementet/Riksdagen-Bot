/**
 * Takeout-imported history records the same play with a timestamp a few seconds
 * off from the recently-played API's played_at, so the exact match on the
 * (trackId, playedAt, userId) primary key can't catch those duplicates.
 * Kept in sync with Riksdagen/src/lib/play-dedupe.ts.
 */
export const PLAY_DEDUPE_TOLERANCE_MS = 10_000;

type Play = { trackId: string; playedAt: Date };

/** Drop candidate plays that already exist within `toleranceMs` of a stored play of the same track. */
export function filterNearDuplicatePlays<T extends Play>(
  candidates: T[],
  existing: Play[],
  toleranceMs: number = PLAY_DEDUPE_TOLERANCE_MS,
): T[] {
  return candidates.filter((candidate) => !existing.some((play) =>
    play.trackId === candidate.trackId
    && Math.abs(play.playedAt.getTime() - candidate.playedAt.getTime()) <= toleranceMs,
  ));
}
