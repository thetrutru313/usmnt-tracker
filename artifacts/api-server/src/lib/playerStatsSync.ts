import { db, clubsTable, playersTable, playerStatsTable, matchLogsTable, injuriesTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { afFetch, resolveTeamId, FINISHED_STATUSES } from "./apiFootballSync";
import { ensurePlayerApiFootballIds, ageFromBirthDate } from "./playerClubSync";

// ---------------------------------------------------------------------------
// This module replaces the old seed's fabricated player_stats/match_logs/
// injuries rows with real data synced from API-Football. Nothing here is
// invented: fields API-Football doesn't report (xG, xA, progressive passes/
// carries, season-level clean sheets) are simply left off/null rather than
// defaulted to 0. See replit.md and .agents/memory/usmnt-tracker.md.
// ---------------------------------------------------------------------------

type ClubRow = { id: number; name: string; apiFootballTeamId: number | null };
type PlayerRow = { id: number; name: string; clubId: number; apiFootballPlayerId: number | null; age?: number };

// --- API-Football response shapes (only the fields we use) ---------------

export interface AfFixtureListItem {
  fixture: { id: number; date: string; status: { short: string } };
  league: { name: string };
  teams: { home: { id: number; name: string }; away: { id: number; name: string } };
  goals: { home: number | null; away: number | null };
}

export interface AfFixturePlayerStatBlock {
  games: { minutes: number | null; rating: string | null; position: string | null };
  goals: { total: number | null; assists: number | null };
}

export interface AfFixturePlayersTeam {
  team: { id: number; name: string };
  players: { player: { id: number; name: string }; statistics: AfFixturePlayerStatBlock[] }[];
}

export interface AfSeasonStatBlock {
  team: { id: number; name: string };
  league: { name: string; season: number };
  games: { minutes: number | null; lineups: number | null; position: string | null; rating: string | null };
  goals: { total: number | null; assists: number | null; conceded: number | null; saves: number | null };
  shots: { total: number | null };
  passes: { total: number | null; key: number | null; accuracy: string | null };
  tackles: { total: number | null; interceptions: number | null };
  duels: { total: number | null; won: number | null };
}

interface AfPlayerSeasonResponse {
  player: { id: number; birth: { date: string | null } };
  statistics: AfSeasonStatBlock[];
}

// API-Football reports one statistics block per competition/team a player
// appeared for in a given season — this includes preseason exhibition
// friendlies ("Friendlies Clubs") and, for internationals, their national
// team's own friendlies under a completely different `team`. Neither
// belongs in "club season" totals: friendlies aren't official competitive
// stats, and national-team appearances are tracked separately (see
// usmntSync.ts) and would otherwise double up here under the wrong label.
export const FRIENDLY_LEAGUE_PATTERN = /friendl/i;
export function isFriendlyLeague(leagueName: string): boolean {
  return FRIENDLY_LEAGUE_PATTERN.test(leagueName);
}

interface AfInjuryEntry {
  player: { id: number; name: string; type: string; reason: string }; // type e.g. "Missing Fixture"; reason e.g. "Hamstring Injury", "Yellow Cards" (suspension, not an injury)
  fixture: { id: number; date: string | null };
  team: { id: number; name: string };
  league: { season: number };
}

// Reasons API-Football lists under "injuries" that are actually suspensions
// (card accumulation/red card), not medical injuries — excluded so the
// injuries panel only shows genuine injuries.
const SUSPENSION_REASON_PATTERN = /card|suspen/i;

// Different leagues label "season" differently — MLS uses the calendar year,
// most European leagues use the year the season *started* (e.g. "2025" for
// the 2025/26 season, which is still the real "current" season through the
// following summer, before the new season's fixtures begin). Rather than
// guess from today's month (fragile and league-specific), candidates cover
// three consecutive years and callers pick "current"/"previous" by which
// candidates actually returned data — the two aggregates in this list are
// used for the injuries endpoint, which doesn't need "current vs previous"
// disambiguation, so plain freshest-first order is fine there.
function seasonYearCandidates(): number[] {
  const year = new Date().getUTCFullYear();
  return [year, year - 1, year - 2];
}

export function toNum(v: number | null | undefined): number {
  return v ?? 0;
}

export function toRating(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// --- Match logs -------------------------------------------------------------

export interface RealMatchLog {
  apiFootballFixtureId: number;
  date: string;
  opponent: string;
  competition: string;
  result: string;
  minutes: number;
  goals: number;
  assists: number;
  conceded: number | null;
  rating: number | null;
  isNationalTeam: boolean;
}

/**
 * Syncs the last few finished, real match logs per club (shared fixture-
 * players lookups across the whole roster) and returns them keyed by our
 * player id, most-recent first. Only players who actually appeared (minutes
 * > 0) get a row for a given fixture — a bench player who never got on the
 * pitch is correctly left with no entry, which is the root fix for the
 * original bug (a keeper with no row for a match he didn't play).
 */
async function syncClubMatchLogs(
  club: ClubRow,
  clubPlayers: PlayerRow[],
  fixturesPerClub: number,
): Promise<Map<number, RealMatchLog[]>> {
  const result = new Map<number, RealMatchLog[]>();
  const teamId = await resolveTeamId(club);
  if (!teamId) return result;

  const resolvedPlayers = clubPlayers.filter((p) => p.apiFootballPlayerId);
  if (resolvedPlayers.length === 0) return result;
  const byApiId = new Map(resolvedPlayers.map((p) => [p.apiFootballPlayerId as number, p]));

  let fixtures: AfFixtureListItem[];
  try {
    fixtures = await afFetch<AfFixtureListItem[]>(`/fixtures?team=${teamId}&last=${fixturesPerClub}`);
  } catch (err) {
    logger.warn({ err, club: club.name }, "API-Football recent-fixtures fetch failed — skipping match-log sync for club");
    return result;
  }

  const finished = fixtures.filter((f) => FINISHED_STATUSES.has(f.fixture.status.short));

  for (const f of finished) {
    let teams: AfFixturePlayersTeam[];
    try {
      teams = await afFetch<AfFixturePlayersTeam[]>(`/fixtures/players?fixture=${f.fixture.id}`);
    } catch (err) {
      logger.warn({ err, fixtureId: f.fixture.id, club: club.name }, "API-Football fixture-players fetch failed — skipping this match");
      continue;
    }

    const ourTeamBlock = teams.find((t) => t.team.id === teamId);
    if (!ourTeamBlock) continue;

    const isHome = f.teams.home.id === teamId;
    const opponent = isHome ? f.teams.away.name : f.teams.home.name;
    const conceded = isHome ? f.goals.away : f.goals.home;
    const ourGoals = isHome ? f.goals.home : f.goals.away;
    const theirGoals = isHome ? f.goals.away : f.goals.home;
    const outcome =
      ourGoals == null || theirGoals == null ? "" : ourGoals > theirGoals ? "W" : ourGoals < theirGoals ? "L" : "D";
    const scoreLine = ourGoals != null && theirGoals != null ? `${outcome} ${ourGoals}-${theirGoals}` : "";

    for (const entry of ourTeamBlock.players) {
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
        isNationalTeam: false,
      };
      const existing = result.get(player.id) ?? [];
      existing.push(log);
      result.set(player.id, existing);
    }
  }

  // Most-recent-first, capped at 10 per player. 10 gives us both a "last5"
  // window (logs[0..4]) and a "previous5" window (logs[5..9]) for trend
  // computation — see computeFormTier below.
  for (const [playerId, logs] of result) {
    logs.sort((a, b) => (a.date < b.date ? 1 : -1));
    result.set(playerId, logs.slice(0, 10));
  }
  return result;
}

// --- Season stats ------------------------------------------------------------

export interface AggregatedSeasonStats {
  minutes: number;
  starts: number;
  goals: number;
  assists: number;
  shots: number;
  keyPasses: number;
  passCompletionPct: number | null;
  tackles: number;
  interceptions: number;
  duelsWonPct: number | null;
  savePct: number | null;
  avgRating: number | null;
}

/**
 * Aggregates a player's season statistics blocks into club-season totals,
 * scoped to their actual club: blocks for friendly/exhibition competitions
 * (preseason "Friendlies Clubs", national-team "Friendlies") are dropped,
 * and — as a second, independent safeguard — any block whose `team` isn't
 * the player's on-file club is dropped too, so a national-team appearance
 * can never contribute to a "club season" row regardless of league name.
 */
export function aggregateSeasonBlocks(allBlocks: AfSeasonStatBlock[], clubTeamId: number | null): AggregatedSeasonStats | null {
  const blocks = allBlocks.filter((b) => !isFriendlyLeague(b.league.name) && (clubTeamId == null || b.team.id === clubTeamId));
  if (blocks.length === 0) return null;

  let minutes = 0;
  let starts = 0;
  let goals = 0;
  let assists = 0;
  let shots = 0;
  let keyPasses = 0;
  let tackles = 0;
  let interceptions = 0;
  let duelsTotal = 0;
  let duelsWon = 0;
  let saves = 0;
  let conceded = 0;
  let isGoalkeeper = false;
  let passWeightedSum = 0;
  let passWeight = 0;
  let ratingWeightedSum = 0;
  let ratingWeight = 0;

  for (const b of blocks) {
    minutes += toNum(b.games.minutes);
    starts += toNum(b.games.lineups);
    goals += toNum(b.goals.total);
    assists += toNum(b.goals.assists);
    shots += toNum(b.shots.total);
    keyPasses += toNum(b.passes.key);
    tackles += toNum(b.tackles.total);
    interceptions += toNum(b.tackles.interceptions);
    duelsTotal += toNum(b.duels.total);
    duelsWon += toNum(b.duels.won);
    saves += toNum(b.goals.saves);
    conceded += toNum(b.goals.conceded);
    if (b.games.position === "Goalkeeper" || b.games.position === "G") isGoalkeeper = true;

    const passWeightForBlock = toNum(b.passes.total);
    const accuracy = b.passes.accuracy != null ? parseFloat(b.passes.accuracy) : null;
    if (accuracy != null && Number.isFinite(accuracy) && passWeightForBlock > 0) {
      passWeightedSum += accuracy * passWeightForBlock;
      passWeight += passWeightForBlock;
    }

    const rating = toRating(b.games.rating);
    const blockMinutes = toNum(b.games.minutes);
    if (rating != null && blockMinutes > 0) {
      ratingWeightedSum += rating * blockMinutes;
      ratingWeight += blockMinutes;
    }
  }

  return {
    minutes,
    starts,
    goals,
    assists,
    shots,
    keyPasses,
    passCompletionPct: passWeight > 0 ? passWeightedSum / passWeight : null,
    tackles,
    interceptions,
    duelsWonPct: duelsTotal > 0 ? (duelsWon / duelsTotal) * 100 : null,
    savePct: isGoalkeeper && saves + conceded > 0 ? (saves / (saves + conceded)) * 100 : null,
    avgRating: ratingWeight > 0 ? ratingWeightedSum / ratingWeight : null,
  };
}

/** Also returns the player's birth date from the same response — no extra API call needed to keep `age` live (see `syncPlayerStatsAndInjuries`). */
async function fetchSeasonStats(apiFootballPlayerId: number, season: number): Promise<{ statistics: AfSeasonStatBlock[]; birthDate: string | null }> {
  try {
    const [data] = await afFetch<AfPlayerSeasonResponse[]>(`/players?id=${apiFootballPlayerId}&season=${season}`);
    return { statistics: data?.statistics ?? [], birthDate: data?.player.birth.date ?? null };
  } catch (err) {
    logger.warn({ err, apiFootballPlayerId, season }, "API-Football player season-stats fetch failed");
    return { statistics: [], birthDate: null };
  }
}

export function aggregateFromMatchLogs(logs: RealMatchLog[]): AggregatedSeasonStats | null {
  if (logs.length === 0) return null;
  const minutes = logs.reduce((s, l) => s + l.minutes, 0);
  const goals = logs.reduce((s, l) => s + l.goals, 0);
  const assists = logs.reduce((s, l) => s + l.assists, 0);
  const rated = logs.filter((l) => l.rating != null) as (RealMatchLog & { rating: number })[];
  const avgRating = rated.length > 0 ? rated.reduce((s, l) => s + l.rating, 0) / rated.length : null;
  return {
    minutes,
    starts: logs.filter((l) => l.minutes >= 60).length, // API-Football's fixture-players endpoint doesn't flag starts directly; 60+ minutes is a reasonable real-data proxy, not a fabrication of unknown data.
    goals,
    assists,
    shots: 0,
    keyPasses: 0,
    passCompletionPct: null,
    tackles: 0,
    interceptions: 0,
    duelsWonPct: null,
    savePct: null,
    avgRating,
  };
}

type PeriodType = "season" | "last5" | "previous5" | "previous_season" | "season_all";

export type PerformanceTrend = "on_fire" | "rising" | "steady" | "falling" | "ice_cold";

/**
 * Derives a player's form tier from their last-5 match ratings relative to
 * their season baseline, with an optional trajectory boost from the
 * previous-5 window.
 *
 * Formula: score = 50 × (last5Avg − seasonAvg) + 30 × (last5Avg − prev5Avg)
 *
 * The season-baseline term is the primary signal (position-agnostic — a CB at
 * 6.9 and a striker at 7.4 can both be On Fire if both are above their own
 * norms). The trajectory term is additive context when available.
 *
 * Confidence gate: fewer than 270 minutes played across the last 5 matches →
 * "steady" (not enough data to label reliably).
 */
export function computeFormTier(
  last5: AggregatedSeasonStats | null,
  prev5: AggregatedSeasonStats | null,
  seasonAvgRating: number | null,
): { trend: PerformanceTrend; trending: boolean } {
  const STEADY: { trend: PerformanceTrend; trending: boolean } = { trend: "steady", trending: false };
  if (!last5 || last5.minutes < 270 || last5.avgRating == null || seasonAvgRating == null) return STEADY;

  const seasonDelta = last5.avgRating - seasonAvgRating;
  let score = 50 * seasonDelta;
  if (prev5?.avgRating != null) score += 30 * (last5.avgRating - prev5.avgRating);

  let trend: PerformanceTrend;
  if (score >= 25) trend = "on_fire";
  else if (score >= 12) trend = "rising";
  else if (score > -12) trend = "steady";
  else if (score > -25) trend = "falling";
  else trend = "ice_cold";

  return { trend, trending: trend === "on_fire" || trend === "rising" };
}

/** Clears a period's stats row entirely — used when this run has no fresh data for that period, so a stale row from a prior run/seed never lingers. */
async function deleteStatsRow(playerId: number, periodType: PeriodType): Promise<void> {
  await db.delete(playerStatsTable).where(and(eq(playerStatsTable.playerId, playerId), eq(playerStatsTable.periodType, periodType)));
}

async function upsertStatsRow(playerId: number, periodType: PeriodType, season: string, stats: AggregatedSeasonStats, cleanSheets: number | null): Promise<void> {
  // Delete scoped only by periodType (not season) — "season"/"previous_season"/
  // "last5" each keep exactly one row per player, and the season *label* for
  // that row can shift between runs (e.g. the year rolls over), so filtering
  // the delete by the new label too would leave the old row behind as a
  // stale duplicate.
  await db.delete(playerStatsTable).where(and(eq(playerStatsTable.playerId, playerId), eq(playerStatsTable.periodType, periodType)));
  await db.insert(playerStatsTable).values({
    playerId,
    periodType,
    season,
    minutes: stats.minutes,
    starts: stats.starts,
    goals: stats.goals,
    assists: stats.assists,
    shots: stats.shots,
    keyPasses: stats.keyPasses,
    passCompletionPct: stats.passCompletionPct,
    tackles: stats.tackles,
    interceptions: stats.interceptions,
    duelsWonPct: stats.duelsWonPct,
    cleanSheets,
    savePct: stats.savePct,
    avgRating: stats.avgRating,
  });
}

/**
 * Replaces every "season_all" row for a player with the given set of
 * (year, stats) pairs — one row per season year with real data, powering the
 * club-season selector on the player profile. Unlike `upsertStatsRow`, which
 * only clears the matching (periodType, season) pair, this clears the whole
 * periodType first since the set of years with data can shrink between runs
 * (e.g. a player transfers to a club with no historical stats for API-Football).
 */
async function replaceSeasonHistoryRows(playerId: number, entries: { year: number; agg: AggregatedSeasonStats }[]): Promise<void> {
  await db.delete(playerStatsTable).where(and(eq(playerStatsTable.playerId, playerId), eq(playerStatsTable.periodType, "season_all")));
  for (const { year, agg } of entries) {
    await db.insert(playerStatsTable).values({
      playerId,
      periodType: "season_all",
      season: `${year}`,
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

// --- Injuries ----------------------------------------------------------------

/** Groups a player's real "missing fixture" entries into injury episodes (gaps > 45 days start a new episode). */
function groupInjuryEpisodes(entries: AfInjuryEntry[]): { reason: string; start: string; end: string; matches: number }[] {
  const sorted = [...entries]
    .filter((e) => e.fixture.date && !SUSPENSION_REASON_PATTERN.test(e.player.reason))
    .sort((a, b) => (a.fixture.date! < b.fixture.date! ? -1 : 1));

  const episodes: { reason: string; start: string; end: string; matches: number }[] = [];
  for (const entry of sorted) {
    const date = entry.fixture.date!.slice(0, 10);
    const last = episodes.at(-1);
    if (last && last.reason === entry.player.reason && Date.parse(date) - Date.parse(last.end) <= 45 * 24 * 60 * 60 * 1000) {
      last.end = date;
      last.matches++;
    } else {
      episodes.push({ reason: entry.player.reason, start: date, end: date, matches: 1 });
    }
  }
  return episodes;
}

async function syncClubInjuries(club: ClubRow, clubPlayers: PlayerRow[]): Promise<number> {
  // Resolve what fresh data we can, but never skip the clear-stale-rows step
  // below on early return — an unresolved team id or no API ids must still
  // wipe any injuries left over from a previous run/seed, not just leave
  // early with old rows intact.
  const teamId = await resolveTeamId(club);
  const byApiId = new Map(clubPlayers.filter((p) => p.apiFootballPlayerId).map((p) => [p.apiFootballPlayerId as number, p]));

  let allEntries: AfInjuryEntry[] = [];
  if (teamId && byApiId.size > 0) {
    for (const season of seasonYearCandidates()) {
      try {
        const entries = await afFetch<AfInjuryEntry[]>(`/injuries?team=${teamId}&season=${season}`);
        allEntries = allEntries.concat(entries);
      } catch (err) {
        logger.warn({ err, club: club.name, season }, "API-Football injuries fetch failed for season");
      }
    }
  }

  const byPlayer = new Map<number, AfInjuryEntry[]>();
  for (const entry of allEntries) {
    const player = byApiId.get(entry.player.id);
    if (!player) continue;
    byPlayer.set(player.id, [...(byPlayer.get(player.id) ?? []), entry]);
  }

  let written = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const player of clubPlayers) {
    const entries = byPlayer.get(player.id) ?? [];
    const episodes = groupInjuryEpisodes(entries);
    await db.delete(injuriesTable).where(eq(injuriesTable.playerId, player.id));
    for (const ep of episodes) {
      const daysMissed = Math.round((Date.parse(ep.end) - Date.parse(ep.start)) / (24 * 60 * 60 * 1000)) + 1;
      const status = ep.end >= today ? "active" : "returned";
      await db.insert(injuriesTable).values({
        playerId: player.id,
        bodyPart: ep.reason,
        status,
        expectedReturn: null, // API-Football doesn't report a projected return date — left null rather than guessed.
        daysMissed,
        matchesMissed: ep.matches,
        latestUpdate:
          status === "active"
            ? `Ruled out (${ep.reason}) — missed ${ep.matches} match${ep.matches === 1 ? "" : "es"} as of ${ep.end}.`
            : `Missed ${ep.matches} match${ep.matches === 1 ? "" : "es"} between ${ep.start} and ${ep.end} (${ep.reason}).`,
        startDate: ep.start,
      });
      written++;
    }
  }
  return written;
}

// --- Orchestration -----------------------------------------------------------

export interface PlayerStatsSyncResult {
  clubsProcessed: number;
  playersWithMatchLogs: number;
  playersWithSeasonStats: number;
  injuriesWritten: number;
  failures: number;
}

/**
 * Full live-data sync for club player season stats, match logs, and
 * injuries. Runs club-by-club so fixture/fixture-players calls are shared
 * across every tracked player at that club, keeping the per-player API-call
 * cost manageable under the 7s/request throttle (see apiFootballSync.ts).
 */
export async function syncPlayerStatsAndInjuries(fixturesPerClub = 12): Promise<PlayerStatsSyncResult> {
  const clubs: ClubRow[] = await db
    .select({ id: clubsTable.id, name: clubsTable.name, apiFootballTeamId: clubsTable.apiFootballTeamId })
    .from(clubsTable);
  const players: PlayerRow[] = await db
    .select({ id: playersTable.id, name: playersTable.name, clubId: playersTable.clubId, apiFootballPlayerId: playersTable.apiFootballPlayerId, age: playersTable.age })
    .from(playersTable);
  const clubsById = new Map(clubs.map((c) => [c.id, c]));

  await ensurePlayerApiFootballIds(players, clubsById);

  const playersByClub = new Map<number, PlayerRow[]>();
  for (const p of players) playersByClub.set(p.clubId, [...(playersByClub.get(p.clubId) ?? []), p]);

  let clubsProcessed = 0;
  let playersWithMatchLogs = 0;
  let playersWithSeasonStats = 0;
  let injuriesWritten = 0;
  let failures = 0;

  const [currentSeason] = seasonYearCandidates();

  for (const club of clubs) {
    const clubPlayers = playersByClub.get(club.id) ?? [];
    if (clubPlayers.length === 0) continue;

    try {
      const matchLogsByPlayer = await syncClubMatchLogs(club, clubPlayers, fixturesPerClub);

      for (const player of clubPlayers) {
        const logs = matchLogsByPlayer.get(player.id) ?? [];
        // Always clear stale club match logs first — a player with no logs
        // this run (no fresh appearances, unresolved id, etc.) must end up
        // with none, not whatever was left from a previous seed/sync. Scoped
        // to isNationalTeam=false so this never touches that player's
        // separately-synced USMNT match logs.
        await db.delete(matchLogsTable).where(and(eq(matchLogsTable.playerId, player.id), eq(matchLogsTable.isNationalTeam, false)));
        if (logs.length > 0) {
          await db.insert(matchLogsTable).values(
            logs.map((l) => ({
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
              isNationalTeam: l.isNationalTeam,
            })),
          );
          playersWithMatchLogs++;
        }

        // "last5" and "previous5" are both derived from the match logs above.
        // Clear them whenever there's no fresh data rather than leaving a
        // prior run's row in place. "previous5" is logs[5..9] — the window
        // before last5 — used for the trajectory term in computeFormTier.
        const last5 = aggregateFromMatchLogs(logs.slice(0, 5));
        if (last5) {
          const cleanSheets = logs.slice(0, 5).filter((l) => l.conceded === 0).length;
          await upsertStatsRow(player.id, "last5", `${currentSeason}`, last5, cleanSheets);
        } else {
          await deleteStatsRow(player.id, "last5");
        }
        const prev5 = aggregateFromMatchLogs(logs.slice(5, 10));
        if (prev5) {
          await upsertStatsRow(player.id, "previous5", `${currentSeason}`, prev5, null);
        } else {
          await deleteStatsRow(player.id, "previous5");
        }

        if (!player.apiFootballPlayerId) {
          // No resolved API-Football id this run — can't fetch season
          // stats, so any prior season/previous_season rows are stale.
          await deleteStatsRow(player.id, "season");
          await deleteStatsRow(player.id, "previous_season");
          continue;
        }
        // Query several consecutive season-year labels and aggregate each —
        // don't assume which one is "current" up front (see seasonYearCandidates
        // for why). Whichever candidates actually returned real data, the
        // most recent becomes "season" and the next-most-recent "previous_season".
        const seasonYears = seasonYearCandidates();
        const clubTeamId = await resolveTeamId(club);
        const blocksByYear = await Promise.all(seasonYears.map((y) => fetchSeasonStats(player.apiFootballPlayerId!, y)));
        const withData = seasonYears
          .map((year, i) => ({ year, agg: aggregateSeasonBlocks(blocksByYear[i].statistics, clubTeamId) }))
          .filter((entry): entry is { year: number; agg: AggregatedSeasonStats } => entry.agg != null)
          .sort((a, b) => b.year - a.year);

        // Keep `age` live from the same responses (no extra API call) —
        // seed data otherwise freezes a player's age at whatever it was when
        // added and it silently drifts stale as real birthdays pass.
        const birthDate = blocksByYear.map((b) => b.birthDate).find((d): d is string => d != null) ?? null;
        const liveAge = ageFromBirthDate(birthDate);
        if (liveAge != null && liveAge !== player.age) {
          await db.update(playersTable).set({ age: liveAge }).where(eq(playersTable.id, player.id));
          player.age = liveAge;
        }

        const [current, previous] = withData;
        if (current) {
          await upsertStatsRow(player.id, "season", `${current.year}`, current.agg, null);
          playersWithSeasonStats++;
        } else {
          await deleteStatsRow(player.id, "season");
        }
        if (previous) {
          await upsertStatsRow(player.id, "previous_season", `${previous.year}`, previous.agg, null);
        } else {
          await deleteStatsRow(player.id, "previous_season");
        }
        // Keep every season-year that returned real data (not just the
        // latest two) so the player profile's club-season selector has more
        // than just "current"/"previous" to choose from.
        await replaceSeasonHistoryRows(player.id, withData);

        // Update form tier now that we have all three pieces: last5 ratings
        // from match logs, previous5 ratings (trajectory), and season avg
        // (the player's own baseline for this season). We write it regardless
        // of whether the value changed so each run reflects the latest sync.
        const { trend, trending } = computeFormTier(last5, prev5, current?.agg.avgRating ?? null);
        await db.update(playersTable).set({ performanceTrend: trend, trending }).where(eq(playersTable.id, player.id));
      }

      injuriesWritten += await syncClubInjuries(club, clubPlayers);
      clubsProcessed++;
      logger.info({ club: club.name, clubsProcessed, totalClubs: clubs.length }, "Player-stats sync progress");
    } catch (err) {
      failures++;
      logger.warn({ err, club: club.name }, "Player-stats sync failed for club");
    }
  }

  // USMNT national-team match logs + cycle stats now sync independently on
  // their own schedule — see usmntSync.ts — rather than as the last step of
  // this per-club loop.

  logger.info(
    { clubsProcessed, playersWithMatchLogs, playersWithSeasonStats, injuriesWritten, failures },
    "Player stats/match-log/injuries sync complete",
  );
  return { clubsProcessed, playersWithMatchLogs, playersWithSeasonStats, injuriesWritten, failures };
}

let intervalHandle: NodeJS.Timeout | null = null;

/**
 * Runs the sync immediately, then daily. First-run volume is roughly
 * 3-4 calls/player (season + previous-season stats, shared match-log/
 * injuries calls per club) — at the enforced 7s/request throttle that's
 * ~30+ minutes for the full roster, too heavy to run more than once a day.
 */
export function startPlayerStatsSyncSchedule(intervalMs = 24 * 60 * 60 * 1000): void {
  if (!process.env["API_FOOTBALL_KEY"]) {
    logger.warn("API_FOOTBALL_KEY not set — skipping live player-stats sync, no season stats/match logs/injuries will be available");
    return;
  }
  syncPlayerStatsAndInjuries().catch((err) => logger.error({ err }, "Initial player-stats sync failed"));
  intervalHandle = setInterval(() => {
    syncPlayerStatsAndInjuries().catch((err) => logger.error({ err }, "Scheduled player-stats sync failed"));
  }, intervalMs);
}

export function stopPlayerStatsSyncSchedule(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}
