import { db, clubsTable, playersTable, playerCandidatesTable, eligibilitySignalsTable, serverConfigTable } from "@workspace/db";
import { eq, sql, isNull, isNotNull, and, or } from "drizzle-orm";
import { logger } from "./logger";
import { afFetch } from "./apiFootballSync";
import { isFriendlyLeague } from "./playerStatsSync";
import { evaluateEligibility, detectSeniorNonUsCaps, countNationalTeamCaps, type EligibilityProfile } from "./evaluateEligibility";
import { getMinEligibilityScore, getMaxCandidateAge, getWeightFingerprint, getResolvedWeights, SIGNAL_REGISTRY } from "./eligibilitySignalsConfig";
import { ageFromBirthDate } from "./playerClubSync";

// ---------------------------------------------------------------------------
// Scans squad rosters at every tracked club for US-eligible players not yet
// in the player pool. Qualified candidates are inserted into
// `player_candidates` for manual operator review — nothing is auto-promoted.
//
// Eligibility is now computed by the multi-signal scoring engine in
// evaluateEligibility.ts.  Only candidates whose score meets the minimum
// threshold (default: 30, overridable via ELIGIBILITY_MIN_SCORE) are stored.
//
// Quality gate (must satisfy at least one):
//   - 5+ starts in the fetched season, OR
//   - 450+ minutes played in the fetched season
// ---------------------------------------------------------------------------

interface AfSquadPlayer {
  id: number;
  name: string;
}

interface AfSquadResponse {
  team: { id: number; name: string };
  players: AfSquadPlayer[];
}

export interface AfDiscoveryStatBlock {
  team: { id: number; name: string };
  league: { name: string; season: number };
  games: {
    lineups: number | null;
    minutes: number | null;
    position: string | null;
    rating: string | null;
  };
}

interface AfDiscoveryResponse {
  player: {
    id: number;
    name: string;
    firstname: string | null;
    age: number | null;
    nationality: string | null;
    birth: { country: string | null; date: string | null; place?: string | null };
  };
  statistics: AfDiscoveryStatBlock[];
}

const MIN_STARTS = 5;
const MIN_MINUTES = 450;

// ---------------------------------------------------------------------------
// Slug utilities
// ---------------------------------------------------------------------------

/** Converts a display name into the URL-safe slug used by the players table. */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Exported for unit tests — do not call from production code outside this module. */
export function applyQualityGate(statistics: AfDiscoveryStatBlock[]): {
  passes: boolean;
  starts: number;
  minutes: number;
} {
  let starts = 0;
  let minutes = 0;
  for (const s of statistics) {
    if (isFriendlyLeague(s.league.name)) continue;
    starts += s.games.lineups ?? 0;
    minutes += s.games.minutes ?? 0;
  }
  return { passes: starts >= MIN_STARTS || minutes >= MIN_MINUTES, starts, minutes };
}

/**
 * Fetches a candidate/prospect's profile across all given season years and
 * returns the one with the most total minutes played (excluding friendly
 * competitions, consistent with `applyQualityGate`) — not simply the first
 * season that returned a non-empty statistics array.
 *
 * API-Football returns a stat block for the current season as soon as a
 * player is registered to a squad, even with zero minutes played. Breaking
 * on "statistics present" rather than "minutes played" meant a player whose
 * current season had barely started was evaluated on near-zero minutes while
 * a complete prior season was never looked at.
 *
 * - If at least one season has minutes > 0, the season with the most minutes
 *   wins.
 * - If every season with statistics has zero minutes, the most recent such
 *   season is returned (so a genuinely new player still gets a profile).
 * - If no season returns any statistics at all, returns null.
 */
async function selectBestSeasonProfile<P extends { statistics: AfDiscoveryStatBlock[] }>(
  seasons: number[],
  fetchSeason: (season: number) => Promise<P[]>,
): Promise<P | null> {
  const candidates: Array<{ season: number; profile: P; minutes: number }> = [];
  for (const season of seasons) {
    try {
      const results = await fetchSeason(season);
      const profile = results[0];
      if (profile?.statistics?.length) {
        candidates.push({ season, profile, minutes: applyQualityGate(profile.statistics).minutes });
      }
    } catch {
      // Try the next season year
    }
  }

  if (candidates.length === 0) return null;

  // seasons is passed newest-first, so candidates[0] is the most recent
  // season with statistics — it wins ties (e.g. every season at zero minutes).
  let best = candidates[0]!;
  for (const c of candidates.slice(1)) {
    if (c.minutes > best.minutes) best = c;
  }

  logger.debug(
    { season: best.season, minutes: best.minutes },
    "Discovery: season selected for profile",
  );
  return best.profile;
}

function computeAvgRating(statistics: AfDiscoveryStatBlock[]): string | null {
  let weightedSum = 0;
  let weight = 0;
  for (const s of statistics) {
    if (isFriendlyLeague(s.league.name)) continue;
    const mins = s.games.minutes ?? 0;
    const rating = s.games.rating != null ? parseFloat(s.games.rating) : null;
    if (rating != null && Number.isFinite(rating) && mins > 0) {
      weightedSum += rating * mins;
      weight += mins;
    }
  }
  return weight > 0 ? (weightedSum / weight).toFixed(2) : null;
}

function inferPosition(statistics: AfDiscoveryStatBlock[]): string | null {
  for (const s of statistics) {
    if (s.games.position) return s.games.position;
  }
  return null;
}

/**
 * Upserts fired signals for a candidate into `eligibility_signals`.
 * Uses (candidate_id, signal_type, source) as the conflict key — repeated
 * discovery runs stay idempotent.
 */
async function persistSignals(
  candidateId: number,
  signals: Array<{ signalType: string; signalValue: string | null; weight: number; source: string }>,
): Promise<void> {
  if (signals.length === 0) return;
  for (const sig of signals) {
    await db
      .insert(eligibilitySignalsTable)
      .values({
        candidateId,
        signalType: sig.signalType,
        signalValue: sig.signalValue,
        weight: sig.weight,
        source: sig.source,
      })
      .onConflictDoUpdate({
        target: [
          eligibilitySignalsTable.candidateId,
          eligibilitySignalsTable.signalType,
          eligibilitySignalsTable.source,
        ],
        set: {
          signalValue: sig.signalValue,
          weight: sig.weight,
          detectedAt: new Date(),
        },
      });
  }
}

/**
 * Scans every tracked club's squad for unknown players, fetches their
 * API-Football profile, and inserts US-eligible starters as candidates.
 * Runs after each daily club sync (called from `syncPlayerClubs`).
 */
export async function discoverUSProspects(): Promise<{
  checked: number;
  inserted: number;
  skippedQuality: number;
  skippedAge: number;
  skippedEligibility: number;
  skippedScore: number;
}> {
  const clubs = await db
    .select({ id: clubsTable.id, name: clubsTable.name, apiFootballTeamId: clubsTable.apiFootballTeamId })
    .from(clubsTable);

  const trackedClubs = clubs.filter(
    (c): c is typeof c & { apiFootballTeamId: number } => c.apiFootballTeamId != null,
  );

  // All API-Football IDs already in the tracked pool (players table) or
  // previously evaluated (candidates table) — both skip further processing.
  const [trackedPlayers, existingCandidates] = await Promise.all([
    db.select({ apiFootballPlayerId: playersTable.apiFootballPlayerId }).from(playersTable),
    db
      .select({
        id: playerCandidatesTable.id,
        apiFootballPlayerId: playerCandidatesTable.apiFootballPlayerId,
        name: playerCandidatesTable.name,
        status: playerCandidatesTable.status,
      })
      .from(playerCandidatesTable),
  ]);

  const knownApiIds = new Set<number>([
    // Existing pool guard — never re-evaluate a player already being tracked.
    ...trackedPlayers.flatMap((p) => (p.apiFootballPlayerId != null ? [p.apiFootballPlayerId] : [])),
    ...existingCandidates.map((c) => c.apiFootballPlayerId),
  ]);

  // Slug collision map: slug → existing candidate id.
  // Used to detect two candidates with the same name entering the queue.
  // Only pending and promoted rows are considered — dismissed candidates are
  // ignored so a name can be reconsidered if the first attempt was rejected.
  const existingSlugMap = new Map<string, number>();
  for (const c of existingCandidates) {
    if (c.status === "pending" || c.status === "promoted") {
      existingSlugMap.set(slugify(c.name), c.id);
    }
  }

  const minScore = getMinEligibilityScore();
  const maxAge = getMaxCandidateAge();
  const currentYear = new Date().getUTCFullYear();
  const seasonCandidates = [currentYear, currentYear - 1];

  let checked = 0;
  let inserted = 0;
  let skippedQuality = 0;
  let skippedAge = 0;
  const skippedEligibility = 0;
  let skippedScore = 0;

  for (const club of trackedClubs) {
    let roster: AfSquadPlayer[];
    try {
      const squads = await afFetch<AfSquadResponse[]>(`/players/squads?team=${club.apiFootballTeamId}`);
      roster = squads[0]?.players ?? [];
    } catch (err) {
      logger.warn({ err, club: club.name }, "Discovery: squad fetch failed, skipping club");
      continue;
    }

    const unknownPlayers = roster.filter((p) => !knownApiIds.has(p.id));
    if (unknownPlayers.length === 0) continue;

    for (const squadPlayer of unknownPlayers) {
      checked++;

      // Mark as known immediately so duplicate squad appearances across clubs
      // don't trigger multiple profile fetches for the same player in this run.
      knownApiIds.add(squadPlayer.id);

      // Fetch every candidate season and pick the one with the most minutes
      // played (see selectBestSeasonProfile) rather than the first season
      // that merely has a statistics array.
      const profile = await selectBestSeasonProfile(seasonCandidates, (season) =>
        afFetch<AfDiscoveryResponse[]>(`/players?id=${squadPlayer.id}&season=${season}`),
      );

      if (!profile) continue; // no stats available — too new or not in API's coverage

      const { player, statistics } = profile;

      // Quality gate — reject bench-warmers before the eligibility check
      const { passes, starts, minutes } = applyQualityGate(statistics);
      if (!passes) {
        skippedQuality++;
        continue;
      }

      // Age gate — reject players older than the configured maximum age.
      // Prefer the live age computed from API-Football's birth.date; the
      // `age` field API-Football also returns is only used as a fallback
      // when no birth date is available.
      const liveAge = ageFromBirthDate(player.birth.date) ?? player.age;
      if (liveAge != null && liveAge > maxAge) {
        skippedAge++;
        logger.debug(
          { name: player.name, age: liveAge, maxAge },
          "Discovery: candidate exceeds maximum age, skipping",
        );
        continue;
      }

      // Build the eligibility profile and run the full scoring engine.
      // All six signals are evaluated — the minimum-score gate below handles
      // filtering rather than a nationality/birth pre-check, so players with
      // US evidence only from youth-NT appearances, USMNT caps, MLS league
      // context, or birthplace text are not silently skipped.
      const eligibilityProfile: EligibilityProfile = {
        nationality: player.nationality ?? null,
        birthCountry: player.birth.country ?? null,
        birthplace: player.birth.place ?? null,
        statistics,
      };

      const { score, status, signals } = await evaluateEligibility(eligibilityProfile);

      if (score < minScore) {
        skippedScore++;
        logger.debug(
          { name: player.name, score, minScore },
          "Discovery: candidate below minimum score threshold, skipping",
        );
        continue;
      }

      // Legacy eligibility basis for backward-compatibility
      const nationality = player.nationality ?? null;
      const birthCountry = player.birth.country ?? null;
      const isUsNationality = nationality === "USA";
      let eligibilityBasis: string;
      if (isUsNationality) {
        eligibilityBasis = "nationality";
      } else if (!(await detectSeniorNonUsCaps(statistics))) {
        eligibilityBasis = "birth_country";
      } else {
        eligibilityBasis = "dual_national_unconfirmed";
      }

      // Senior and youth national-team caps are tracked as two separate
      // counters — a youth-only history must never inflate the senior total.
      const { seniorCaps, youthCaps } = await countNationalTeamCaps(statistics);

      const dataSources = ["api_football"];

      // Slug-based duplicate detection: if an existing pending or promoted
      // candidate shares this player's slugified name, mark the new row as a
      // duplicate so operators can review the collision instead of silently
      // blocking promotion downstream.
      const nameSlug = slugify(player.name);
      const duplicateOfId = existingSlugMap.get(nameSlug) ?? null;

      if (duplicateOfId != null) {
        logger.info(
          { name: player.name, duplicateOfId, club: club.name },
          "Discovery: candidate name collision — marking as duplicate",
        );
      }

      try {
        const rows = await db
          .insert(playerCandidatesTable)
          .values({
            name: player.name,
            firstName: player.firstname ?? null,
            position: inferPosition(statistics),
            age: player.age ?? null,
            dateOfBirth: player.birth.date ?? null,
            clubId: club.id,
            apiFootballPlayerId: player.id,
            nationality,
            birthCountry,
            birthplace: player.birth.place ?? null,
            currentSeasonStarts: starts,
            currentSeasonMinutes: minutes,
            currentSeasonRating: computeAvgRating(statistics),
            priorNationalTeamCaps: seniorCaps > 0 ? seniorCaps : null,
            priorYouthNtCaps: youthCaps > 0 ? youthCaps : null,
            eligibilityBasis,
            eligibilityConfidence: score,
            usmntStatus: status,
            dataSources,
            status: "pending",
            ...(duplicateOfId != null ? { duplicateOfId, needsReview: true } : {}),
          })
          .onConflictDoUpdate({
            target: playerCandidatesTable.apiFootballPlayerId,
            set: {
              // Guard: never overwrite fields that were manually set by an
              // operator (is_manual_override = true). For those rows the
              // existing DB values are preserved via a CASE expression so the
              // daily scan cannot silently undo an operator decision.
              eligibilityConfidence: sql`CASE WHEN ${playerCandidatesTable.isManualOverride} = true THEN ${playerCandidatesTable.eligibilityConfidence} ELSE ${score} END`,
              usmntStatus: sql`CASE WHEN ${playerCandidatesTable.isManualOverride} = true THEN ${playerCandidatesTable.usmntStatus} ELSE ${status}::usmnt_candidate_status END`,
              dataSources,
              birthplace: player.birth.place ?? null,
              dateOfBirth: player.birth.date ?? null,
              currentSeasonStarts: starts,
              currentSeasonMinutes: minutes,
              currentSeasonRating: computeAvgRating(statistics),
              priorNationalTeamCaps: seniorCaps > 0 ? seniorCaps : null,
              priorYouthNtCaps: youthCaps > 0 ? youthCaps : null,
              // Re-flag duplicates on rescore in case a previously dismissed
              // candidate with the same name was re-inserted.
              ...(duplicateOfId != null ? { duplicateOfId, needsReview: true } : {}),
            },
          })
          .returning({ id: playerCandidatesTable.id, isNew: playerCandidatesTable.discoveredAt });

        const candidateId = rows[0]?.id;
        if (!candidateId) continue;

        // Persist/update the fired signals
        await persistSignals(candidateId, signals);

        // Count as inserted only when this is genuinely a new row (discoveredAt
        // will be very recent — within the last second).
        const isNewRow = rows.length > 0 &&
          Date.now() - new Date(rows[0]!.isNew).getTime() < 5000;

        if (isNewRow) {
          inserted++;
          logger.info(
            { name: player.name, club: club.name, eligibilityBasis, score, status, starts, minutes, duplicateOfId },
            "Discovery: new US-eligible prospect inserted as candidate",
          );
          // Register this new candidate's slug so a third candidate with the
          // same name within the same run also gets flagged.
          existingSlugMap.set(nameSlug, candidateId);
        } else {
          logger.debug(
            { name: player.name, score, status },
            "Discovery: existing candidate rescored",
          );
        }
      } catch (err) {
        logger.warn({ err, name: player.name, club: club.name }, "Discovery: candidate upsert failed");
      }
    }
  }

  logger.info(
    { checked, inserted, skippedQuality, skippedAge, skippedEligibility, skippedScore },
    "Discovery: US prospect scan complete",
  );
  return { checked, inserted, skippedQuality, skippedAge, skippedEligibility, skippedScore };
}

// ---------------------------------------------------------------------------
// Rescore all non-dismissed candidates
// ---------------------------------------------------------------------------

const DEFAULT_RESCORE_MAX_CANDIDATES = 50;

/**
 * Re-fetches stats from API-Football for every non-dismissed candidate and
 * re-evaluates their eligibility score using the current signal registry
 * weights.  Writes updated `eligibility_confidence`, `usmnt_status`,
 * `data_sources`, and signal rows back to the DB.  Never touches `players`.
 *
 * @param options.maxCandidates  Cap on how many candidates are processed in a
 *   single run.  Defaults to the `RESCORE_MAX_CANDIDATES` env var or 50.
 *   When the pending pool exceeds the cap the oldest-discovered candidates are
 *   processed first and the remainder are deferred to the next run.
 * @param options._db  Optional DB instance override — used by integration
 *   tests to inject a transaction-scoped connection so all reads and writes
 *   stay within a single rolled-back transaction.  Never set this in
 *   production code.
 */
export async function rescoreAllCandidates(
  options: { maxCandidates?: number; _db?: typeof db } = {},
): Promise<{
  processed: number;
  updated: number;
  failed: number;
  skipped: number;
  skippedNoStats: number;
}> {
  const envCap = parseInt(process.env["RESCORE_MAX_CANDIDATES"] ?? "", 10);
  const cap =
    options.maxCandidates ??
    (Number.isFinite(envCap) && envCap > 0 ? envCap : DEFAULT_RESCORE_MAX_CANDIDATES);

  const maxAge = getMaxCandidateAge();

  // Use the injected DB instance when provided (integration-test isolation);
  // fall back to the module-level pool in production.
  const dbInstance = options._db ?? db;

  const allCandidates = await dbInstance
    .select({
      id: playerCandidatesTable.id,
      name: playerCandidatesTable.name,
      age: playerCandidatesTable.age,
      dateOfBirth: playerCandidatesTable.dateOfBirth,
      apiFootballPlayerId: playerCandidatesTable.apiFootballPlayerId,
      isManualOverride: playerCandidatesTable.isManualOverride,
    })
    .from(playerCandidatesTable)
    .where(
      or(
        eq(playerCandidatesTable.status, "pending"),
        isNull(playerCandidatesTable.eligibilityConfidence),
      ),
    )
    .orderBy(sql`${playerCandidatesTable.lastScoredAt} ASC NULLS FIRST`);

  // Exclude manually-overridden candidates BEFORE applying the cap so they
  // never consume cap slots and starve real (non-overridden) candidates.
  const rescorable = allCandidates.filter((c) => !c.isManualOverride);

  const skipped = Math.max(0, rescorable.length - cap);
  const candidates = rescorable.slice(0, cap);

  if (skipped > 0) {
    logger.info(
      { total: rescorable.length, cap, skipped },
      "Rescore: candidate pool exceeds cap — oldest candidates processed first, remainder deferred",
    );
  }

  const currentYear = new Date().getUTCFullYear();
  const seasonCandidates = [currentYear, currentYear - 1];
  const minScore = getMinEligibilityScore();

  let processed = 0;
  let updated = 0;
  let failed = 0;
  let skippedNoStats = 0;

  for (const candidate of candidates) {
    processed++;
    try {
      // Re-fetch stats from API-Football, selecting the season with the most
      // minutes played rather than the first season with any statistics.
      type RescoredProfile = { player: { nationality: string | null; birth: { country: string | null; place?: string | null; date?: string | null } }; statistics: AfDiscoveryStatBlock[] };
      const profile = await selectBestSeasonProfile(seasonCandidates, (season) =>
        afFetch<RescoredProfile[]>(`/players?id=${candidate.apiFootballPlayerId}&season=${season}`),
      );

      if (!profile) {
        // Stamp lastScoredAt so this row rotates to the back of the
        // lastScoredAt ASC NULLS FIRST queue instead of blocking it forever.
        // Status, confidence, and signals are intentionally left untouched —
        // "unscoreable right now" is not the same as "ineligible".
        await dbInstance
          .update(playerCandidatesTable)
          .set({ lastScoredAt: new Date() })
          .where(eq(playerCandidatesTable.id, candidate.id));
        logger.debug(
          { candidateId: candidate.id, name: candidate.name },
          "Rescore: no stats found — timestamped and deferred",
        );
        skippedNoStats++;
        continue;
      }

      const eligibilityProfile: EligibilityProfile = {
        nationality: profile.player.nationality ?? null,
        birthCountry: profile.player.birth.country ?? null,
        birthplace: profile.player.birth.place ?? null,
        statistics: profile.statistics,
      };

      const { score, status, signals } = await evaluateEligibility(eligibilityProfile);

      // Prior senior/youth national-team caps, kept as two separate counters
      // (see countNationalTeamCaps) — a youth-only history must not inflate
      // the senior total.
      const { seniorCaps, youthCaps } = await countNationalTeamCaps(profile.statistics);

      // Freshly-fetched birth date, falling back to whatever is already on
      // file so a transient missing field never blanks out a known DOB.
      const dateOfBirth = profile.player.birth.date ?? candidate.dateOfBirth ?? null;

      // Dismiss candidates that exceed the age cap, regardless of their
      // score. Age is computed live from the birth date whenever one is
      // known; the stored `age` column is only a fallback for candidates
      // discovered before a birth date was ever recorded.
      const liveAge = ageFromBirthDate(dateOfBirth) ?? candidate.age;
      const isOverAge = liveAge != null && liveAge > maxAge;
      if (isOverAge) {
        logger.info(
          { candidateId: candidate.id, name: candidate.name, age: liveAge, maxAge },
          "Rescore: candidate exceeds maximum age — dismissing",
        );
      }

      await dbInstance
        .update(playerCandidatesTable)
        .set({
          eligibilityConfidence: score,
          usmntStatus: status,
          dataSources: ["api_football"],
          dateOfBirth,
          priorNationalTeamCaps: seniorCaps > 0 ? seniorCaps : null,
          priorYouthNtCaps: youthCaps > 0 ? youthCaps : null,
          lastScoredAt: new Date(),
          // Demote below-threshold or over-age candidates to avoid surfacing low-quality noise
          ...(score < minScore || isOverAge ? { status: "dismissed" as const } : {}),
        })
        .where(eq(playerCandidatesTable.id, candidate.id));

      await persistSignals(candidate.id, signals);
      updated++;

      logger.debug(
        { candidateId: candidate.id, name: candidate.name, score, status },
        "Rescore: candidate updated",
      );
    } catch (err) {
      failed++;
      logger.warn({ err, candidateId: candidate.id, name: candidate.name }, "Rescore: candidate failed");
    }
  }

  logger.info(
    { processed, updated, failed, skipped, skippedNoStats },
    "Rescore: all candidates rescored",
  );
  return { processed, updated, failed, skipped, skippedNoStats };
}

// ---------------------------------------------------------------------------
// Birthplace backfill
// ---------------------------------------------------------------------------

/** Minimal shape we need from the API-Football /players endpoint. */
interface AfBirthplaceRecord {
  player: { birth: { place: string | null } };
}

/**
 * For every `player_candidates` row that has an `api_football_player_id` but
 * no `birthplace`, fetches `birth.place` from API-Football and writes it to
 * the DB.  Seasons are tried in descending order so players whose most recent
 * activity is in a prior season still get a birthplace returned.
 *
 * Returns counts of updated, notFound, and failed candidates.
 *
 * @param options.seasons  Season years to try, newest first.  Defaults to the
 *   three most recent years relative to today.
 */
export async function backfillCandidateBirthplaces(options: {
  seasons?: number[];
} = {}): Promise<{ updated: number; notFound: number; failed: number; total: number }> {
  const candidates = await db
    .select({
      id: playerCandidatesTable.id,
      name: playerCandidatesTable.name,
      apiFootballPlayerId: playerCandidatesTable.apiFootballPlayerId,
    })
    .from(playerCandidatesTable)
    .where(
      and(
        isNull(playerCandidatesTable.birthplace),
        isNotNull(playerCandidatesTable.apiFootballPlayerId),
      ),
    );

  const currentYear = new Date().getUTCFullYear();
  const seasons = options.seasons ?? [currentYear, currentYear - 1, currentYear - 2];

  logger.info({ count: candidates.length }, "Birthplace backfill: started");

  let updated = 0;
  let failed = 0;
  let notFound = 0;

  for (const candidate of candidates) {
    if (!candidate.apiFootballPlayerId) {
      logger.warn(
        { candidateId: candidate.id, name: candidate.name },
        "Birthplace backfill: skipping — no apiFootballPlayerId",
      );
      notFound++;
      continue;
    }
    try {
      let birthplace: string | null = null;
      for (const season of seasons) {
        const [data] = await afFetch<AfBirthplaceRecord[]>(
          `/players?id=${candidate.apiFootballPlayerId}&season=${season}`,
        );
        birthplace = data?.player?.birth?.place ?? null;
        if (birthplace) break;
      }
      if (!birthplace) {
        logger.debug(
          { candidateId: candidate.id, name: candidate.name },
          "Birthplace backfill: no birthplace returned for any season",
        );
        notFound++;
        continue;
      }
      await db
        .update(playerCandidatesTable)
        .set({ birthplace })
        .where(eq(playerCandidatesTable.id, candidate.id));
      logger.info(
        { candidateId: candidate.id, name: candidate.name, birthplace },
        "Birthplace backfill: updated",
      );
      updated++;
    } catch (err) {
      logger.warn(
        { err, candidateId: candidate.id, name: candidate.name },
        "Birthplace backfill: fetch failed",
      );
      failed++;
    }
  }

  logger.info(
    { updated, notFound, failed, total: candidates.length },
    "Birthplace backfill: complete",
  );
  return { updated, notFound, failed, total: candidates.length };
}

// ---------------------------------------------------------------------------
// Date-of-birth backfill
// ---------------------------------------------------------------------------

/** Minimal shape we need from the API-Football /players endpoint. */
interface AfDateOfBirthRecord {
  player: { birth: { date: string | null } };
}

/**
 * For every `player_candidates` row that has an `api_football_player_id` but
 * no `date_of_birth`, fetches `birth.date` from API-Football and writes it to
 * the DB (also refreshing the display-only `age` column so both stay
 * consistent). Mirrors `backfillCandidateBirthplaces`. Seasons are tried in
 * descending order so players whose most recent activity is in a prior
 * season still get a birth date returned.
 *
 * This function is only ever invoked from the `/admin/backfill-candidate-dob`
 * route below — it is not called automatically on a schedule or at startup,
 * so existing candidates keep their current age gate outcome until an
 * operator explicitly triggers it.
 *
 * Returns counts of updated, notFound, and failed candidates.
 *
 * @param options.seasons  Season years to try, newest first.  Defaults to the
 *   three most recent years relative to today.
 */
export async function backfillCandidateDatesOfBirth(options: {
  seasons?: number[];
} = {}): Promise<{ updated: number; notFound: number; failed: number; total: number }> {
  const candidates = await db
    .select({
      id: playerCandidatesTable.id,
      name: playerCandidatesTable.name,
      apiFootballPlayerId: playerCandidatesTable.apiFootballPlayerId,
    })
    .from(playerCandidatesTable)
    .where(
      and(
        isNull(playerCandidatesTable.dateOfBirth),
        isNotNull(playerCandidatesTable.apiFootballPlayerId),
      ),
    );

  const currentYear = new Date().getUTCFullYear();
  const seasons = options.seasons ?? [currentYear, currentYear - 1, currentYear - 2];

  logger.info({ count: candidates.length }, "Date-of-birth backfill: started");

  let updated = 0;
  let failed = 0;
  let notFound = 0;

  for (const candidate of candidates) {
    if (!candidate.apiFootballPlayerId) {
      logger.warn(
        { candidateId: candidate.id, name: candidate.name },
        "Date-of-birth backfill: skipping — no apiFootballPlayerId",
      );
      notFound++;
      continue;
    }
    try {
      let dateOfBirth: string | null = null;
      for (const season of seasons) {
        const [data] = await afFetch<AfDateOfBirthRecord[]>(
          `/players?id=${candidate.apiFootballPlayerId}&season=${season}`,
        );
        dateOfBirth = data?.player?.birth?.date ?? null;
        if (dateOfBirth) break;
      }
      if (!dateOfBirth) {
        logger.debug(
          { candidateId: candidate.id, name: candidate.name },
          "Date-of-birth backfill: no birth date returned for any season",
        );
        notFound++;
        continue;
      }
      const liveAge = ageFromBirthDate(dateOfBirth);
      await db
        .update(playerCandidatesTable)
        .set({ dateOfBirth, ...(liveAge != null ? { age: liveAge } : {}) })
        .where(eq(playerCandidatesTable.id, candidate.id));
      logger.info(
        { candidateId: candidate.id, name: candidate.name, dateOfBirth, liveAge },
        "Date-of-birth backfill: updated",
      );
      updated++;
    } catch (err) {
      logger.warn(
        { err, candidateId: candidate.id, name: candidate.name },
        "Date-of-birth backfill: fetch failed",
      );
      failed++;
    }
  }

  logger.info(
    { updated, notFound, failed, total: candidates.length },
    "Date-of-birth backfill: complete",
  );
  return { updated, notFound, failed, total: candidates.length };
}

// ---------------------------------------------------------------------------
// Weight-drift detection and rescore from stored signals
// ---------------------------------------------------------------------------

const WEIGHT_FINGERPRINT_KEY = "eligibility_weight_fingerprint";

/**
 * Re-scores every non-manually-overridden candidate using the signals already
 * stored in `eligibility_signals` and the *current* weights from the signal
 * registry.  Makes no API-Football calls — this is a pure DB operation that
 * recalculates each candidate's score by applying updated weights to whatever
 * signal types previously fired for them.
 *
 * Status transitions:
 *   - pending  → dismissed  when new score < minScore
 *   - dismissed → pending   when new score >= minScore  (sets needsReview = true)
 *   - promoted rows: score is updated but status is left intact (already reviewed)
 *
 * Returns counts of processed, demoted, surfaced, updated, and failed rows.
 */
export async function rescoreCandidatesFromStoredSignals(): Promise<{
  processed: number;
  updated: number;
  demoted: number;
  surfaced: number;
  failed: number;
}> {
  const minScore = getMinEligibilityScore();
  const currentWeights = getResolvedWeights();

  // Build a lookup of maxContribution caps from the registry
  const maxContributionByType = new Map<string, number>(
    SIGNAL_REGISTRY.map((def) => [def.signalType, def.maxContribution]),
  );

  // Fetch all candidates that were not manually overridden.
  // We include dismissed rows because a weight increase may push them above
  // the threshold and they should be surfaced for review.
  const candidates = await db
    .select({
      id: playerCandidatesTable.id,
      name: playerCandidatesTable.name,
      status: playerCandidatesTable.status,
      isManualOverride: playerCandidatesTable.isManualOverride,
    })
    .from(playerCandidatesTable)
    .where(
      or(
        eq(playerCandidatesTable.isManualOverride, false),
        isNull(playerCandidatesTable.isManualOverride),
      ),
    );

  // Fetch all stored signals in one query and group by candidateId
  const allSignals = await db
    .select({
      candidateId: eligibilitySignalsTable.candidateId,
      signalType: eligibilitySignalsTable.signalType,
    })
    .from(eligibilitySignalsTable);

  const signalsByCandidateId = new Map<number, string[]>();
  for (const row of allSignals) {
    const existing = signalsByCandidateId.get(row.candidateId) ?? [];
    existing.push(row.signalType);
    signalsByCandidateId.set(row.candidateId, existing);
  }

  let processed = 0;
  let updated = 0;
  let demoted = 0;
  let surfaced = 0;
  let failed = 0;

  for (const candidate of candidates) {
    processed++;
    try {
      const firedSignalTypes = signalsByCandidateId.get(candidate.id) ?? [];

      // Re-apply current weights to each signal type that previously fired.
      let rawScore = 0;
      for (const signalType of firedSignalTypes) {
        const weight = currentWeights[signalType] ?? 0;
        const cap = maxContributionByType.get(signalType) ?? weight;
        rawScore += Math.min(weight, cap);
      }
      const newScore = Math.min(100, rawScore);

      // Determine whether the status should change.
      const currentStatus = candidate.status as "pending" | "dismissed" | "promoted";
      let newStatus: typeof currentStatus | null = null;
      if (newScore < minScore && currentStatus === "pending") {
        newStatus = "dismissed";
        demoted++;
        logger.info(
          { candidateId: candidate.id, name: candidate.name, newScore, minScore },
          "Weight-drift rescore: candidate demoted below threshold",
        );
      } else if (newScore >= minScore && currentStatus === "dismissed") {
        newStatus = "pending";
        surfaced++;
        logger.info(
          { candidateId: candidate.id, name: candidate.name, newScore, minScore },
          "Weight-drift rescore: dismissed candidate now meets threshold — surfaced for review",
        );
      }

      await db
        .update(playerCandidatesTable)
        .set({
          eligibilityConfidence: newScore,
          lastScoredAt: new Date(),
          ...(newStatus === "dismissed" ? { status: "dismissed" as const } : {}),
          ...(newStatus === "pending" ? { status: "pending" as const, needsReview: true } : {}),
        })
        .where(eq(playerCandidatesTable.id, candidate.id));

      updated++;
    } catch (err) {
      failed++;
      logger.warn(
        { err, candidateId: candidate.id, name: candidate.name },
        "Weight-drift rescore: update failed for candidate",
      );
    }
  }

  logger.info(
    { processed, updated, demoted, surfaced, failed },
    "Weight-drift rescore: complete",
  );
  return { processed, updated, demoted, surfaced, failed };
}

/**
 * Reads the stored eligibility weight fingerprint from `server_config`,
 * compares it to the current resolved weights, and — if they differ —
 * runs `rescoreCandidatesFromStoredSignals()` and persists the new fingerprint.
 *
 * Designed to be called once on server startup.  Logs a warning if the
 * fingerprint has changed so operators know a rescore was triggered.
 * All errors are caught and logged non-fatally so a DB hiccup never
 * prevents the server from starting.
 */
export async function checkAndApplyWeightDrift(): Promise<void> {
  try {
    const currentFingerprint = getWeightFingerprint();

    const rows = await db
      .select({ value: serverConfigTable.value })
      .from(serverConfigTable)
      .where(eq(serverConfigTable.key, WEIGHT_FINGERPRINT_KEY));

    const storedFingerprint = rows[0]?.value ?? null;

    if (storedFingerprint === currentFingerprint) {
      logger.debug("Startup: eligibility weights unchanged — no rescore needed");
      return;
    }

    if (storedFingerprint === null) {
      logger.info(
        { fingerprint: currentFingerprint },
        "Startup: no stored weight fingerprint found — saving baseline (first run)",
      );
    } else {
      logger.warn(
        { previous: storedFingerprint, current: currentFingerprint },
        "Startup: eligibility weights have changed — triggering rescore of all candidates",
      );
      const result = await rescoreCandidatesFromStoredSignals();
      logger.info(result, "Startup: weight-drift rescore finished");
    }

    // Persist the new fingerprint (upsert)
    await db
      .insert(serverConfigTable)
      .values({ key: WEIGHT_FINGERPRINT_KEY, value: currentFingerprint })
      .onConflictDoUpdate({
        target: serverConfigTable.key,
        set: { value: currentFingerprint, updatedAt: new Date() },
      });
  } catch (err) {
    logger.warn({ err }, "Startup: weight-drift check failed (non-fatal)");
  }
}
