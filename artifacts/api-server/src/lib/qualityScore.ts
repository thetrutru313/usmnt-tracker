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
 *  ranking this feature exists to produce. */
const AGE_MULTIPLIER_TABLE: Record<number, number> = {
  16: 2.0,
  17: 1.8,
  18: 1.6,
  19: 1.4,
  20: 1.25,
  21: 1.1,
  22: 1.0,
  23: 0.9,
};

/** Same precedence as the existing age gates: prefer live age computed from
 *  `date_of_birth`, falling back to the stored `age` column only when no
 *  birth date exists. Callers pass the already-resolved age in. */
export function ageMultiplierFor(age: number | null): number {
  if (age == null) return 1.0; // no age evidence — neutral, neither rewarded nor punished
  if (age <= 16) return AGE_MULTIPLIER_TABLE[16]!;
  if (age >= 23) return AGE_MULTIPLIER_TABLE[23]!;
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

/**
 * Picks the stat block that represents the player's primary club
 * competition for the season — the highest-minutes block that is neither a
 * friendly nor a national-team competition. That block's `league.id` is
 * what gates the quality score; a cup run or a single NT friendly must not
 * substitute for where the player actually earns his minutes.
 */
export function selectPrimaryLeagueBlock(statistics: QualityStatBlock[]): QualityStatBlock | null {
  const clubBlocks = statistics.filter(
    (s) => !isFriendlyLeague(s.league.name) && !isNationalTeamComp(s.league.name),
  );
  if (clubBlocks.length === 0) return null;
  return clubBlocks.reduce((best, s) => ((s.games.minutes ?? 0) > (best.games.minutes ?? 0) ? s : best));
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

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
    .filter((s) => !isFriendlyLeague(s.league.name) && !isNationalTeamComp(s.league.name))
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
  // Theoretical max raw = 1.0 (coefficient) × 2.0 (age) × 1.0 (performance) = 2.0.
  const score = Math.max(0, Math.min(100, Math.round((raw / 2) * 100)));

  return {
    score,
    inputs: {
      leagueId,
      leagueName,
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
