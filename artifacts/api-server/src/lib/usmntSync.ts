import { db, playersTable, playerStatsTable, matchLogsTable, fixturesTable, fixturePlayersTable } from "@workspace/db";
import { eq, and, or, isNull, lt, gt, gte, lte, inArray, isNotNull, asc, desc, sql } from "drizzle-orm";
import { logger } from "./logger";
import { afFetch, resolveUsmntTeamId, FINISHED_STATUSES } from "./apiFootballSync";
import { pickBestNtFixtureId } from "./pickBestNtFixtureId.js";
import {
  toNum,
  toRating,
  aggregateFromMatchLogs,
  type RealMatchLog,
  type AggregatedSeasonStats,
  type AfFixtureListItem,
  type AfFixturePlayersTeam,
} from "./playerStatsSync";

// ---------------------------------------------------------------------------
// USMNT match logs and cycle stats sync independently of the 50-club sync in
// playerStatsSync.ts, on its own faster schedule — national-team games are
// far less frequent than club fixtures and shouldn't wait behind an hour-long
// club-by-club crawl to show up.
//
// The sync is INCREMENTAL: it only fetches per-fixture lineups for fixtures
// not already in the DB. Cycle totals are re-aggregated from all DB match_logs
// after insertion (not from the API response), so a partial run that is cut
// short by a server restart still makes forward progress instead of rolling
// everything back.
// ---------------------------------------------------------------------------

type PlayerRow = { id: number; name: string; clubId: number; apiFootballPlayerId: number | null };

// World Cup tournament end dates (real for 2018/2022/2026, best-estimate for
// 2030+ pending an official calendar) — used only to bucket match dates into
// a cycle label, not treated as authoritative fixture data.
const WORLD_CUP_CUTOFFS: { year: number; cutoff: string }[] = [
  { year: 2018, cutoff: "2018-07-15" },
  { year: 2022, cutoff: "2022-12-18" },
  { year: 2026, cutoff: "2026-07-19" },
  { year: 2030, cutoff: "2030-07-21" },
  { year: 2034, cutoff: "2034-07-19" },
];

/** Labels a match date (YYYY-MM-DD) with the World Cup cycle it falls in, e.g. "2026 World Cup". */
export function cycleForDate(dateStr: string): string {
  const t = Date.parse(dateStr);
  for (const wc of WORLD_CUP_CUTOFFS) {
    if (t <= Date.parse(wc.cutoff)) return `${wc.year} World Cup`;
  }
  const last = WORLD_CUP_CUTOFFS[WORLD_CUP_CUTOFFS.length - 1]!;
  const yearsAhead = Math.ceil((new Date(t).getUTCFullYear() - last.year) / 4) * 4;
  return `${last.year + Math.max(yearsAhead, 4)} World Cup`;
}

// 99 is API-Football's hard ceiling for the `last` param; covers the entire
// current World Cup cycle (~60 games) for the initial history build.
const CYCLE_TOTAL_FIXTURES_WINDOW = 99;

function mapUsmntLog(
  f: AfFixtureListItem,
  entry: AfFixturePlayersTeam["players"][number],
  teamId: number,
): RealMatchLog | null {
  const stats = entry.statistics[0];
  const minutes = stats?.games.minutes;
  if (!minutes || minutes <= 0) return null;
  const isHome = f.teams.home.id === teamId;
  const ourGoals = isHome ? f.goals.home : f.goals.away;
  const theirGoals = isHome ? f.goals.away : f.goals.home;
  const outcome = ourGoals == null || theirGoals == null ? "" : ourGoals > theirGoals ? "W" : ourGoals < theirGoals ? "L" : "D";
  return {
    apiFootballFixtureId: f.fixture.id,
    date: f.fixture.date.slice(0, 10),
    opponent: isHome ? f.teams.away.name : f.teams.home.name,
    competition: f.league.name,
    result: ourGoals != null && theirGoals != null ? `${outcome} ${ourGoals}-${theirGoals}` : "",
    minutes,
    goals: toNum(stats?.goals.total),
    assists: toNum(stats?.goals.assists),
    conceded: theirGoals ?? null,
    rating: toRating(stats?.games.rating),
    isNationalTeam: true,
  };
}

function ntLogValues(playerId: number, log: RealMatchLog) {
  return { ...log, playerId, cycle: cycleForDate(log.date) };
}

/** Every USMNT fixture id currently recorded in our match logs, regardless of which player it's attached to — used to detect "has anything new finished". */
async function getSyncedFixtureIds(): Promise<Set<number>> {
  const rows = await db
    .select({ apiFootballFixtureId: matchLogsTable.apiFootballFixtureId })
    .from(matchLogsTable)
    .where(eq(matchLogsTable.isNationalTeam, true));
  return new Set(rows.map((r) => r.apiFootballFixtureId).filter((id): id is number => id != null));
}

/**
 * Fetches per-player match-log data from API-Football for a specific list of
 * finished USMNT fixtures. Only calls `/fixtures/players` for the provided
 * fixtures — callers control which subset to process (new-only for
 * incremental runs, full history for fresh starts).
 */
async function fetchLogsForFixtures(
  allPlayers: PlayerRow[],
  teamId: number,
  fixtures: AfFixtureListItem[],
): Promise<Map<number, RealMatchLog[]>> {
  const logsByPlayer = new Map<number, RealMatchLog[]>();
  const resolvedPlayers = allPlayers.filter((p) => p.apiFootballPlayerId);
  if (resolvedPlayers.length === 0) return logsByPlayer;
  const byApiId = new Map(resolvedPlayers.map((p) => [p.apiFootballPlayerId as number, p]));

  const finished = fixtures.filter((f) => FINISHED_STATUSES.has(f.fixture.status.short));

  for (const f of finished) {
    let teams: AfFixturePlayersTeam[];
    try {
      teams = await afFetch<AfFixturePlayersTeam[]>(`/fixtures/players?fixture=${f.fixture.id}`);
    } catch (err) {
      logger.warn({ err, fixtureId: f.fixture.id }, "API-Football USMNT fixture-players fetch failed — skipping this match");
      continue;
    }

    const usmntBlock = teams.find((t) => t.team.id === teamId);
    if (!usmntBlock) continue;

    for (const entry of usmntBlock.players) {
      const player = byApiId.get(entry.player.id);
      if (!player) continue;
      const log = mapUsmntLog(f, entry, teamId);
      if (!log) continue;
      const existing = logsByPlayer.get(player.id) ?? [];
      existing.push(log);
      logsByPlayer.set(player.id, existing);
    }
  }

  return logsByPlayer;
}

/**
 * Replaces every "national_team_cycle" row for a player with one row per
 * cycle that has real synced data — analogous to `replaceSeasonHistoryRows`
 * for club seasons, but keyed by World Cup cycle label instead of season year.
 */
async function replaceCycleHistoryRows(playerId: number, entries: { cycle: string; agg: AggregatedSeasonStats }[]): Promise<void> {
  await db.delete(playerStatsTable).where(and(eq(playerStatsTable.playerId, playerId), eq(playerStatsTable.periodType, "national_team_cycle")));
  for (const { cycle, agg } of entries) {
    await db.insert(playerStatsTable).values({
      playerId,
      periodType: "national_team_cycle",
      season: cycle,
      minutes: agg.minutes,
      starts: agg.starts,
      goals: agg.goals,
      assists: agg.assists,
      shots: agg.shots,
      keyPasses: agg.keyPasses,
      passCompletionPct: agg.passCompletionPct,
      tackles: agg.tackles,
      interceptions: agg.interceptions,
      duelsWonPct: agg.duelsWonPct,
      cleanSheets: null,
      savePct: agg.savePct,
      avgRating: agg.avgRating,
    });
  }
}

export interface UsmntSyncResult {
  apiCallsMade: boolean; // true when lineup fetches actually ran (new fixtures found)
  newFixturesProcessed: number;
  playersWithNewLogs: number;
  cyclesWritten: number;
}

/**
 * Incrementally syncs USMNT match logs and cycle-tagged stats.
 *
 * The function has two separate concerns with different cost profiles:
 *
 * EXPENSIVE (API calls — gated behind new-fixture detection):
 *   1. Cheap poll: fetches the last 20 USMNT fixtures to detect new finished
 *      games not yet in the DB.
 *   2. If new fixtures found and DB is empty: fetches last=99 to build
 *      complete cycle history. Otherwise: fetches lineups for new IDs only.
 *   3. INSERTs new match_log rows, one atomic INSERT per fixture so a
 *      crash between fixtures never leaves a fixture partially written.
 *      onConflictDoNothing() prevents double-inserts from concurrent timers.
 *
 * CHEAP (pure DB reads+writes — always runs, even when no new fixtures):
 *   4. Re-aggregates national_team_cycle rows from ALL match_logs for every
 *      player that has any NT log in the DB.
 *
 * Running step 4 unconditionally is what makes crash recovery correct: if a
 * prior run inserted some fixture logs but was killed before recomputing cycle
 * stats, the next run (even if it finds no new fixtures) will still recompute
 * cycle stats from the now-complete DB state and fix the stale rows.
 */
export async function syncUsmntStats(fixturesToCheck = 20): Promise<UsmntSyncResult> {
  const teamId = await resolveUsmntTeamId();
  if (!teamId) return { apiCallsMade: false, newFixturesProcessed: 0, playersWithNewLogs: 0, cyclesWritten: 0 };

  // Load players once — used for both lineup matching and cycle recomputation.
  const players: PlayerRow[] = await db
    .select({ id: playersTable.id, name: playersTable.name, clubId: playersTable.clubId, apiFootballPlayerId: playersTable.apiFootballPlayerId })
    .from(playersTable);

  // -------------------------------------------------------------------------
  // PHASE A — lineup sync (expensive, gated by new-fixture detection)
  // -------------------------------------------------------------------------

  let newFixturesProcessed = 0;
  let playersWithNewLogs = 0;

  let recentFixtures: AfFixtureListItem[];
  try {
    recentFixtures = await afFetch<AfFixtureListItem[]>(`/fixtures?team=${teamId}&last=${fixturesToCheck}`);
  } catch (err) {
    logger.warn({ err }, "API-Football USMNT fixture-status check failed — skipping lineup sync this poll, cycle stats will still be recomputed from DB");
    recentFixtures = [];
  }

  const alreadySynced = await getSyncedFixtureIds();

  if (recentFixtures.length > 0) {
    const freshFinishedIds = new Set(
      recentFixtures.filter((f) => FINISHED_STATUSES.has(f.fixture.status.short)).map((f) => f.fixture.id),
    );
    const hasNewFinishedMatch = [...freshFinishedIds].some((id) => !alreadySynced.has(id));

    if (hasNewFinishedMatch) {
      let fixturesToProcess: AfFixtureListItem[];

      if (alreadySynced.size === 0) {
        // Fresh start — fetch the full cycle window to build complete history.
        // This is the only time we pay for 99 lineup calls; subsequent runs are
        // incremental (only the new games from the cheap poll).
        let allFixtures: AfFixtureListItem[];
        try {
          allFixtures = await afFetch<AfFixtureListItem[]>(`/fixtures?team=${teamId}&last=${CYCLE_TOTAL_FIXTURES_WINDOW}`);
        } catch (err) {
          logger.warn({ err }, "API-Football USMNT full-cycle fixture fetch failed — falling back to recent window");
          allFixtures = recentFixtures;
        }
        fixturesToProcess = allFixtures.filter(
          (f) => FINISHED_STATUSES.has(f.fixture.status.short) && !alreadySynced.has(f.fixture.id),
        );
        logger.info({ fixturesToProcess: fixturesToProcess.length }, "USMNT fresh-start: fetching full cycle history");
      } else {
        fixturesToProcess = recentFixtures.filter(
          (f) => FINISHED_STATUSES.has(f.fixture.status.short) && !alreadySynced.has(f.fixture.id),
        );
        logger.info({ fixturesToProcess: fixturesToProcess.length, alreadySyncedCount: alreadySynced.size }, "USMNT incremental: fetching lineups for new fixtures only");
      }

      if (fixturesToProcess.length > 0) {
        const newLogsByPlayer = await fetchLogsForFixtures(players, teamId, fixturesToProcess);

        // Insert per-fixture (atomic): either ALL players for a fixture are
        // committed or none. A crash between fixtures leaves everything already
        // committed in getSyncedFixtureIds() and skips correctly next run.
        const logsByFixtureId = new Map<number, Array<{ playerId: number; log: RealMatchLog }>>();
        for (const player of players) {
          for (const log of newLogsByPlayer.get(player.id) ?? []) {
            if (log.apiFootballFixtureId == null) continue;
            const bucket = logsByFixtureId.get(log.apiFootballFixtureId) ?? [];
            bucket.push({ playerId: player.id, log });
            logsByFixtureId.set(log.apiFootballFixtureId, bucket);
          }
        }

        const insertedPlayerIds = new Set<number>();
        for (const [, entries] of logsByFixtureId) {
          await db
            .insert(matchLogsTable)
            .values(
              entries.map(({ playerId, log }) => ntLogValues(playerId, log)),
            )
            .onConflictDoNothing();
          for (const { playerId } of entries) insertedPlayerIds.add(playerId);
        }

        newFixturesProcessed = fixturesToProcess.length;
        playersWithNewLogs = insertedPlayerIds.size;
        logger.info({ newFixturesProcessed, playersWithNewLogs }, "USMNT match logs inserted");
      }
    } else {
      logger.info({ checked: recentFixtures.length, alreadySyncedCount: alreadySynced.size }, "USMNT fixture check found nothing new — skipping lineup fetch");
    }
  }

  // -------------------------------------------------------------------------
  // PHASE B — cycle stat recomputation (cheap, always runs)
  //
  // Reads ALL national-team match_logs from DB and rebuilds every player's
  // national_team_cycle rows from scratch. Running this unconditionally means
  // a run that was crashed before phase B completes will be self-healing:
  // the next run — even if it finds no new fixtures — will recompute cycle
  // stats for all players that have NT logs in the DB, including any logs
  // inserted by the crashed run.
  // -------------------------------------------------------------------------

  // Fetch all NT logs in one query, then bucket by player in memory.
  const allNtLogs = await db
    .select({
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
    })
    .from(matchLogsTable)
    .where(eq(matchLogsTable.isNationalTeam, true));

  const logsByPlayer = new Map<number, RealMatchLog[]>();
  for (const log of allNtLogs) {
    const bucket = logsByPlayer.get(log.playerId) ?? [];
    bucket.push(log as RealMatchLog);
    logsByPlayer.set(log.playerId, bucket);
  }

  let cyclesWritten = 0;
  for (const [playerId, playerLogs] of logsByPlayer) {
    const logsByCycle = new Map<string, RealMatchLog[]>();
    for (const log of playerLogs) {
      const cycle = cycleForDate(log.date);
      logsByCycle.set(cycle, [...(logsByCycle.get(cycle) ?? []), log]);
    }
    const cycleEntries = [...logsByCycle.entries()]
      .map(([cycle, cycleLogs]) => ({ cycle, agg: aggregateFromMatchLogs(cycleLogs) }))
      .filter((e): e is { cycle: string; agg: AggregatedSeasonStats } => e.agg != null);

    await replaceCycleHistoryRows(playerId, cycleEntries);
    cyclesWritten += cycleEntries.length;
  }

  logger.info({ newFixturesProcessed, playersWithNewLogs, cyclesWritten, playersRecomputed: logsByPlayer.size }, "USMNT stats sync complete");
  return { apiCallsMade: recentFixtures.length > 0, newFixturesProcessed, playersWithNewLogs, cyclesWritten };
}

let intervalHandle: NodeJS.Timeout | null = null;

/**
 * Promotes national-team fixture rows that still carry a null or negative
 * sentinel `api_football_fixture_id` to the real positive ID once match logs
 * exist for that fixture (i.e. after the match is played and the USMNT stats
 * sync has ingested the logs).
 *
 * This is the post-match fallback for cases where the pre-match binding in
 * `syncNationalTeamFixtures()` did not succeed (e.g. API-Football published
 * the fixture after the match was played, or a kickoff date-match fell outside
 * the ±1-day window). It runs on the hourly USMNT stats schedule so promotion
 * happens within an hour of match logs appearing in the DB.
 *
 * Idempotent and cheap in the common case: the initial query uses the
 * `is_national_team` index; when all fixtures already carry positive IDs the
 * function returns immediately after one indexed read.
 */
export async function promoteNtSentinelIds(): Promise<void> {
  try {
    // ORDER BY kickoff ASC is load-bearing: when two sentinel fixtures have
    // overlapping ±2-day candidate windows (e.g. Sept 26 and Sept 29 matches
    // overlap on Sept 27–28), the earlier kickoff is always processed first
    // and claims the earlier log.  The later sentinel then finds the same log,
    // hits a unique-constraint collision on the UPDATE, and stays unbound —
    // which is correct, because its match has not been played yet.  Without
    // this ordering the result is non-deterministic: if the later sentinel is
    // processed first it silently claims the wrong ID and the earlier fixture
    // stays unbound at kickoff.
    const ntFixturesWithoutId = await db
      .select()
      .from(fixturesTable)
      .where(
        and(
          eq(fixturesTable.isNationalTeam, true),
          or(isNull(fixturesTable.apiFootballFixtureId), lt(fixturesTable.apiFootballFixtureId, 0)),
        ),
      )
      .orderBy(asc(fixturesTable.kickoff));

    if (ntFixturesWithoutId.length === 0) return; // nothing to promote — fast path

    for (const fixture of ntFixturesWithoutId) {
      // Per-fixture try/catch: a unique-constraint collision on one fixture
      // (e.g. two sentinels share a match-log candidate) must not abort the
      // remaining fixtures in the same batch.
      try {
        const kickoffMs = new Date(fixture.kickoff).getTime();
        const twoBefore = new Date(kickoffMs - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const twoAfter  = new Date(kickoffMs + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        // Only consult players explicitly linked to this fixture — prevents
        // ambiguity when two NT matches fall in the same ±2-day window.
        const linked = await db
          .select({ playerId: fixturePlayersTable.playerId })
          .from(fixturePlayersTable)
          .where(eq(fixturePlayersTable.fixtureId, fixture.id));

        const linkedIds = linked.map((r) => r.playerId);
        if (linkedIds.length === 0) continue; // no tracked players linked — skip

        const candidates = await db
          .select({
            apiFootballFixtureId: matchLogsTable.apiFootballFixtureId,
            date: matchLogsTable.date,
          })
          .from(matchLogsTable)
          .where(
            and(
              inArray(matchLogsTable.playerId, linkedIds),
              eq(matchLogsTable.isNationalTeam, true),
              gte(matchLogsTable.date, twoBefore),
              lte(matchLogsTable.date, twoAfter),
              isNotNull(matchLogsTable.apiFootballFixtureId),
            ),
          ) as { apiFootballFixtureId: number; date: string }[];

        const bestId = pickBestNtFixtureId(candidates, kickoffMs);
        if (bestId == null) continue; // no logs yet — future fixture or not yet synced

        await db
          .update(fixturesTable)
          .set({ apiFootballFixtureId: bestId })
          .where(eq(fixturesTable.id, fixture.id));

        logger.info(
          { fixtureId: fixture.id, apiFootballFixtureId: bestId },
          "NT sentinel promotion: backfilled api_football_fixture_id from match logs",
        );
      } catch (err) {
        logger.warn({ err, fixtureId: fixture.id }, "NT sentinel promotion: per-fixture update failed (non-fatal)");
      }
    }
  } catch (err) {
    logger.warn({ err }, "NT sentinel promotion: outer query failed (non-fatal)");
  }
}

/**
 * Runs the incremental USMNT sync immediately, then hourly. The cheap
 * fixture-list poll runs on every tick; the expensive per-fixture lineup
 * fetch only fires when a new finished match is detected.
 *
 * Also runs `promoteNtSentinelIds()` on each tick so that sentinel fixture IDs
 * are promoted to real API-Football IDs within an hour of match logs appearing,
 * rather than waiting for the next server restart.
 */
export type SeniorNtSquadOptions = {
  now?: () => Date;
  fetchPlayers?: (fixtureId: number) => Promise<AfFixturePlayersTeam[]>;
  fetchFixture?: (fixtureId: number) => Promise<AfFixtureListItem | undefined>;
};

/** Complete senior squads come from fixture players, including unused substitutes. */
export async function syncSeniorNtSquads(options: SeniorNtSquadOptions = {}) {
  const now = (options.now ?? (() => new Date()))();
  const counts = { fixturesLinkedFromLogs: 0, linksInserted: 0, fixturesSquadSynced: 0, logsInserted: 0, linksRemoved: 0, apiCallsMade: 0 };
  const eligible = await db.select().from(fixturesTable).where(and(
    eq(fixturesTable.isNationalTeam, true), eq(fixturesTable.ntLevel, "SENIOR"),
    eq(fixturesTable.status, "finished"), gt(fixturesTable.apiFootballFixtureId, 0),
  )).orderBy(desc(fixturesTable.kickoff), desc(fixturesTable.id));
  for (const fixture of eligible) {
    const inserted = await db.transaction(async (tx) => {
      // Serialize this routine's duplicate check without adding a schema constraint.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(22022, ${fixture.id})`);
      return tx.execute(sql`
        INSERT INTO fixture_players (fixture_id, player_id, club_id)
        SELECT ${fixture.id}, ml.player_id, NULL
        FROM match_logs ml JOIN players p ON p.id = ml.player_id
        WHERE ml.is_national_team = true AND ml.api_football_fixture_id = ${fixture.apiFootballFixtureId}
          AND NOT EXISTS (SELECT 1 FROM fixture_players fp WHERE fp.fixture_id = ${fixture.id} AND fp.player_id = ml.player_id)
        GROUP BY ml.player_id RETURNING id`);
    });
    counts.linksInserted += inserted.rows.length;
    if (inserted.rows.length) counts.fixturesLinkedFromLogs++;
  }
  const cutoff = now.getTime() - 60 * 24 * 60 * 60 * 1000;
  const pending = eligible.filter((f) => f.squadSyncedAt === null && f.kickoff.getTime() >= cutoff && f.kickoff <= now).slice(0, 6);
  const players = await db.select({ id: playersTable.id, apiId: playersTable.apiFootballPlayerId }).from(playersTable);
  const byApiId = new Map(players.filter((p) => p.apiId !== null).map((p) => [p.apiId, p.id]));
  const fetchPlayers = options.fetchPlayers ?? ((id: number) => afFetch<AfFixturePlayersTeam[]>(`/fixtures/players?fixture=${id}`));
  const fetchFixture = options.fetchFixture ?? (async (id: number) => (await afFetch<AfFixtureListItem[]>(`/fixtures?id=${id}`))[0]);
  for (const fixture of pending) {
    try {
      counts.apiCallsMade++;
      const teams = await fetchPlayers(fixture.apiFootballFixtureId!);
      const usa = teams.find((t) => ["usa", "united states", "usmnt"].includes(t.team.name.toLowerCase()));
      const squad = [...new Map((usa?.players ?? []).map((entry) => [entry.player.id, entry])).values()];
      if (squad.length < 11) {
        if (now.getTime() - fixture.kickoff.getTime() > 72 * 60 * 60 * 1000) {
          await db.update(fixturesTable).set({ squadSyncedAt: now }).where(and(eq(fixturesTable.id, fixture.id), isNull(fixturesTable.squadSyncedAt)));
          counts.fixturesSquadSynced++;
          logger.warn({ fixtureId: fixture.id, squadSize: squad.length }, "Senior NT squad not published after 72 hours — giving up");
        }
        continue;
      }
      const tracked = squad.flatMap((entry) => {
        const playerId = byApiId.get(entry.player.id);
        return playerId === undefined ? [] : [{ playerId, entry }];
      });
      const existingLogs = await db.select({ playerId: matchLogsTable.playerId }).from(matchLogsTable).where(and(
        eq(matchLogsTable.isNationalTeam, true), eq(matchLogsTable.apiFootballFixtureId, fixture.apiFootballFixtureId!),
      ));
      const logged = new Set(existingLogs.map((log) => log.playerId));
      const missing = tracked.filter(({ playerId, entry }) => !logged.has(playerId) && (entry.statistics[0]?.games.minutes ?? 0) > 0);
      let item: AfFixtureListItem | undefined;
      if (missing.length) {
        counts.apiCallsMade++;
        item = await fetchFixture(fixture.apiFootballFixtureId!);
        if (!item || item.fixture.id !== fixture.apiFootballFixtureId) throw new Error("Missing or mismatched fixture stats source");
      }
      const changed = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(22022, ${fixture.id})`);
        const [current] = await tx.select().from(fixturesTable).where(eq(fixturesTable.id, fixture.id));
        const result = { linksInserted: 0, logsInserted: 0, linksRemoved: 0, fixturesSquadSynced: 0 };
        if (!current || current.squadSyncedAt !== null) return result;
        for (const { playerId, entry } of missing) {
          const log = mapUsmntLog(item!, entry, usa!.team.id);
          if (log) {
            const inserted = await tx.insert(matchLogsTable).values(ntLogValues(playerId, log)).onConflictDoNothing().returning({ id: matchLogsTable.id });
            result.logsInserted += inserted.length;
          }
        }
        const links = await tx.select().from(fixturePlayersTable).where(eq(fixturePlayersTable.fixtureId, fixture.id));
        const linked = new Set(links.map((link) => link.playerId));
        const trackedIds = new Set(tracked.map((p) => p.playerId));
        for (const playerId of trackedIds) {
          if (!linked.has(playerId)) {
            await tx.insert(fixturePlayersTable).values({ fixtureId: fixture.id, playerId, clubId: null });
            result.linksInserted++;
          }
        }
        const logs = await tx.select({ playerId: matchLogsTable.playerId }).from(matchLogsTable).where(and(
          eq(matchLogsTable.isNationalTeam, true), eq(matchLogsTable.apiFootballFixtureId, fixture.apiFootballFixtureId!),
        ));
        const hasLog = new Set(logs.map((log) => log.playerId));
        const removeIds = links.filter((link) => link.clubId === null && !trackedIds.has(link.playerId) && !hasLog.has(link.playerId)).map((link) => link.id);
        if (removeIds.length) {
          result.linksRemoved = (await tx.delete(fixturePlayersTable).where(and(inArray(fixturePlayersTable.id, removeIds), isNull(fixturePlayersTable.clubId))).returning({ id: fixturePlayersTable.id })).length;
        }
        await tx.update(fixturesTable).set({ squadSyncedAt: now }).where(eq(fixturesTable.id, fixture.id));
        result.fixturesSquadSynced = 1;
        return result;
      });
      counts.linksInserted += changed.linksInserted;
      counts.logsInserted += changed.logsInserted;
      counts.linksRemoved += changed.linksRemoved;
      counts.fixturesSquadSynced += changed.fixturesSquadSynced;
    } catch (err) {
      logger.warn({ err, fixtureId: fixture.id }, "Senior NT squad sync failed — skipping fixture");
    }
  }
  return counts;
}

export function startUsmntStatsSyncSchedule(intervalMs = 60 * 60 * 1000): void {
  if (!process.env["API_FOOTBALL_KEY"]) {
    logger.warn("API_FOOTBALL_KEY not set — skipping USMNT stats sync, no national-team match logs/cycle stats will be available");
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { claimSyncRun } = require("./syncGuard") as typeof import("./syncGuard");
  const COOLDOWN = 50 * 60 * 1000;
  const run = async () => {
    if (!(await claimSyncRun("usmntStats", COOLDOWN))) return;
    // Promote sentinel fixture IDs before syncing stats so that any newly
    // promoted fixtures are already bound when match logs are processed.
    await promoteNtSentinelIds();
    try {
      await syncUsmntStats();
      await syncSeniorNtSquads();
    } catch (err) {
      logger.error({ err }, "USMNT stats/squad sync failed");
    }
  };
  run();
  intervalHandle = setInterval(run, intervalMs);
}

export function stopUsmntStatsSyncSchedule(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}
