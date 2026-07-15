import { db, clubsTable, playersTable, playerStatsTable, matchLogsTable, injuriesTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { afFetch, resolveTeamId, resolveUsmntTeamId, FINISHED_STATUSES } from "./apiFootballSync";
import { ensurePlayerApiFootballIds } from "./playerClubSync";

// ---------------------------------------------------------------------------
// This module replaces the old seed's fabricated player_stats/match_logs/
// injuries rows with real data synced from API-Football. Nothing here is
// invented: fields API-Football doesn't report (xG, xA, progressive passes/
// carries, season-level clean sheets) are simply left off/null rather than
// defaulted to 0. See replit.md and .agents/memory/usmnt-tracker.md.
// ---------------------------------------------------------------------------

type ClubRow = { id: number; name: string; apiFootballTeamId: number | null };
type PlayerRow = { id: number; name: string; clubId: number; apiFootballPlayerId: number | null };

// --- API-Football response shapes (only the fields we use) ---------------

interface AfFixtureListItem {
  fixture: { id: number; date: string; status: { short: string } };
  league: { name: string };
  teams: { home: { id: number; name: string }; away: { id: number; name: string } };
  goals: { home: number | null; away: number | null };
}

interface AfFixturePlayerStatBlock {
  games: { minutes: number | null; rating: string | null; position: string | null };
  goals: { total: number | null; assists: number | null };
}

interface AfFixturePlayersTeam {
  team: { id: number; name: string };
  players: { player: { id: number; name: string }; statistics: AfFixturePlayerStatBlock[] }[];
}

interface AfSeasonStatBlock {
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
  player: { id: number };
  statistics: AfSeasonStatBlock[];
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

function toNum(v: number | null | undefined): number {
  return v ?? 0;
}

function toRating(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// --- Match logs -------------------------------------------------------------

interface RealMatchLog {
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

  // Most-recent-first, capped at 5 per player.
  for (const [playerId, logs] of result) {
    logs.sort((a, b) => (a.date < b.date ? 1 : -1));
    result.set(playerId, logs.slice(0, 5));
  }
  return result;
}

/**
 * Syncs the USMNT senior men's national team's recent finished fixtures
 * (World Cup qualifiers, Nations League, friendlies) and, for whichever
 * tracked players actually appeared (minutes > 0), their per-match stats —
 * the same real-data-only approach as `syncClubMatchLogs`, just scoped to
 * the national team instead of a club. Runs once per full sync (not once per
 * club) since it's a single team's fixture list shared across every tracked
 * player who got called in.
 */
async function syncUsmntMatchLogs(allPlayers: PlayerRow[], fixturesToCheck: number): Promise<Map<number, RealMatchLog[]>> {
  const result = new Map<number, RealMatchLog[]>();
  const teamId = await resolveUsmntTeamId();
  if (!teamId) return result;

  const resolvedPlayers = allPlayers.filter((p) => p.apiFootballPlayerId);
  if (resolvedPlayers.length === 0) return result;
  const byApiId = new Map(resolvedPlayers.map((p) => [p.apiFootballPlayerId as number, p]));

  let fixtures: AfFixtureListItem[];
  try {
    fixtures = await afFetch<AfFixtureListItem[]>(`/fixtures?team=${teamId}&last=${fixturesToCheck}`);
  } catch (err) {
    logger.warn({ err }, "API-Football USMNT recent-fixtures fetch failed — skipping national-team match-log sync");
    return result;
  }

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
      const existing = result.get(player.id) ?? [];
      existing.push(log);
      result.set(player.id, existing);
    }
  }

  // Most-recent-first, capped at 10 per player — more than the 5 kept for
  // club matches since these feed the USMNT-cycle stat aggregation, not just
  // the merged recent-matches display.
  for (const [playerId, logs] of result) {
    logs.sort((a, b) => (a.date < b.date ? 1 : -1));
    result.set(playerId, logs.slice(0, 10));
  }
  return result;
}

// --- Season stats ------------------------------------------------------------

interface AggregatedSeasonStats {
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

function aggregateSeasonBlocks(blocks: AfSeasonStatBlock[]): AggregatedSeasonStats | null {
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

async function fetchSeasonStats(apiFootballPlayerId: number, season: number): Promise<AfSeasonStatBlock[]> {
  try {
    const [data] = await afFetch<AfPlayerSeasonResponse[]>(`/players?id=${apiFootballPlayerId}&season=${season}`);
    return data?.statistics ?? [];
  } catch (err) {
    logger.warn({ err, apiFootballPlayerId, season }, "API-Football player season-stats fetch failed");
    return [];
  }
}

function aggregateFromMatchLogs(logs: RealMatchLog[]): AggregatedSeasonStats | null {
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

type PeriodType = "season" | "last5" | "previous_season" | "season_all" | "national_team";

/** Clears a period's stats row entirely — used when this run has no fresh data for that period, so a stale row from a prior run/seed never lingers. */
async function deleteStatsRow(playerId: number, periodType: PeriodType): Promise<void> {
  await db.delete(playerStatsTable).where(and(eq(playerStatsTable.playerId, playerId), eq(playerStatsTable.periodType, periodType)));
}

async function upsertStatsRow(playerId: number, periodType: PeriodType, season: string, stats: AggregatedSeasonStats, cleanSheets: number | null): Promise<void> {
  // Delete scoped only by periodType (not season) — "season"/"previous_season"/
  // "last5"/"national_team" each keep exactly one row per player, and the
  // season *label* for that row can shift between runs (e.g. the year rolls
  // over), so filtering the delete by the new label too would leave the old
  // row behind as a stale duplicate.
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
export async function syncPlayerStatsAndInjuries(fixturesPerClub = 8): Promise<PlayerStatsSyncResult> {
  const clubs: ClubRow[] = await db
    .select({ id: clubsTable.id, name: clubsTable.name, apiFootballTeamId: clubsTable.apiFootballTeamId })
    .from(clubsTable);
  const players: PlayerRow[] = await db
    .select({ id: playersTable.id, name: playersTable.name, clubId: playersTable.clubId, apiFootballPlayerId: playersTable.apiFootballPlayerId })
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

        // Same rule for the "last5" stats row: it's derived solely from the
        // match logs above, so clear it whenever there are no logs to
        // aggregate rather than leaving a prior run's row in place.
        const last5 = aggregateFromMatchLogs(logs);
        if (last5) {
          const cleanSheets = logs.filter((l) => l.conceded === 0).length;
          await upsertStatsRow(player.id, "last5", `${currentSeason}`, last5, cleanSheets);
        } else {
          await deleteStatsRow(player.id, "last5");
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
        const blocksByYear = await Promise.all(seasonYears.map((y) => fetchSeasonStats(player.apiFootballPlayerId!, y)));
        const withData = seasonYears
          .map((year, i) => ({ year, agg: aggregateSeasonBlocks(blocksByYear[i]) }))
          .filter((entry): entry is { year: number; agg: AggregatedSeasonStats } => entry.agg != null)
          .sort((a, b) => b.year - a.year);

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
      }

      injuriesWritten += await syncClubInjuries(club, clubPlayers);
      clubsProcessed++;
      logger.info({ club: club.name, clubsProcessed, totalClubs: clubs.length }, "Player-stats sync progress");
    } catch (err) {
      failures++;
      logger.warn({ err, club: club.name }, "Player-stats sync failed for club");
    }
  }

  // USMNT national-team match logs + cycle stats — one shared fixture list
  // for every tracked player, run once per full sync rather than per club.
  try {
    const usmntLogsByPlayer = await syncUsmntMatchLogs(players, 20);
    for (const player of players) {
      const logs = usmntLogsByPlayer.get(player.id) ?? [];
      await db.delete(matchLogsTable).where(and(eq(matchLogsTable.playerId, player.id), eq(matchLogsTable.isNationalTeam, true)));
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
            isNationalTeam: true,
          })),
        );
      }
      const cycleAgg = aggregateFromMatchLogs(logs);
      if (cycleAgg) {
        await upsertStatsRow(player.id, "national_team", "Current Cycle", cycleAgg, null);
      } else {
        await deleteStatsRow(player.id, "national_team");
      }
    }
  } catch (err) {
    logger.warn({ err }, "USMNT national-team match-log/stats sync failed");
  }

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
