import { and, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";

/**
 * Compute a player's current age from their stored date-of-birth string,
 * falling back to the stored integer age when DOB is unavailable.
 * This keeps ages correct immediately after a birthday without waiting for
 * the next sync cycle. Exported so route handlers can apply the same
 * resolution to raw `playerSummaryColumns` results.
 */
export function resolveAge(dateOfBirth: string | null | undefined, storedAge: number): number {
  if (!dateOfBirth) return storedAge;
  const birth = new Date(dateOfBirth);
  if (Number.isNaN(birth.getTime())) return storedAge;
  return Math.floor((Date.now() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

/**
 * True only for the senior USMNT — never for a youth national-team fixture
 * (U17/U20/U23) or a club fixture.
 *
 * Written as an allowlist deliberately: a row is senior only when
 * `is_national_team = true` AND `nt_level = 'SENIOR'`. A national-team row
 * whose `nt_level` is NULL (unclassified — see deriveNtLevel()) or any other
 * value fails CLOSED, i.e. it is excluded from senior-only surfaces, rather
 * than failing open into them. That inversion — from "assume national-team
 * rows are senior unless proven otherwise" to "assume they are not senior
 * unless proven otherwise" — is what fixes the U17/U20 leakage into the
 * dashboard hero and the USMNT Schedule page.
 *
 * Provided in two forms:
 *   - `isSeniorNtFixture(row)` — in-process predicate for already-fetched rows.
 *   - `seniorNtFixtureCondition` — the equivalent Drizzle `SQL` condition, for
 *     use directly in a `.where()` clause.
 */
export function isSeniorNtFixture(fixture: { isNationalTeam: boolean; ntLevel: string | null }): boolean {
  return fixture.isNationalTeam === true && fixture.ntLevel === "SENIOR";
}

export const seniorNtFixtureCondition = and(
  eq(fixturesTable.isNationalTeam, true),
  eq(fixturesTable.ntLevel, "SENIOR"),
);
import {
  db,
  clubsTable,
  playersTable,
  playerStatsTable,
  matchLogsTable,
  fixturesTable,
  fixturePlayersTable,
  newsArticlesTable,
  newsArticlePlayersTable,
  injuriesTable,
  transfersTable,
  nationalTeamWindowsTable,
} from "@workspace/db";

export type PlayerPoolTier = "core" | "inMix" | "prospect";

/**
 * Player pool classification for fixture filtering:
 * - "core": named to the 2026 World Cup 26-man roster.
 * - "inMix": 5+ national team caps but not on the World Cup roster.
 * - "prospect": everyone else, as long as they're under 25.
 * Note this is distinct from `category` (current/fringe/prospect) — e.g. a
 * "current" senior international who didn't make the World Cup roster (like
 * Yunus Musah) lands in "inMix", not "core".
 */
export function computePoolTier(player: { worldCupRoster: boolean; nationalTeamCaps: number; age: number }): PlayerPoolTier {
  if (player.worldCupRoster) return "core";
  if (player.nationalTeamCaps >= 5) return "inMix";
  return "prospect";
}

export const playerSummaryColumns = {
  id: playersTable.id,
  name: playersTable.name,
  slug: playersTable.slug,
  position: playersTable.position,
  category: playersTable.category,
  worldCupRoster: playersTable.worldCupRoster,
  clubName: clubsTable.name,
  league: clubsTable.league,
  clubLogoUrl: clubsTable.logoUrl,
  photoUrl: playersTable.photoUrl,
  age: playersTable.age,
  dateOfBirth: playersTable.dateOfBirth,
  marketValueUsd: playersTable.marketValueUsd,
  nationalTeamCaps: playersTable.nationalTeamCaps,
  nationalTeamGoals: playersTable.nationalTeamGoals,
  potentialCallUpScore: playersTable.potentialCallUpScore,
};

/**
 * Derive the form badge on-demand from `player_stats` rows, mirroring
 * `computeFormTier` in `playerStatsSync.ts`. Called at query time so the
 * badge is always live — the `performance_trend` column is no longer updated
 * by the sync and should not be read for display purposes.
 *
 * Only `minutes` and `avgRating` are used from each window.
 */
function computeFormBadge(
  last5: { minutes: number; avgRating: number | null } | undefined,
  prev5: { minutes: number; avgRating: number | null } | undefined,
  seasonAvgRating: number | null | undefined,
): { performanceTrend: string; trending: boolean } {
  const STEADY = { performanceTrend: "steady" as const, trending: false };
  if (!last5 || last5.minutes < 270 || last5.avgRating == null || seasonAvgRating == null) return STEADY;

  const seasonDelta = last5.avgRating - seasonAvgRating;
  let score = 50 * seasonDelta;
  if (prev5?.avgRating != null) score += 30 * (last5.avgRating - prev5.avgRating);

  const trajectoryIsDown = prev5?.avgRating != null && last5.avgRating < prev5.avgRating;

  let trend: string;
  if (!trajectoryIsDown && score >= 25) trend = "on_fire";
  else if (!trajectoryIsDown && score >= 12) trend = "rising";
  else if (score > -12) trend = "steady";
  else if (score > -25) trend = "falling";
  else trend = "ice_cold";

  return { performanceTrend: trend, trending: trend === "on_fire" || trend === "rising" };
}

/**
 * Batch-compute form badges for a list of player IDs by reading their
 * `last5`, `previous5`, and `season` rows from `player_stats`. One query
 * covers all IDs; used by `listPlayers`, `getPlayerById`, and route handlers
 * to overlay the computed badge onto any player shape without reading the
 * stale `performance_trend` column.
 */
export async function computeFormBadgesForPlayerIds(
  playerIds: number[],
): Promise<Map<number, { performanceTrend: string; trending: boolean }>> {
  if (playerIds.length === 0) return new Map();

  // ORDER BY created_at DESC so the first occurrence of each (player_id,
  // period_type) pair is always the newest row. After Task B2 at most one row
  // per (player_id, period_type) can exist for these four types, so this is
  // belt-and-braces — but the query must not depend on a constraint added
  // elsewhere for its own correctness (getStatsForPlayer already does this).
  const statsRows = await db
    .select({
      playerId: playerStatsTable.playerId,
      periodType: playerStatsTable.periodType,
      minutes: playerStatsTable.minutes,
      avgRating: playerStatsTable.avgRating,
    })
    .from(playerStatsTable)
    .where(
      and(
        inArray(playerStatsTable.playerId, playerIds),
        inArray(playerStatsTable.periodType, ["last5", "previous5", "season"]),
      ),
    )
    .orderBy(desc(playerStatsTable.createdAt));

  const last5Map = new Map<number, { minutes: number; avgRating: number | null }>();
  const prev5Map = new Map<number, { minutes: number; avgRating: number | null }>();
  const seasonAvgMap = new Map<number, number | null>();

  // Dedup: keep the first (= newest) row per (playerId, periodType).
  const seen = new Set<string>();
  for (const row of statsRows) {
    const key = `${row.playerId}:${row.periodType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (row.periodType === "last5") last5Map.set(row.playerId, { minutes: row.minutes, avgRating: row.avgRating });
    else if (row.periodType === "previous5") prev5Map.set(row.playerId, { minutes: row.minutes, avgRating: row.avgRating });
    else if (row.periodType === "season") seasonAvgMap.set(row.playerId, row.avgRating);
  }

  const badges = new Map<number, { performanceTrend: string; trending: boolean }>();
  for (const pid of playerIds) {
    badges.set(pid, computeFormBadge(last5Map.get(pid), prev5Map.get(pid), seasonAvgMap.get(pid)));
  }
  return badges;
}

export function playerSummaryQuery() {
  return db
    .select(playerSummaryColumns)
    .from(playersTable)
    .innerJoin(clubsTable, eq(playersTable.clubId, clubsTable.id));
}

export async function listPlayers(filter: {
  category?: "current" | "fringe" | "prospect";
  position?: string;
  search?: string;
}) {
  const conditions = [];
  if (filter.category) conditions.push(eq(playersTable.category, filter.category));
  if (filter.position) conditions.push(ilike(playersTable.position, filter.position));
  if (filter.search) conditions.push(ilike(playersTable.name, `%${filter.search}%`));

  const query = playerSummaryQuery();
  const rows = conditions.length ? await query.where(and(...conditions)) : await query;

  const playerIds = rows.map((r) => r.id);
  const badges = await computeFormBadgesForPlayerIds(playerIds);

  return rows.map(({ worldCupRoster, dateOfBirth, age: storedAge, ...row }) => {
    const age = resolveAge(dateOfBirth, storedAge);
    const badge = badges.get(row.id) ?? { performanceTrend: "steady", trending: false };
    return { ...row, age, poolTier: computePoolTier({ worldCupRoster, nationalTeamCaps: row.nationalTeamCaps, age }), ...badge };
  });
}

export async function getPlayerById(id: number) {
  const [row] = await db
    .select({
      id: playersTable.id,
      name: playersTable.name,
      slug: playersTable.slug,
      position: playersTable.position,
      category: playersTable.category,
      // worldCupRoster is needed to compute poolTier via the shared
      // computePoolTier function — stripped from the response below so the
      // caller only sees poolTier, matching the PlayerSummary contract.
      worldCupRoster: playersTable.worldCupRoster,
      clubName: clubsTable.name,
      league: clubsTable.league,
      clubCountry: clubsTable.country,
      clubLogoUrl: clubsTable.logoUrl,
      photoUrl: playersTable.photoUrl,
      age: playersTable.age,
      dateOfBirth: playersTable.dateOfBirth,
      contractUntil: playersTable.contractUntil,
      marketValueUsd: playersTable.marketValueUsd,
      nationalTeamCaps: playersTable.nationalTeamCaps,
      nationalTeamGoals: playersTable.nationalTeamGoals,
      youthNationalTeam: playersTable.youthNationalTeam,
      debutDate: playersTable.debutDate,
      potentialCallUpScore: playersTable.potentialCallUpScore,
      bio: playersTable.bio,
    })
    .from(playersTable)
    .innerJoin(clubsTable, eq(playersTable.clubId, clubsTable.id))
    .where(eq(playersTable.id, id));
  if (!row) return undefined;
  const { dateOfBirth, age: storedAge, worldCupRoster, ...rest } = row;
  const age = resolveAge(dateOfBirth, storedAge);
  const badges = await computeFormBadgesForPlayerIds([id]);
  const badge = badges.get(id) ?? { performanceTrend: "steady", trending: false };
  return {
    ...rest,
    age,
    // computePoolTier is the single source of truth — the same function used
    // by listPlayers, getFeaturedPlayersMap, and getFeaturedPlayersForFixtures.
    // Calling it here guarantees the profile badge always agrees with the list.
    poolTier: computePoolTier({ worldCupRoster, nationalTeamCaps: rest.nationalTeamCaps, age }),
    ...badge,
  };
}

export async function getStatsForPlayer(playerId: number, periodType: "season" | "last5" | "previous_season" | "previous5") {
  const [row] = await db
    .select()
    .from(playerStatsTable)
    .where(and(eq(playerStatsTable.playerId, playerId), eq(playerStatsTable.periodType, periodType)))
    .orderBy(desc(playerStatsTable.createdAt))
    .limit(1);
  return row;
}

/** Every season year (e.g. "2025", "2026") this player has real club-season stats for, most recent first — powers the club-season selector on the player profile. */
export async function getAvailableClubSeasons(playerId: number) {
  const rows = await db
    .select({ season: playerStatsTable.season })
    .from(playerStatsTable)
    .where(and(eq(playerStatsTable.playerId, playerId), eq(playerStatsTable.periodType, "season_all")))
    .orderBy(desc(playerStatsTable.season));
  return rows.map((r) => r.season);
}

/**
 * Club-season stats for a specific season year if given (and it exists),
 * otherwise the most recent season with data. Falls back to the plain
 * "season" row (kept for rankings/dashboard compatibility) if no
 * "season_all" history rows exist yet for this player.
 */
export async function getClubSeasonStats(playerId: number, season?: string) {
  if (season) {
    const [row] = await db
      .select()
      .from(playerStatsTable)
      .where(and(eq(playerStatsTable.playerId, playerId), eq(playerStatsTable.periodType, "season_all"), eq(playerStatsTable.season, season)))
      .limit(1);
    if (row) return row;
  }
  const [latest] = await db
    .select()
    .from(playerStatsTable)
    .where(and(eq(playerStatsTable.playerId, playerId), eq(playerStatsTable.periodType, "season_all")))
    .orderBy(desc(playerStatsTable.season))
    .limit(1);
  if (latest) return latest;
  return getStatsForPlayer(playerId, "season");
}

/** Every World Cup cycle (e.g. "2026 World Cup") this player has real USMNT stats for, most recent first — powers the USMNT-cycle selector on the player profile. */
export async function getAvailableNationalTeamCycles(playerId: number) {
  const rows = await db
    .select({ season: playerStatsTable.season })
    .from(playerStatsTable)
    .where(and(eq(playerStatsTable.playerId, playerId), eq(playerStatsTable.periodType, "national_team_cycle")))
    .orderBy(desc(playerStatsTable.season));
  return rows.map((r) => r.season);
}

/**
 * USMNT cycle stats for a specific cycle label if given (and it exists),
 * otherwise the most recent cycle with data. Returns undefined if this
 * player has no synced national-team cycle stats at all yet.
 */
export async function getNationalTeamCycleStats(playerId: number, cycle?: string) {
  if (cycle) {
    const [row] = await db
      .select()
      .from(playerStatsTable)
      .where(and(eq(playerStatsTable.playerId, playerId), eq(playerStatsTable.periodType, "national_team_cycle"), eq(playerStatsTable.season, cycle)))
      .limit(1);
    if (row) return row;
  }
  const [latest] = await db
    .select()
    .from(playerStatsTable)
    .where(and(eq(playerStatsTable.playerId, playerId), eq(playerStatsTable.periodType, "national_team_cycle")))
    .orderBy(desc(playerStatsTable.season))
    .limit(1);
  return latest;
}

export async function getMatchLogForPlayer(playerId: number, limit = 10) {
  // Left-join with fixtures to get the internal fixture id for deep-linking.
  // Rows where apiFootballFixtureId is null (old seeded data) or no fixture
  // row exists yet will have fixtureId = null, and the UI omits the link.
  return db
    .select({
      id: matchLogsTable.id,
      fixtureId: fixturesTable.id,
      playerId: matchLogsTable.playerId,
      apiFootballFixtureId: matchLogsTable.apiFootballFixtureId,
      date: matchLogsTable.date,
      opponent: matchLogsTable.opponent,
      competition: matchLogsTable.competition,
      result: matchLogsTable.result,
      minutes: matchLogsTable.minutes,
      goals: matchLogsTable.goals,
      assists: matchLogsTable.assists,
      conceded: matchLogsTable.conceded,
      rating: matchLogsTable.rating,
      isNationalTeam: matchLogsTable.isNationalTeam,
      cycle: matchLogsTable.cycle,
      createdAt: matchLogsTable.createdAt,
    })
    .from(matchLogsTable)
    .leftJoin(
      fixturesTable,
      and(
        eq(fixturesTable.apiFootballFixtureId, matchLogsTable.apiFootballFixtureId),
        // Only join when apiFootballFixtureId is not null (null = not linked)
        // Drizzle handles this naturally via the left join + the equal condition
      ),
    )
    .where(eq(matchLogsTable.playerId, playerId))
    .orderBy(desc(matchLogsTable.date))
    .limit(limit);
}

export async function getInjuriesForPlayer(playerId: number) {
  return db
    .select()
    .from(injuriesTable)
    .where(eq(injuriesTable.playerId, playerId))
    .orderBy(desc(injuriesTable.startDate));
}

export async function getTransfersForPlayer(playerId: number) {
  return db
    .select()
    .from(transfersTable)
    .where(eq(transfersTable.playerId, playerId))
    .orderBy(desc(transfersTable.announcedAt));
}

type FeaturedPlayerRow = { id: number; name: string; slug: string; position: string; photoUrl: string | null; poolTier: PlayerPoolTier };

export async function getFeaturedPlayersMap(playerIds: number[]) {
  if (playerIds.length === 0) return new Map<number, FeaturedPlayerRow>();
  const rows = await db
    .select({
      id: playersTable.id,
      name: playersTable.name,
      slug: playersTable.slug,
      position: playersTable.position,
      photoUrl: playersTable.photoUrl,
      worldCupRoster: playersTable.worldCupRoster,
      nationalTeamCaps: playersTable.nationalTeamCaps,
      age: playersTable.age,
      dateOfBirth: playersTable.dateOfBirth,
    })
    .from(playersTable)
    .where(inArray(playersTable.id, playerIds));
  return new Map(rows.map((r) => [r.id, { id: r.id, name: r.name, slug: r.slug, position: r.position, photoUrl: r.photoUrl, poolTier: computePoolTier({ ...r, age: resolveAge(r.dateOfBirth, r.age) }) }]));
}

export async function getFeaturedPlayersForFixtures(fixtureIds: number[]) {
  if (fixtureIds.length === 0) return new Map<number, FeaturedPlayerRow[]>();
  const rows = await db
    .select({
      fixtureId: fixturePlayersTable.fixtureId,
      fixtureStatus: fixturesTable.status,
      // Club this link was created for (null for curated national-team
      // links) vs. the player's live club right now — compared below so a
      // player who's transferred away stops showing on their old club's
      // upcoming fixtures, the same way the Player Pool page would show them.
      linkClubId: fixturePlayersTable.clubId,
      currentClubId: playersTable.clubId,
      id: playersTable.id,
      name: playersTable.name,
      slug: playersTable.slug,
      position: playersTable.position,
      photoUrl: playersTable.photoUrl,
      worldCupRoster: playersTable.worldCupRoster,
      nationalTeamCaps: playersTable.nationalTeamCaps,
      age: playersTable.age,
      dateOfBirth: playersTable.dateOfBirth,
    })
    .from(fixturePlayersTable)
    .innerJoin(playersTable, eq(fixturePlayersTable.playerId, playersTable.id))
    .innerJoin(fixturesTable, eq(fixturePlayersTable.fixtureId, fixturesTable.id))
    .where(inArray(fixturePlayersTable.fixtureId, fixtureIds));

  const map = new Map<number, FeaturedPlayerRow[]>();
  for (const row of rows) {
    // Only club-fixture links (linkClubId set) that are still scheduled can
    // go stale this way — a fixture that's already been played should keep
    // showing who was actually featured, and national-team links (no
    // linkClubId) are curated separately from club membership.
    const isStaleClubLink = row.linkClubId !== null && row.fixtureStatus === "scheduled" && row.linkClubId !== row.currentClubId;
    if (isStaleClubLink) continue;
    const list = map.get(row.fixtureId) ?? [];
    list.push({ id: row.id, name: row.name, slug: row.slug, position: row.position, photoUrl: row.photoUrl, poolTier: computePoolTier({ ...row, age: resolveAge(row.dateOfBirth, row.age) }) });
    map.set(row.fixtureId, list);
  }
  return map;
}

export async function attachFeaturedPlayers<T extends { id: number }>(fixtures: T[]) {
  const map = await getFeaturedPlayersForFixtures(fixtures.map((f) => f.id));
  return fixtures.map((f) => ({ ...f, featuredPlayers: map.get(f.id) ?? [] }));
}

export async function getPlayersForNewsArticles(articleIds: number[]) {
  if (articleIds.length === 0) return new Map<number, { id: number; name: string; slug: string; position: string; photoUrl: string | null }[]>();
  const rows = await db
    .select({
      articleId: newsArticlePlayersTable.articleId,
      id: playersTable.id,
      name: playersTable.name,
      slug: playersTable.slug,
      position: playersTable.position,
      photoUrl: playersTable.photoUrl,
    })
    .from(newsArticlePlayersTable)
    .innerJoin(playersTable, eq(newsArticlePlayersTable.playerId, playersTable.id))
    .where(inArray(newsArticlePlayersTable.articleId, articleIds));

  const map = new Map<number, { id: number; name: string; slug: string; position: string; photoUrl: string | null }[]>();
  for (const row of rows) {
    const list = map.get(row.articleId) ?? [];
    list.push({ id: row.id, name: row.name, slug: row.slug, position: row.position, photoUrl: row.photoUrl });
    map.set(row.articleId, list);
  }
  return map;
}

export async function attachPlayersToNews<T extends { id: number }>(articles: T[]) {
  const map = await getPlayersForNewsArticles(articles.map((a) => a.id));
  return articles.map((a) => ({ ...a, players: map.get(a.id) ?? [] }));
}

const injuryWithPlayerColumns = {
  id: injuriesTable.id,
  bodyPart: injuriesTable.bodyPart,
  status: injuriesTable.status,
  expectedReturn: injuriesTable.expectedReturn,
  daysMissed: injuriesTable.daysMissed,
  matchesMissed: injuriesTable.matchesMissed,
  latestUpdate: injuriesTable.latestUpdate,
  startDate: injuriesTable.startDate,
  clubName: clubsTable.name,
  // performanceTrend removed — derived on-demand via computeFormBadgesForPlayerIds
  player: {
    id: playersTable.id,
    name: playersTable.name,
    slug: playersTable.slug,
    position: playersTable.position,
    photoUrl: playersTable.photoUrl,
  },
};

export function injuriesWithPlayerQuery() {
  return db
    .select(injuryWithPlayerColumns)
    .from(injuriesTable)
    .innerJoin(playersTable, eq(injuriesTable.playerId, playersTable.id))
    .innerJoin(clubsTable, eq(playersTable.clubId, clubsTable.id));
}

const transferWithPlayerColumns = {
  id: transfersTable.id,
  fromClub: transfersTable.fromClub,
  toClub: transfersTable.toClub,
  transferType: transfersTable.transferType,
  fee: transfersTable.fee,
  status: transfersTable.status,
  probabilityScore: transfersTable.probabilityScore,
  announcedAt: transfersTable.announcedAt,
  summary: transfersTable.summary,
  // performanceTrend removed — derived on-demand via computeFormBadgesForPlayerIds
  player: {
    id: playersTable.id,
    name: playersTable.name,
    slug: playersTable.slug,
    position: playersTable.position,
    photoUrl: playersTable.photoUrl,
  },
};

export function transfersWithPlayerQuery() {
  return db
    .select(transferWithPlayerColumns)
    .from(transfersTable)
    .innerJoin(playersTable, eq(transfersTable.playerId, playersTable.id));
}

/**
 * Overlays live form badges onto injury rows (player id at row.player.id).
 * Replaces the previously-stale read of players.performanceTrend.
 */
export async function withInjuryBadges<T extends { player: { id: number } }>(
  rows: T[],
): Promise<(T & { performanceTrend: string; trending: boolean })[]> {
  if (rows.length === 0) return [];
  const badges = await computeFormBadgesForPlayerIds(rows.map((r) => r.player.id));
  return rows.map((row) => ({ ...row, ...(badges.get(row.player.id) ?? { performanceTrend: "steady", trending: false }) }));
}

/**
 * Overlays live form badges onto transfer rows (player id at row.player.id).
 * Replaces the previously-stale read of players.performanceTrend.
 */
export async function withTransferBadges<T extends { player: { id: number } }>(
  rows: T[],
): Promise<(T & { performanceTrend: string; trending: boolean })[]> {
  if (rows.length === 0) return [];
  const badges = await computeFormBadgesForPlayerIds(rows.map((r) => r.player.id));
  return rows.map((row) => ({ ...row, ...(badges.get(row.player.id) ?? { performanceTrend: "steady", trending: false }) }));
}

export { and, desc, eq, gte, ilike, inArray, or, sql };
export {
  clubsTable,
  playersTable,
  playerStatsTable,
  matchLogsTable,
  fixturesTable,
  fixturePlayersTable,
  newsArticlesTable,
  newsArticlePlayersTable,
  injuriesTable,
  transfersTable,
  nationalTeamWindowsTable,
};
