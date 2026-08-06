import { db, clubsTable, playersTable, playerStatsTable, matchLogsTable, injuriesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
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
type PlayerRow = {
  id: number;
  name: string;
  clubId: number;
  apiFootballPlayerId: number | null;
  age?: number;
  dateOfBirth?: string | null;
  category?: string | null;
  nationalTeamCaps?: number | null;
  marketValueUsd?: number | null;
};

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

// USA national-team id in API-Football. Injuries from World Cup / Gold Cup /
// Nations League fixtures are filed under this team, not the player's club.
// We fetch this team's injuries once per sync run and merge them alongside
// each club's data so national-competition injuries aren't silently dropped.
const USA_NATIONAL_TEAM_ID = 2384;

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
 *
 * `teamId` is resolved once per club by the caller (`syncPlayerStatsAndInjuries`)
 * and passed in here so `resolveTeamId` is not called a second time per club.
 */
async function syncClubMatchLogs(
  club: ClubRow,
  clubPlayers: PlayerRow[],
  fixturesPerClub: number,
  teamId: number | null,
): Promise<Map<number, RealMatchLog[]>> {
  const result = new Map<number, RealMatchLog[]>();
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
/**
 * @param teamFilter
 *   - `number`       — include only blocks for that specific team (current-club mode)
 *   - `Set<number>`  — include blocks for any team in the set (all-clubs mode for history)
 *   - `null`         — include all non-friendly blocks regardless of team (no longer used
 *                      in production paths; kept for tests that pre-date the Set variant)
 */
export function aggregateSeasonBlocks(allBlocks: AfSeasonStatBlock[], teamFilter: number | Set<number> | null): AggregatedSeasonStats | null {
  const blocks = allBlocks.filter((b) => {
    if (isFriendlyLeague(b.league.name)) return false;
    if (teamFilter === null) return true;
    if (typeof teamFilter === "number") return b.team.id === teamFilter;
    return teamFilter.has(b.team.id);
  });
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

  // Trajectory gate: "rising" and "on_fire" require the last-5 average to be
  // at least as high as the prior-5 average. Without this, a player with a
  // very low season baseline (dragged down by a bad early stretch) can score
  // into "rising" even while every recent game is worse than the five before
  // it. When the trajectory is downward, cap the tier at "steady".
  const trajectoryIsDown = prev5?.avgRating != null && last5.avgRating < prev5.avgRating;

  let trend: PerformanceTrend;
  if (!trajectoryIsDown && score >= 25) trend = "on_fire";
  else if (!trajectoryIsDown && score >= 12) trend = "rising";
  else if (score > -12) trend = "steady";
  else if (score > -25) trend = "falling";
  else trend = "ice_cold";

  return { trend, trending: trend === "on_fire" || trend === "rising" };
}


/**
 * Computes a 0–100 integer "call-up score" for a player based on all live
 * signals that are available after each daily sync cycle.  The score is most
 * meaningful for fringe and prospect players competing for a squad spot; core
 * veterans with 30+ caps already have their place secured and receive `null`.
 *
 * Signals (all additive from a base of 40):
 *   • Form tier        –18 → +20
 *   • Playing time     –15 → +15  (season minutes / 2 700 min ≈ 30 full games)
 *   • Age              –10 → +10  (youth bonus / veteran penalty)
 *   • Caps             –5  → +5   (emerging players get a slight boost)
 *   • Last-5 avg rating –8 → +8   (bracketed on 6.0 / 6.5 / 7.0 / 7.5)
 *   • Market value     0   → +8   (log-scale, soft signal)
 *   • Active injury    –15         (if player is currently ruled out)
 *
 * Result is clamped to [0, 100].
 */
export function computeCallUpScore(
  player: { category?: string | null; nationalTeamCaps?: number | null; marketValueUsd?: number | null; age?: number | null },
  performanceTrend: string,
  seasonMinutes: number | null,
  last5AvgRating: number | null,
  hasActiveInjury: boolean,
): number | null {
  // Established core players aren't competing for spots — score not applicable.
  if (player.category === "current" && (player.nationalTeamCaps ?? 0) >= 30) return null;

  let score = 40;

  // Form tier
  const formBonus: Record<string, number> = { on_fire: 20, rising: 12, steady: 0, falling: -10, ice_cold: -18 };
  score += formBonus[performanceTrend] ?? 0;

  // Playing time — how much of a full season has the player contributed?
  if (seasonMinutes != null) {
    const fraction = Math.min(seasonMinutes / 2700, 1.0);
    score += Math.round((fraction - 0.5) * 30); // −15 → +15
  }

  // Age bonus/penalty
  const age = player.age ?? 26;
  if (age < 20) score += 10;
  else if (age < 23) score += 6;
  else if (age < 26) score += 2;
  else if (age < 29) score += 0;
  else if (age < 32) score -= 5;
  else score -= 10;

  // Caps — some senior experience helps; too many means the slot is less contested
  const caps = player.nationalTeamCaps ?? 0;
  if (caps === 0) score += 0;
  else if (caps <= 10) score += 5;
  else if (caps <= 20) score += 3;
  else if (caps <= 30) score += 0;
  else score -= 5;

  // Last-5 avg rating
  if (last5AvgRating != null) {
    if (last5AvgRating > 7.5) score += 8;
    else if (last5AvgRating > 7.0) score += 4;
    else if (last5AvgRating > 6.5) score += 0;
    else if (last5AvgRating > 6.0) score -= 4;
    else score -= 8;
  }

  // Market value — soft signal, log-scale, capped at +8
  const mv = player.marketValueUsd;
  if (mv && mv > 0) {
    // $1 M → 0 pts, $5 M → +2.8, $10 M → +4, $30 M → +6, $100 M → +8
    score += Math.min(Math.round(Math.log10(mv / 1_000_000) * 4), 8);
  }

  // Active injury penalty
  if (hasActiveInjury) score -= 15;

  return Math.max(0, Math.min(100, Math.round(score)));
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

/**
 * Groups a player's injury entries into episodes (gaps > 45 days start a new episode).
 *
 * Entries without a fixture date (pre-season / offseason injuries where no match has
 * been missed yet) are included but use `today` as their placeholder date. Those
 * entries do NOT increment the `matches` counter — they represent "currently out
 * but hasn't missed a match yet". The `hasFixturelessEntry` flag on the episode
 * lets callers produce the right status text.
 */
export function groupInjuryEpisodes(
  entries: AfInjuryEntry[],
  today: string,
): { reason: string; start: string; end: string; matches: number; hasFixturelessEntry: boolean }[] {
  // Non-suspensions only. Null fixture dates become today (offseason / pre-season injuries).
  const eligible = [...entries]
    .filter((e) => !SUSPENSION_REASON_PATTERN.test(e.player.reason))
    .map((e) => ({
      reason: e.player.reason,
      date: e.fixture.date ? e.fixture.date.slice(0, 10) : today,
      hasFixture: !!e.fixture.date,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const episodes: { reason: string; start: string; end: string; matches: number; hasFixturelessEntry: boolean }[] = [];
  for (const entry of eligible) {
    const last = episodes.at(-1);
    if (last && last.reason === entry.reason && Date.parse(entry.date) - Date.parse(last.end) <= 45 * 24 * 60 * 60 * 1000) {
      last.end = entry.date;
      if (entry.hasFixture) last.matches++;
      else last.hasFixturelessEntry = true;
    } else {
      episodes.push({
        reason: entry.reason,
        start: entry.date,
        end: entry.date,
        matches: entry.hasFixture ? 1 : 0,
        hasFixturelessEntry: !entry.hasFixture,
      });
    }
  }
  return episodes;
}

async function syncClubInjuries(
  club: ClubRow,
  clubPlayers: PlayerRow[],
  teamId: number | null,
  /** Pre-fetched national-team injury entries (USA WC/Gold Cup/Nations League).
   *  Merged with club-fetched entries so injuries from international fixtures
   *  are not silently dropped. */
  nationalTeamEntries: AfInjuryEntry[] = [],
): Promise<number> {
  // teamId is resolved once per club by the caller (syncPlayerStatsAndInjuries)
  // and passed in here — never skip the clear-stale-rows step below on an
  // unresolved team id; old injury rows must be wiped even when we can't fetch
  // fresh data.
  const byApiId = new Map(clubPlayers.filter((p) => p.apiFootballPlayerId).map((p) => [p.apiFootballPlayerId as number, p]));

  let clubEntries: AfInjuryEntry[] = [];
  if (teamId && byApiId.size > 0) {
    for (const season of seasonYearCandidates()) {
      try {
        const entries = await afFetch<AfInjuryEntry[]>(`/injuries?team=${teamId}&season=${season}`);
        clubEntries = clubEntries.concat(entries);
      } catch (err) {
        logger.warn({ err, club: club.name, season }, "API-Football injuries fetch failed for season");
      }
    }
  }

  // Merge club + national-team entries, deduplicating true duplicates (same
  // player, same fixture, same reason). The key MUST include the player id so
  // that two different players who both missed the same fixture are not
  // conflated — a non-player-scoped fixture key would silently drop all but
  // the first player for any given fixture.
  const seen = new Set<string>();
  const allEntries = [...clubEntries, ...nationalTeamEntries].filter((e) => {
    const key =
      e.fixture.id != null
        ? `fix:${e.player.id}:${e.fixture.id}`
        : `nofix:${e.player.id}:${e.player.reason}:${e.fixture.date ?? "null"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

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
    const episodes = groupInjuryEpisodes(entries, today);
    await db.delete(injuriesTable).where(eq(injuriesTable.playerId, player.id));
    for (const ep of episodes) {
      const daysMissed = Math.round((Date.parse(ep.end) - Date.parse(ep.start)) / (24 * 60 * 60 * 1000)) + 1;
      const status = ep.end >= today ? "active" : "returned";
      await db.insert(injuriesTable).values({
        playerId: player.id,
        bodyPart: ep.reason,
        status,
        expectedReturn: null, // API-Football does not include a projected return date in its injury response.
        daysMissed,
        matchesMissed: ep.matches,
        latestUpdate:
          status === "active"
            ? ep.matches > 0
              ? `Ruled out (${ep.reason}) — missed ${ep.matches} match${ep.matches === 1 ? "" : "es"} as of ${ep.end}.`
              : `Ruled out (${ep.reason}) — no matches missed yet.`
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
export async function syncPlayerStatsAndInjuries(
  fixturesPerClub = 12,
  /** When provided, only syncs the given player IDs — all others are skipped entirely,
   *  incurring zero additional API calls. The daily scheduled run omits this parameter
   *  to sync the full pool; callers that insert a small batch of new players should pass
   *  their ids here to avoid redundant per-player API quota consumption. */
  playerIds?: number[],
): Promise<PlayerStatsSyncResult> {
  const clubs: ClubRow[] = await db
    .select({ id: clubsTable.id, name: clubsTable.name, apiFootballTeamId: clubsTable.apiFootballTeamId })
    .from(clubsTable);
  const allPlayers: PlayerRow[] = await db
    .select({
      id: playersTable.id,
      name: playersTable.name,
      clubId: playersTable.clubId,
      apiFootballPlayerId: playersTable.apiFootballPlayerId,
      age: playersTable.age,
      dateOfBirth: playersTable.dateOfBirth,
      category: playersTable.category,
      nationalTeamCaps: playersTable.nationalTeamCaps,
      marketValueUsd: playersTable.marketValueUsd,
    })
    .from(playersTable);

  // Scope to the requested subset when a filter is provided. Clubs whose entire
  // player list is excluded will have an empty playersByClub entry and are
  // naturally skipped by the club loop below — no special handling needed.
  const players = playerIds ? allPlayers.filter((p) => playerIds.includes(p.id)) : allPlayers;

  const clubsById = new Map(clubs.map((c) => [c.id, c]));
  // Set of every API-Football team ID that maps to a tracked club. Used by
  // aggregateSeasonBlocks when building season_all rows so that stats from a
  // player's prior clubs are retained after a transfer while national-team
  // blocks (e.g. USMNT — not a row in clubsTable) remain excluded.
  const allClubTeamIds = new Set(clubs.map((c) => c.apiFootballTeamId).filter((id): id is number => id != null));

  await ensurePlayerApiFootballIds(players, clubsById);

  const playersByClub = new Map<number, PlayerRow[]>();
  for (const p of players) playersByClub.set(p.clubId, [...(playersByClub.get(p.clubId) ?? []), p]);

  let clubsProcessed = 0;
  let playersWithMatchLogs = 0;
  let playersWithSeasonStats = 0;
  let injuriesWritten = 0;
  let failures = 0;

  const [currentSeason] = seasonYearCandidates();

  // Fetch USA national-team injury entries once, before the per-club loop.
  // Injuries from World Cup / Gold Cup / Nations League fixtures are filed
  // under team=2384 in API-Football — not under the player's club — so a
  // club-only query misses them entirely. We fetch all seasons and pass the
  // combined list into every syncClubInjuries call; dedup by fixture id
  // happens inside that function.
  let nationalTeamEntries: AfInjuryEntry[] = [];
  for (const season of seasonYearCandidates()) {
    try {
      const entries = await afFetch<AfInjuryEntry[]>(`/injuries?team=${USA_NATIONAL_TEAM_ID}&season=${season}`);
      nationalTeamEntries = nationalTeamEntries.concat(entries);
    } catch (err) {
      logger.warn({ err, season }, "API-Football USA national-team injuries fetch failed");
    }
  }

  for (const club of clubs) {
    const clubPlayers = playersByClub.get(club.id) ?? [];
    if (clubPlayers.length === 0) continue;

    try {
      // Resolve once per club — used by syncClubMatchLogs (fixture lookup)
      // and for every player's season-stat filter below. Resolving here
      // prevents the double call that previously happened when syncClubMatchLogs
      // called resolveTeamId internally and the player loop called it again.
      // Emit a WARN when null so unresolvable clubs are visible in server logs
      // and don't silently degrade to a partial filter (friendly-league name only,
      // no team-id guard). See aggregateSeasonBlocks for why both guards matter.
      const clubTeamId = await resolveTeamId(club);
      if (!clubTeamId) {
        const skippableCount = clubPlayers.filter((p) => p.apiFootballPlayerId).length;
        logger.warn(
          { club: club.name, playersSkipped: skippableCount },
          "resolveTeamId returned null — season/previous_season/season_all stats will be cleared for all players at this club " +
            "to avoid inflated data (team-id guard inactive means aggregateSeasonBlocks could include blocks from unrelated teams); " +
            "fix the club lookup to restore full filtering",
        );
      }

      const matchLogsByPlayer = await syncClubMatchLogs(club, clubPlayers, fixturesPerClub, clubTeamId);

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
          // Trend will be recomputed from committed DB rows after the club
          // loop completes — no per-player write needed here.
          continue;
        }

        if (!clubTeamId) {
          // Club lookup unresolvable — clear season stats rather than write
          // potentially-inflated data: without a team-id guard,
          // aggregateSeasonBlocks could accumulate blocks from unrelated teams
          // that happen to pass the friendly-league name filter. Clearing is
          // safer than writing partial data; last5/previous5 (match-log
          // derived) are unaffected and remain above.
          await deleteStatsRow(player.id, "season");
          await deleteStatsRow(player.id, "previous_season");
          await db.delete(playerStatsTable).where(and(eq(playerStatsTable.playerId, player.id), eq(playerStatsTable.periodType, "season_all")));
          // Trend will be recomputed from committed DB rows after the club
          // loop completes — no per-player write needed here.
          continue;
        }
        // Query several consecutive season-year labels and aggregate each —
        // don't assume which one is "current" up front (see seasonYearCandidates
        // for why). Whichever candidates actually returned real data, the
        // most recent becomes "season" and the next-most-recent "previous_season".
        const seasonYears = seasonYearCandidates();
        const blocksByYear = await Promise.all(seasonYears.map((y) => fetchSeasonStats(player.apiFootballPlayerId!, y)));
        // Current-club filter: used for the primary season/previous_season rows
        // and the form-tier calculation, where mixing prior-club data into the
        // season baseline would skew the delta for a player who just transferred.
        const withData = seasonYears
          .map((year, i) => ({ year, agg: aggregateSeasonBlocks(blocksByYear[i].statistics, clubTeamId) }))
          .filter((entry): entry is { year: number; agg: AggregatedSeasonStats } => entry.agg != null)
          .sort((a, b) => b.year - a.year);
        // All-clubs variant: used only for the season_all history dropdown.
        // Filters to any team ID present in our clubs table so prior-club stats
        // are preserved after a transfer (e.g. Tillman PSV→Leverkusen keeps his
        // PSV 2024/25 season) while national-team blocks are still excluded
        // (USMNT is not a row in clubsTable, so its blocks are dropped here too).
        const withDataAllClubs = seasonYears
          .map((year, i) => ({ year, agg: aggregateSeasonBlocks(blocksByYear[i].statistics, allClubTeamIds) }))
          .filter((entry): entry is { year: number; agg: AggregatedSeasonStats } => entry.agg != null)
          .sort((a, b) => b.year - a.year);

        // Keep `dateOfBirth` and `age` live from the same responses (no
        // extra API call). Storing the raw birth date means age is always
        // computable at query time and never silently drifts stale between
        // sync runs as real birthdays pass.
        const birthDate = blocksByYear.map((b) => b.birthDate).find((d): d is string => d != null) ?? null;
        const liveAge = ageFromBirthDate(birthDate);
        const dobChanged = birthDate != null && birthDate !== player.dateOfBirth;
        const ageChanged = liveAge != null && liveAge !== player.age;
        if (dobChanged || ageChanged) {
          const updates: Partial<{ dateOfBirth: string; age: number }> = {};
          if (dobChanged) updates.dateOfBirth = birthDate!;
          if (ageChanged) updates.age = liveAge!;
          await db.update(playersTable).set(updates).where(eq(playersTable.id, player.id));
          if (dobChanged) player.dateOfBirth = birthDate;
          if (ageChanged) player.age = liveAge!;
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
        // than just "current"/"previous" to choose from. Uses the all-clubs
        // variant so prior-club seasons survive a transfer.
        await replaceSeasonHistoryRows(player.id, withDataAllClubs);

        // Trend will be recomputed from committed DB rows in recomputeFormTrends
        // after the club loop — no per-player write needed here.
      }

      injuriesWritten += await syncClubInjuries(club, clubPlayers, clubTeamId, nationalTeamEntries);
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

  // --- Post-loop: derive performance_trend from committed player_stats rows --
  // --- Post-loop: recompute potentialCallUpScore for every player -----------
  // All injuries and stat rows are fully written at this point, so the score
  // reflects the freshest possible data. The form badge is computed inline
  // from the same player_stats rows — no separate recomputeFormTrends pass
  // is needed; the badge is also derived on-demand at query time (queries.ts).
  try {
    const [allLast5, allPrevious5, allSeason, activeInjuries, freshPlayers] = await Promise.all([
      db
        .select({ playerId: playerStatsTable.playerId, minutes: playerStatsTable.minutes, avgRating: playerStatsTable.avgRating })
        .from(playerStatsTable)
        .where(eq(playerStatsTable.periodType, "last5")),
      db
        .select({ playerId: playerStatsTable.playerId, minutes: playerStatsTable.minutes, avgRating: playerStatsTable.avgRating })
        .from(playerStatsTable)
        .where(eq(playerStatsTable.periodType, "previous5")),
      db
        .select({ playerId: playerStatsTable.playerId, minutes: playerStatsTable.minutes, avgRating: playerStatsTable.avgRating })
        .from(playerStatsTable)
        .where(eq(playerStatsTable.periodType, "season")),
      db
        .select({ playerId: injuriesTable.playerId })
        .from(injuriesTable)
        .where(eq(injuriesTable.status, "active")),
      db
        .select({
          id: playersTable.id,
          category: playersTable.category,
          nationalTeamCaps: playersTable.nationalTeamCaps,
          marketValueUsd: playersTable.marketValueUsd,
          age: playersTable.age,
        })
        .from(playersTable),
    ]);

    const last5ByPlayer = new Map(allLast5.map((r) => [r.playerId, r]));
    const prev5ByPlayer = new Map(allPrevious5.map((r) => [r.playerId, r]));
    const seasonByPlayer = new Map(allSeason.map((r) => [r.playerId, r]));
    const activeInjurySet = new Set(activeInjuries.map((r) => r.playerId));

    // Minimal AggregatedSeasonStats shape — computeFormTier only reads `minutes`
    // and `avgRating`; all other fields are structurally required but unused.
    const ZERO: Omit<AggregatedSeasonStats, "minutes" | "avgRating"> = {
      starts: 0, goals: 0, assists: 0, shots: 0, keyPasses: 0,
      passCompletionPct: null, tackles: 0, interceptions: 0, duelsWonPct: null, savePct: null,
    };

    for (const p of freshPlayers) {
      const l5 = last5ByPlayer.get(p.id);
      const p5 = prev5ByPlayer.get(p.id);
      const s = seasonByPlayer.get(p.id);
      const last5Agg: AggregatedSeasonStats | null = l5 ? { ...ZERO, minutes: l5.minutes, avgRating: l5.avgRating } : null;
      const prev5Agg: AggregatedSeasonStats | null = p5 ? { ...ZERO, minutes: p5.minutes, avgRating: p5.avgRating } : null;
      const { trend } = computeFormTier(last5Agg, prev5Agg, s?.avgRating ?? null);

      const score = computeCallUpScore(
        p,
        trend,
        s?.minutes ?? null,
        l5?.avgRating ?? null,
        activeInjurySet.has(p.id),
      );
      await db.update(playersTable).set({ potentialCallUpScore: score }).where(eq(playersTable.id, p.id));
    }
    logger.info({ players: freshPlayers.length }, "Call-up scores recomputed from live data");
  } catch (err) {
    logger.warn({ err }, "Call-up score recomputation failed — scores from previous run retained");
  }

  logger.info(
    { clubsProcessed, playersWithMatchLogs, playersWithSeasonStats, injuriesWritten, failures },
    "Player stats/match-log/injuries sync complete",
  );
  return { clubsProcessed, playersWithMatchLogs, playersWithSeasonStats, injuriesWritten, failures };
}

/**
 * Immediately syncs match logs, player_stats, and form trends for the given
 * players — called the moment a fixture transitions to "finished" so player
 * profiles reflect the result within minutes rather than waiting for the next
 * daily stats job.
 *
 * Delegates to the full syncPlayerStatsAndInjuries so that match_logs,
 * last5/previous5/season player_stats, injuries, and form badges are all
 * updated in one pass.  The playerIds filter keeps the API-quota cost
 * proportional to the fixture (typically 1–5 players per club).
 */
export async function syncStatsForFinishedFixture(playerIds: number[]): Promise<void> {
  if (playerIds.length === 0) return;
  logger.info({ playerCount: playerIds.length }, "Post-match stats trigger: syncing stats for newly-finished fixture");
  await syncPlayerStatsAndInjuries(undefined, playerIds);
  logger.info({ playerCount: playerIds.length }, "Post-match stats trigger: complete");
}

let intervalHandle: NodeJS.Timeout | null = null;

/**
 * Runs the sync immediately, then daily. First-run volume is roughly
 * 3-4 calls/player (season + previous-season stats, shared match-log/
 * injuries calls per club) — at the enforced 7s/request throttle that's
 * ~30+ minutes for the full roster, too heavy to run more than once a day.
 */
export function startPlayerStatsSyncSchedule(
  intervalMs = 24 * 60 * 60 * 1000,
  /** Optional callback invoked after each successful club-stats sync cycle, used to chain dependent syncs (e.g. USMNT) that need resolved player IDs and fresh stats to already be committed. */
  afterSync?: () => Promise<void>,
): void {
  if (!process.env["API_FOOTBALL_KEY"]) {
    logger.warn("API_FOOTBALL_KEY not set — skipping live player-stats sync, no season stats/match logs/injuries will be available");
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { claimSyncRun } = require("./syncGuard") as typeof import("./syncGuard");
  const COOLDOWN = 23 * 60 * 60 * 1000; // 23 h — skip startup re-run if already ran today
  const run = async () => {
    if (!(await claimSyncRun("playerStats", COOLDOWN))) return;
    try {
      await syncPlayerStatsAndInjuries();
      await afterSync?.();
    } catch (err) {
      logger.error({ err }, "Player-stats sync (or post-sync) failed");
    }
  };
  run();
  intervalHandle = setInterval(run, intervalMs);
}

export function stopPlayerStatsSyncSchedule(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}
