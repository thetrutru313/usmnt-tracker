/**
 * Given a list of national-team match log candidates (each carrying an
 * api_football_fixture_id and the log's date), returns the single fixture ID
 * that most likely corresponds to the requested fixture.
 *
 * Disambiguation strategy (handles multiple NT matches in the same ±7-day
 * window — e.g. Jamaica Aug 24 / T&T Aug 28):
 *
 *  1. Count how many candidate log rows vote for each fixture ID.
 *  2. Pick the ID with the most votes.
 *  3. Break ties by nearest date to the seeded fixture kickoff.
 *
 * Returns null when the candidates list is empty (fixture has no logs yet).
 *
 * This is a pure function so it can be unit-tested without a DB connection.
 */
export function pickBestNtFixtureId(
  candidates: { apiFootballFixtureId: number; date: string }[],
  kickoffMs: number,
): number | null {
  if (candidates.length === 0) return null;

  // Tally votes per fixture ID; keep one representative date per ID.
  const counts = new Map<number, number>();
  const representativeDate = new Map<number, string>();

  for (const c of candidates) {
    counts.set(c.apiFootballFixtureId, (counts.get(c.apiFootballFixtureId) ?? 0) + 1);
    if (!representativeDate.has(c.apiFootballFixtureId)) {
      representativeDate.set(c.apiFootballFixtureId, c.date);
    }
  }

  let bestId: number | null = null;
  let bestCount = -1;
  let bestDiff = Infinity;

  for (const [id, count] of counts.entries()) {
    const dateDiff = Math.abs(
      new Date(representativeDate.get(id)!).getTime() - kickoffMs,
    );

    const winsOnCount = count > bestCount;
    const tiesOnCountButCloser = count === bestCount && dateDiff < bestDiff;

    if (winsOnCount || tiesOnCountButCloser) {
      bestId = id;
      bestCount = count;
      bestDiff = dateDiff;
    }
  }

  return bestId;
}
