import { db, playersTable, playerStatsTable, matchLogsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";
import { afFetch, resolveUsmntTeamId, FINISHED_STATUSES } from "./apiFootballSync";
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

    const isHome = f.teams.home.id === teamId;
    const opponent = isHome ? f.teams.away.name : f.teams.home.name;
    const conceded = isHome ? f.goals.away : f.goals.home;
    const ourGoals = isHome ? f.goals.home : f.goals.away;
    const theirGoals = isHome ? f.goals.away : f.goals.home;
    const outcome =
      ourGoals == null || theirGoals == null ? "" : ourGoals > theirGoals ? "W" : ourGoals < theirGoals ? "L" : "D";
    const scoreLine = ourGoals != null && theirGoals != null ? `${outcome} ${ourGoals}-${theirGoals}` : "";

    for (const entry of usmntBlock.players) {
      const player = byApiId.get(entry.player.id);
      if (!player) continue;
      const stats = entry.statistics[0];
      const minutes = stats?.games.minutes;
      if (!minutes || minutes <= 0) continue; // did not actually appear — no fabricated row

      const log: RealMatchLog = {
        apiFootballFixtureId: f.fixture.id,
        date: f.fixture.date.slice(0, 10),
        opponent,
        competition: f.league.name,
        result: scoreLine,
        minutes,
        goals: toNum(stats?.goals.total),
        assists: toNum(stats?.goals.assists),
        conceded: conceded ?? null,
        rating: toRating(stats?.games.rating),
        isNationalTeam: true,
      };
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
              entries.map(({ playerId, log }) => ({
                playerId,
                apiFootballFixtureId: log.apiFootballFixtureId,
                date: log.date,
                opponent: log.opponent,
                competition: log.competition,
                result: log.result,
                minutes: log.minutes,
                goals: log.goals,
                assists: log.assists,
                conceded: log.conceded,
                rating: log.rating,
                isNationalTeam: true,
                cycle: cycleForDate(log.date),
              })),
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
 * Runs the incremental USMNT sync immediately, then hourly. The cheap
 * fixture-list poll runs on every tick; the expensive per-fixture lineup
 * fetch only fires when a new finished match is detected.
 */
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
    syncUsmntStats().catch((err) => logger.error({ err }, "USMNT stats sync failed"));
  };
  run();
  intervalHandle = setInterval(run, intervalMs);
}

export function stopUsmntStatsSyncSchedule(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}
