import { db, playersTable, playerStatsTable, matchLogsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
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
// club-by-club crawl to show up. See replit.md / .agents/memory for why: no
// true webhook/push exists for match completion on this provider, so this
// polls the USMNT team's own fixture list (1-2 cheap calls) and only pays for
// the expensive per-fixture lineup fetch when something has actually changed
// since the last run.
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

// Cycle totals need every finished fixture within the current World Cup
// cycle, not just a handful of recent ones — the "2026 World Cup" cycle
// alone (started December 2022) has already produced 60 finished USMNT
// fixtures. A small window silently undercounts caps/goals/minutes for any
// player who has played more than that window's worth of matches. This is
// only used for the expensive per-fixture crawl (triggered rarely, when a
// new match is detected), not the cheap polling check below. 99 is
// API-Football's hard ceiling for the `last` fixtures param (100+ is
// rejected outright), and comfortably covers the current cycle's 60 games.
const CYCLE_TOTAL_FIXTURES_WINDOW = 99;

// The stored match_logs rows (used for "recent match history" display) stay
// capped at a small, browsable number — cycle *totals* are aggregated from
// the full fetched set below, independently of this display cap.
const RECENT_MATCH_LOG_DISPLAY_CAP = 10;

/** Every USMNT fixture id currently recorded in our match logs, regardless of which player it's attached to — used to detect "has anything new finished". */
async function getSyncedFixtureIds(): Promise<Set<number>> {
  const rows = await db
    .select({ apiFootballFixtureId: matchLogsTable.apiFootballFixtureId })
    .from(matchLogsTable)
    .where(eq(matchLogsTable.isNationalTeam, true));
  return new Set(rows.map((r) => r.apiFootballFixtureId).filter((id): id is number => id != null));
}

/**
 * Syncs the USMNT senior men's national team's recent finished fixtures
 * (World Cup qualifiers, Nations League, friendlies) and, for whichever
 * tracked players actually appeared (minutes > 0), their per-match stats —
 * the same real-data-only approach as the club match-log sync, just scoped
 * to the national team. Runs once, shared across every tracked player who
 * got called in, rather than once per club.
 */
async function fetchUsmntMatchLogs(allPlayers: PlayerRow[], fixturesToCheck: number): Promise<{ logsByPlayer: Map<number, RealMatchLog[]>; finishedFixtureIds: Set<number> }> {
  const logsByPlayer = new Map<number, RealMatchLog[]>();
  const finishedFixtureIds = new Set<number>();
  const teamId = await resolveUsmntTeamId();
  if (!teamId) return { logsByPlayer, finishedFixtureIds };

  const resolvedPlayers = allPlayers.filter((p) => p.apiFootballPlayerId);
  if (resolvedPlayers.length === 0) return { logsByPlayer, finishedFixtureIds };
  const byApiId = new Map(resolvedPlayers.map((p) => [p.apiFootballPlayerId as number, p]));

  let fixtures: AfFixtureListItem[];
  try {
    fixtures = await afFetch<AfFixtureListItem[]>(`/fixtures?team=${teamId}&last=${fixturesToCheck}`);
  } catch (err) {
    logger.warn({ err }, "API-Football USMNT recent-fixtures fetch failed — skipping national-team match-log sync");
    return { logsByPlayer, finishedFixtureIds };
  }

  const finished = fixtures.filter((f) => FINISHED_STATUSES.has(f.fixture.status.short));
  for (const f of finished) finishedFixtureIds.add(f.fixture.id);

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

  // Most-recent-first. Intentionally NOT capped here — callers decide
  // separately how much of this to persist for display (see
  // RECENT_MATCH_LOG_DISPLAY_CAP) versus how much to aggregate into cycle
  // totals (the full list, so totals aren't undercounted).
  for (const [, logs] of logsByPlayer) {
    logs.sort((a, b) => (a.date < b.date ? 1 : -1));
  }
  return { logsByPlayer, finishedFixtureIds };
}

/**
 * Replaces every "national_team_cycle" row for a player with one row per
 * cycle that has real synced data — analogous to `replaceSeasonHistoryRows`
 * for club seasons, but keyed by World Cup cycle label instead of season
 * year. Clears the whole periodType first since which cycles have data can
 * change between runs (e.g. a fresh sync with a wider/narrower fixture window).
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
  ran: boolean; // false when the cheap check found nothing new and the expensive sync was skipped
  playersWithMatchLogs: number;
  cyclesWritten: number;
}

/**
 * Cheaply checks whether the USMNT has a newly-finished fixture since the
 * last run; if so, re-syncs match logs and cycle-tagged stats for every
 * tracked player. Skips the expensive per-fixture lineup fetch entirely when
 * nothing has changed, so this can run on a tight schedule without wasting
 * API-Football's rate-limited request budget.
 */
export async function syncUsmntStats(fixturesToCheck = 20): Promise<UsmntSyncResult> {
  const teamId = await resolveUsmntTeamId();
  if (!teamId) return { ran: false, playersWithMatchLogs: 0, cyclesWritten: 0 };

  let recentFixtures: AfFixtureListItem[];
  try {
    recentFixtures = await afFetch<AfFixtureListItem[]>(`/fixtures?team=${teamId}&last=${fixturesToCheck}`);
  } catch (err) {
    logger.warn({ err }, "API-Football USMNT fixture-status check failed — skipping this poll");
    return { ran: false, playersWithMatchLogs: 0, cyclesWritten: 0 };
  }

  const freshFinishedIds = new Set(recentFixtures.filter((f) => FINISHED_STATUSES.has(f.fixture.status.short)).map((f) => f.fixture.id));
  const alreadySynced = await getSyncedFixtureIds();
  const hasNewFinishedMatch = [...freshFinishedIds].some((id) => !alreadySynced.has(id));

  if (!hasNewFinishedMatch) {
    logger.info({ checked: recentFixtures.length }, "USMNT fixture check found nothing new — skipping full sync");
    return { ran: false, playersWithMatchLogs: 0, cyclesWritten: 0 };
  }

  const players: PlayerRow[] = await db
    .select({ id: playersTable.id, name: playersTable.name, clubId: playersTable.clubId, apiFootballPlayerId: playersTable.apiFootballPlayerId })
    .from(playersTable);

  // The cheap poll above only needs a small recent window to detect "did
  // anything finish" — but once we know a full crawl is warranted, fetch a
  // window wide enough to cover the whole current cycle so totals are
  // complete, not just however many fixtures the poll happened to check.
  const { logsByPlayer } = await fetchUsmntMatchLogs(players, CYCLE_TOTAL_FIXTURES_WINDOW);

  let playersWithMatchLogs = 0;
  let cyclesWritten = 0;
  for (const player of players) {
    const logs = logsByPlayer.get(player.id) ?? [];
    const logsForDisplay = logs.slice(0, RECENT_MATCH_LOG_DISPLAY_CAP);
    await db.delete(matchLogsTable).where(and(eq(matchLogsTable.playerId, player.id), eq(matchLogsTable.isNationalTeam, true)));
    if (logsForDisplay.length > 0) {
      await db.insert(matchLogsTable).values(
        logsForDisplay.map((l) => ({
          playerId: player.id,
          apiFootballFixtureId: l.apiFootballFixtureId,
          date: l.date,
          opponent: l.opponent,
          competition: l.competition,
          result: l.result,
          minutes: l.minutes,
          goals: l.goals,
          assists: l.assists,
          conceded: l.conceded,
          rating: l.rating,
          isNationalTeam: true,
          cycle: cycleForDate(l.date),
        })),
      );
      playersWithMatchLogs++;
    }

    const logsByCycle = new Map<string, RealMatchLog[]>();
    for (const log of logs) {
      const cycle = cycleForDate(log.date);
      logsByCycle.set(cycle, [...(logsByCycle.get(cycle) ?? []), log]);
    }
    const cycleEntries = [...logsByCycle.entries()]
      .map(([cycle, cycleLogs]) => ({ cycle, agg: aggregateFromMatchLogs(cycleLogs) }))
      .filter((e): e is { cycle: string; agg: AggregatedSeasonStats } => e.agg != null);
    await replaceCycleHistoryRows(player.id, cycleEntries);
    cyclesWritten += cycleEntries.length;
  }

  logger.info({ playersWithMatchLogs, cyclesWritten, newFixturesDetected: [...freshFinishedIds].filter((id) => !alreadySynced.has(id)).length }, "USMNT stats sync complete");
  return { ran: true, playersWithMatchLogs, cyclesWritten };
}

let intervalHandle: NodeJS.Timeout | null = null;

/**
 * Runs the cheap "did anything finish" check immediately, then hourly —
 * independent of the daily club-stats sync in playerStatsSync.ts. Cheap on
 * every poll (1 fixtures-list call); only pays for the expensive per-fixture
 * lineup sync when a new finished match is actually detected.
 */
export function startUsmntStatsSyncSchedule(intervalMs = 60 * 60 * 1000): void {
  if (!process.env["API_FOOTBALL_KEY"]) {
    logger.warn("API_FOOTBALL_KEY not set — skipping USMNT stats sync, no national-team match logs/cycle stats will be available");
    return;
  }
  syncUsmntStats().catch((err) => logger.error({ err }, "Initial USMNT stats sync failed"));
  intervalHandle = setInterval(() => {
    syncUsmntStats().catch((err) => logger.error({ err }, "Scheduled USMNT stats sync failed"));
  }, intervalMs);
}

export function stopUsmntStatsSyncSchedule(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}
