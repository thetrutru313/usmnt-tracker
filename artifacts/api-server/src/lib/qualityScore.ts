// ---------------------------------------------------------------------------
// Prospect quality score — separate from eligibility confidence.
//
// Eligibility answers "can he play for the US"; quality answers "is he worth
// my attention". They are different questions, computed independently, and
// must never share a number or feed into each other.
//
// This module must never import from or mutate anything in
// `evaluateEligibility.ts` / `eligibilitySignalsConfig.ts` — quality scoring
// is purely additive to the existing pipeline.
// ---------------------------------------------------------------------------

import { db, leagueStrengthTable } from "@workspace/db";
import { logger } from "./logger";
import { LEAGUE_STRENGTH_DEFAULTS, UNKNOWN_LEAGUE_COEFFICIENT } from "./leagueStrengthDefaults";
import { isFriendlyLeague } from "./playerStatsSync";
import { isNationalTeamComp } from "./evaluateEligibility";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Stat block shape the quality scorer reads. A superset of
 *  `AfDiscoveryStatBlock` (playerDiscovery.ts) — includes `league.id`,
 *  which eligibility scoring's `StatBlock` does not need and never gains. */
export interface QualityStatBlock {
  team: { id: number; name: string };
  league: { id: number; name: string; season: number };
  games: {
    lineups: number | null;
    minutes: number | null;
    appearences: number | null;
    position: string | null;
    rating: string | null;
  };
}

export interface QualityScoreInputs {
  leagueId: number | null;
  leagueName: string | null;
  /** The team behind the selected primary-league block — the club a
   *  player's quality score is actually judged against. Used to display
   *  the correct club even when `player_candidates.club_id` points at a
   *  discovery-source entity (e.g. a youth national team roster) rather
   *  than the player's real club. */
  leagueTeamId: number | null;
  leagueTeamName: string | null;
  coefficient: number;
  ageMultiplier: number;
  performanceSubtotal: number;
  minutes: number;
  starts: number;
  appearances: number;
  rating: number | null;
  age: number | null;
}

export interface QualityScoreResult {
  score: number;
  inputs: QualityScoreInputs;
}

// ---------------------------------------------------------------------------
// League strength lookup
// ---------------------------------------------------------------------------

let leagueStrengthCache: Map<number, number> | null = null;

/** Clears the in-memory league-strength cache — test-only. */
export function _resetLeagueStrengthCacheForTesting(): void {
  leagueStrengthCache = null;
}

/**
 * Seeds `league_strength` from the version-controlled defaults on server
 * startup. Insert-if-missing only — never upserts — so a hand-tuned
 * coefficient in the DB always survives a restart.
 */
export async function seedLeagueStrengthDefaults(): Promise<{ inserted: number; skipped: number }> {
  const existing = await db.select({ id: leagueStrengthTable.apiFootballLeagueId }).from(leagueStrengthTable);
  const existingIds = new Set(existing.map((r) => r.id));

  const toInsert = LEAGUE_STRENGTH_DEFAULTS.filter((d) => !existingIds.has(d.apiFootballLeagueId));

  if (toInsert.length > 0) {
    await db.insert(leagueStrengthTable).values(
      toInsert.map((d) => ({
        apiFootballLeagueId: d.apiFootballLeagueId,
        name: d.name,
        coefficient: d.coefficient.toFixed(2),
      })),
    );
  }

  logger.info(
    { inserted: toInsert.length, skipped: LEAGUE_STRENGTH_DEFAULTS.length - toInsert.length },
    "League strength: defaults seeded (insert-if-missing)",
  );
  return { inserted: toInsert.length, skipped: LEAGUE_STRENGTH_DEFAULTS.length - toInsert.length };
}

/** Loads all `league_strength` rows into an in-memory id→coefficient map,
 *  caching for the process lifetime. Call `_resetLeagueStrengthCacheForTesting`
 *  in tests, or after writing new rows, to force a re-read. */
async function getLeagueStrengthMap(): Promise<Map<number, number>> {
  if (leagueStrengthCache) return leagueStrengthCache;
  try {
    const rows = await db.select().from(leagueStrengthTable);
    leagueStrengthCache = new Map(rows.map((r) => [r.apiFootballLeagueId, parseFloat(r.coefficient)]));
    return leagueStrengthCache;
  } catch (err) {
    // Quality scoring is additive — a transient failure to load league
    // strength must never take down eligibility scoring/rescoring, which
    // runs in the same pass. Every league falls back to the unknown-league
    // default until the next successful load.
    logger.warn({ err }, "Quality score: failed to load league_strength — using unknown-league default for all leagues this pass");
    return new Map();
  }
}

/**
 * Resolves the coefficient for a league id. Unknown leagues get the
 * `UNKNOWN_LEAGUE_COEFFICIENT` default (never zero — a league we simply
 * haven't classified yet must not bury the player) and log a warning naming
 * the league so an operator can see what's showing up unclassified.
 */
export async function resolveLeagueCoefficient(
  leagueId: number | null,
  leagueName: string | null,
): Promise<number> {
  if (leagueId == null) {
    logger.warn(
      { leagueName },
      "Quality score: stat block has no league id — using unknown-league default coefficient",
    );
    return UNKNOWN_LEAGUE_COEFFICIENT;
  }
  const map = await getLeagueStrengthMap();
  const coefficient = map.get(leagueId);
  if (coefficient == null) {
    logger.warn(
      { leagueId, leagueName },
      "Quality score: unclassified league — using default coefficient (add it to leagueStrengthDefaults.ts to classify)",
    );
    return UNKNOWN_LEAGUE_COEFFICIENT;
  }
  return coefficient;
}

// ---------------------------------------------------------------------------
// Age multiplier
// ---------------------------------------------------------------------------

/** Steep enough that a 17-year-old with limited minutes outranks a
 *  22-year-old with substantially more in the same league — that is the
 *  ranking this feature exists to produce.
 *
 *  The tail (24+) collapses hard rather than merely tapering: this is a
 *  *prospect* queue, and past a certain age a player is not a prospect
 *  regardless of how well he's playing — volume must never compensate for
 *  age here the way it can between, say, 19 and 22. */
const AGE_MULTIPLIER_TABLE: Record<number, number> = {
  16: 2.0,
  17: 1.8,
  18: 1.6,
  19: 1.4,
  20: 1.25,
  21: 1.1,
  22: 1.0,
  23: 0.85,
  24: 0.4,
  25: 0.2,
  26: 0.1,
};

/** Same precedence as the existing age gates: prefer live age computed from
 *  `date_of_birth`, falling back to the stored `age` column only when no
 *  birth date exists. Callers pass the already-resolved age in. */
export function ageMultiplierFor(age: number | null): number {
  if (age == null) return 1.0; // no age evidence — neutral, neither rewarded nor punished
  if (age <= 16) return AGE_MULTIPLIER_TABLE[16]!;
  if (age >= 26) return AGE_MULTIPLIER_TABLE[26]!;
  return AGE_MULTIPLIER_TABLE[age] ?? 1.0;
}

// ---------------------------------------------------------------------------
// Performance subtotal (minutes + starts + rating), normalized to 0-1
// ---------------------------------------------------------------------------

/** Minutes at which the saturating curve effectively maxes out. Chosen so
 *  the 200→900 minute gap (where a young prospect actually lives) matters a
 *  lot and the 2400→3100 gap (an established starter padding a full
 *  season) barely moves the number. */
const MINUTES_SATURATION_POINT = 3000;

/** Below this many minutes, a rating average is noise (e.g. a single 7.4
 *  from one cameo) and is excluded rather than trusted. */
const RATING_MINUTES_FLOOR = 300;

const PERFORMANCE_WEIGHTS = { minutes: 0.55, starts: 0.15, rating: 0.3 };

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Combines minutes, starts-to-appearances ratio, and rating into a single
 * 0-1 performance subtotal.
 *
 * - Minutes saturate via a square-root curve rather than scaling linearly —
 *   volume is exactly what a young prospect lacks, so linear minutes would
 *   let established starters win on volume alone.
 * - Starts relative to appearances is a modest signal of managerial trust.
 * - Rating is excluded entirely (not zeroed — its weight is redistributed to
 *   minutes and starts) below the minutes floor, since a single cameo
 *   rating is noise, not signal.
 */
export function computePerformanceSubtotal(input: {
  minutes: number;
  starts: number;
  appearances: number;
  rating: number | null;
}): number {
  const minutesComponent = clamp01(Math.sqrt(Math.max(0, input.minutes)) / Math.sqrt(MINUTES_SATURATION_POINT));
  const startsRatio = input.appearances > 0 ? clamp01(input.starts / input.appearances) : 0;

  const ratingEligible = input.rating != null && input.minutes >= RATING_MINUTES_FLOOR;
  const ratingComponent = ratingEligible ? clamp01((input.rating! - 5) / 3) : null;

  if (ratingComponent == null) {
    // Redistribute the rating weight proportionally across minutes/starts
    // rather than treating the missing rating as a zero.
    const remaining = PERFORMANCE_WEIGHTS.minutes + PERFORMANCE_WEIGHTS.starts;
    return (
      minutesComponent * (PERFORMANCE_WEIGHTS.minutes / remaining) +
      startsRatio * (PERFORMANCE_WEIGHTS.starts / remaining)
    );
  }

  return (
    minutesComponent * PERFORMANCE_WEIGHTS.minutes +
    startsRatio * PERFORMANCE_WEIGHTS.starts +
    ratingComponent * PERFORMANCE_WEIGHTS.rating
  );
}

// ---------------------------------------------------------------------------
// Primary league selection
// ---------------------------------------------------------------------------

/** Matches domestic and continental cup competitions — "FA Cup", "League
 *  Cup", "DFB Pokal", "Coppa Italia", "Copa del Rey", "Leagues Cup", "US
 *  Open Cup", "Community Shield", "Supercopa", "UEFA Champions League",
 *  "UEFA Europa League", "CONCACAF Champions Cup", etc.
 *
 *  These are never a candidate's primary league: a domestic cup run can
 *  rack up more minutes than a bench role in the actual league, and cup
 *  competitions have no coefficient of their own (see
 *  `selectPrimaryLeagueBlock`) — picking one as primary would wrongly drag
 *  a strong-league player down to the unknown-league fallback. */
const CUP_COMPETITION_RE =
  /\bcup\b|pokal|coppa|copa del rey|copa do brasil|\btrophy\b|\bshield\b|supercup|super cup|champions league|europa league|conference league|libertadores|sudamericana/i;

export function isCupCompetition(leagueName: string): boolean {
  return CUP_COMPETITION_RE.test(leagueName);
}

/**
 * Picks the stat block that represents the player's primary club
 * competition for the season — the highest-minutes block that is neither a
 * friendly, a national-team competition, nor a domestic/continental cup.
 * That block's `league.id` (and `team`) is what gates the quality score and
 * what gets displayed as the player's club; a cup run, an NT friendly, or a
 * youth-national-team appearance must never substitute for where the player
 * actually earns his club minutes.
 *
 * Returns `null` when a candidate has no qualifying club-league block at
 * all (e.g. only cup or national-team appearances this season) — callers
 * must fall back to the unknown-league coefficient rather than picking a
 * cup, and must not display a club for a player with no real primary league.
 */
export function selectPrimaryLeagueBlock(statistics: QualityStatBlock[]): QualityStatBlock | null {
  const clubBlocks = statistics.filter(
    (s) => !isFriendlyLeague(s.league.name) && !isNationalTeamComp(s.league.name) && !isCupCompetition(s.league.name),
  );
  if (clubBlocks.length === 0) return null;
  return clubBlocks.reduce((best, s) => ((s.games.minutes ?? 0) > (best.games.minutes ?? 0) ? s : best));
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Real raw scores (coefficient × ageMultiplier × performance) rarely
 * approach the theoretical max of 2.0 (a top-league, ≤16-year-old, maxed-out
 * performance) — observed raw values in a typical candidate pool top out
 * around 0.5-0.6. Dividing by 2.0 compressed the whole usable range into the
 * bottom third of the 0-100 scale (top of the queue ~29, twentieth ~19),
 * leaving adjacent ranks a point or two apart — noise, not signal.
 *
 * Dividing by a realistic ceiling instead (clamped to 100 for the rare case
 * that exceeds it) spreads the pool across the full scale so the strongest
 * candidate in a typical pool reads in the 80s and ranks separate visibly.
 * This only changes the raw-to-display mapping — it is a monotonic
 * (order-preserving) transform, so ranking is unaffected.
 */
const NORMALIZATION_CEILING = 0.7;

export function normalizeRawScore(raw: number): number {
  return Math.max(0, Math.min(100, Math.round((raw / NORMALIZATION_CEILING) * 100)));
}

/**
 * Computes the 0-100 prospect quality score:
 *
 *   quality = leagueStrength × ageMultiplier × performance
 *
 * Multiplicative by design — league strength gates the score rather than
 * being one term among several, so a strong performance in a weak league
 * cannot accumulate its way past a modest performance in a strong one.
 *
 * `minutes`/`starts`/`rating` are the season aggregates already computed by
 * the caller (`applyQualityGate` / `computeAvgRating` in playerDiscovery.ts)
 * so this never re-derives them differently from what's stored on the row.
 * `statistics` is used only to identify the primary league (for the
 * coefficient lookup) and total appearances.
 */
export async function computeQualityScore(input: {
  statistics: QualityStatBlock[];
  minutes: number;
  starts: number;
  /** Matches `computeAvgRating`'s return type (a fixed-decimal string, e.g.
   *  "7.23") rather than a parsed number, so callers can pass it straight
   *  through without an intermediate parse/re-stringify. */
  rating: string | null;
  age: number | null;
}): Promise<QualityScoreResult> {
  const primary = selectPrimaryLeagueBlock(input.statistics);
  const leagueId = primary?.league.id ?? null;
  const leagueName = primary?.league.name ?? null;

  const appearances = input.statistics
    .filter(
      (s) => !isFriendlyLeague(s.league.name) && !isNationalTeamComp(s.league.name) && !isCupCompetition(s.league.name),
    )
    .reduce((n, s) => n + (s.games.appearences ?? s.games.lineups ?? 0), 0);

  const coefficient = await resolveLeagueCoefficient(leagueId, leagueName);
  const ageMultiplier = ageMultiplierFor(input.age);
  const performanceSubtotal = computePerformanceSubtotal({
    minutes: input.minutes,
    starts: input.starts,
    appearances: Math.max(appearances, input.starts),
    rating: input.rating != null ? parseFloat(input.rating as unknown as string) : null,
  });

  const raw = coefficient * ageMultiplier * performanceSubtotal;
  const score = normalizeRawScore(raw);

  return {
    score,
    inputs: {
      leagueId,
      leagueName,
      leagueTeamId: primary?.team.id ?? null,
      leagueTeamName: primary?.team.name ?? null,
      coefficient,
      ageMultiplier,
      performanceSubtotal,
      minutes: input.minutes,
      starts: input.starts,
      appearances,
      rating: input.rating != null ? parseFloat(input.rating as unknown as string) : null,
      age: input.age,
    },
  };
}
