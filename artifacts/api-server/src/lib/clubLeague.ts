/**
 * Picks a club's league from its fixture list.
 *
 * The first fixture of a season is often a preseason friendly, so using it
 * stored "Friendlies Clubs" as the league for ten clubs in 2026. Instead,
 * ignore friendly/preseason competitions and take the competition the club
 * plays most often, which is its domestic league (34–38 matches) rather than
 * a cup or European competition. Returns null when only friendlies are
 * known, so the caller leaves the league as "Unknown" and tries again on a
 * later sweep.
 */
const NON_LEAGUE = /friendl|summer series/i;

export function pickClubLeague(fixtures: { league: { name: string } }[]): string | null {
  const counts = new Map<string, number>();
  for (const f of fixtures) {
    const name = f.league?.name?.trim();
    if (!name || NON_LEAGUE.test(name)) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}
