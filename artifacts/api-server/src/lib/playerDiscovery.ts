import { db, clubsTable, playersTable, playerCandidatesTable, eligibilitySignalsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { afFetch } from "./apiFootballSync";
import { isFriendlyLeague } from "./playerStatsSync";
import { evaluateEligibility, type EligibilityProfile } from "./evaluateEligibility";
import { getMinEligibilityScore } from "./eligibilitySignalsConfig";

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
    age: number | null;
    nationality: string | null;
    birth: { country: string | null; date: string | null; place?: string | null };
  };
  statistics: AfDiscoveryStatBlock[];
}

const MIN_STARTS = 5;
const MIN_MINUTES = 450;

// National team competitions — presence of these league names in a stat block
// means the player appeared for a national team, not a club.
const NATIONAL_TEAM_RE =
  /world cup|nations league|euro\b|copa am[eé]rica|gold cup|concacaf|olympic|qualification|qualifier|continental championship|africa cup|asian cup|afcon/i;

function looksLikeNationalTeamCompetition(leagueName: string): boolean {
  return NATIONAL_TEAM_RE.test(leagueName) && !isFriendlyLeague(leagueName);
}

function hasSeniorNonUsCaps(statistics: AfDiscoveryStatBlock[]): boolean {
  return statistics.some(
    (s) =>
      looksLikeNationalTeamCompetition(s.league.name) &&
      s.team.name !== "United States" &&
      s.team.name !== "USA" &&
      (s.games.lineups ?? 0) > 0,
  );
}

function applyQualityGate(statistics: AfDiscoveryStatBlock[]): {
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
    db.select({ apiFootballPlayerId: playerCandidatesTable.apiFootballPlayerId }).from(playerCandidatesTable),
  ]);

  const knownApiIds = new Set<number>([
    // Existing pool guard — never re-evaluate a player already being tracked.
    ...trackedPlayers.flatMap((p) => (p.apiFootballPlayerId != null ? [p.apiFootballPlayerId] : [])),
    ...existingCandidates.map((c) => c.apiFootballPlayerId),
  ]);

  const minScore = getMinEligibilityScore();
  const currentYear = new Date().getUTCFullYear();
  const seasonCandidates = [currentYear, currentYear - 1];

  let checked = 0;
  let inserted = 0;
  let skippedQuality = 0;
  let skippedEligibility = 0;
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

      // Try current season first, fall back to previous year.
      let profile: AfDiscoveryResponse | null = null;
      for (const season of seasonCandidates) {
        try {
          const results = await afFetch<AfDiscoveryResponse[]>(`/players?id=${squadPlayer.id}&season=${season}`);
          if (results[0]?.statistics?.length) {
            profile = results[0];
            break;
          }
        } catch {
          // Try the next season year
        }
      }

      if (!profile) continue; // no stats available — too new or not in API's coverage

      const { player, statistics } = profile;

      // Quality gate — reject bench-warmers before the eligibility check
      const { passes, starts, minutes } = applyQualityGate(statistics);
      if (!passes) {
        skippedQuality++;
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

      const { score, status, signals } = evaluateEligibility(eligibilityProfile);

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
      } else if (!hasSeniorNonUsCaps(statistics)) {
        eligibilityBasis = "birth_country";
      } else {
        eligibilityBasis = "dual_national_unconfirmed";
      }

      const priorNationalTeamCaps = statistics
        .filter((s) => looksLikeNationalTeamCompetition(s.league.name))
        .reduce((sum, s) => sum + (s.games.lineups ?? 0), 0);

      const dataSources = ["api_football"];

      try {
        const rows = await db
          .insert(playerCandidatesTable)
          .values({
            name: player.name,
            position: inferPosition(statistics),
            age: player.age ?? null,
            clubId: club.id,
            apiFootballPlayerId: player.id,
            nationality,
            birthCountry,
            birthplace: player.birth.place ?? null,
            currentSeasonStarts: starts,
            currentSeasonMinutes: minutes,
            currentSeasonRating: computeAvgRating(statistics),
            priorNationalTeamCaps: priorNationalTeamCaps > 0 ? priorNationalTeamCaps : null,
            eligibilityBasis,
            eligibilityConfidence: score,
            usmntStatus: status,
            dataSources,
            status: "pending",
          })
          .onConflictDoUpdate({
            target: playerCandidatesTable.apiFootballPlayerId,
            set: {
              eligibilityConfidence: score,
              usmntStatus: status,
              dataSources,
              birthplace: player.birth.place ?? null,
              currentSeasonStarts: starts,
              currentSeasonMinutes: minutes,
              currentSeasonRating: computeAvgRating(statistics),
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
            { name: player.name, club: club.name, eligibilityBasis, score, status, starts, minutes },
            "Discovery: new US-eligible prospect inserted as candidate",
          );
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
    { checked, inserted, skippedQuality, skippedEligibility, skippedScore },
    "Discovery: US prospect scan complete",
  );
  return { checked, inserted, skippedQuality, skippedEligibility, skippedScore };
}

// ---------------------------------------------------------------------------
// Rescore all non-dismissed candidates
// ---------------------------------------------------------------------------

/**
 * Re-fetches stats from API-Football for every non-dismissed candidate and
 * re-evaluates their eligibility score using the current signal registry
 * weights.  Writes updated `eligibility_confidence`, `usmnt_status`,
 * `data_sources`, and signal rows back to the DB.  Never touches `players`.
 */
export async function rescoreAllCandidates(): Promise<{
  processed: number;
  updated: number;
  failed: number;
}> {
  const candidates = await db
    .select({
      id: playerCandidatesTable.id,
      name: playerCandidatesTable.name,
      apiFootballPlayerId: playerCandidatesTable.apiFootballPlayerId,
    })
    .from(playerCandidatesTable)
    .where(eq(playerCandidatesTable.status, "pending"));

  const currentYear = new Date().getUTCFullYear();
  const seasonCandidates = [currentYear, currentYear - 1];
  const minScore = getMinEligibilityScore();

  let processed = 0;
  let updated = 0;
  let failed = 0;

  for (const candidate of candidates) {
    processed++;
    try {
      // Re-fetch stats from API-Football
      type RescoredProfile = { player: { nationality: string | null; birth: { country: string | null; place?: string | null } }; statistics: AfDiscoveryStatBlock[] };
      let profile: RescoredProfile | null = null;
      for (const season of seasonCandidates) {
        try {
          const results = await afFetch<RescoredProfile[]>(`/players?id=${candidate.apiFootballPlayerId}&season=${season}`);
          if (results[0]?.statistics?.length) {
            profile = results[0];
            break;
          }
        } catch {
          // Try next season
        }
      }

      if (!profile) {
        logger.debug({ candidateId: candidate.id, name: candidate.name }, "Rescore: no stats found, skipping");
        continue;
      }

      const eligibilityProfile: EligibilityProfile = {
        nationality: profile.player.nationality ?? null,
        birthCountry: profile.player.birth.country ?? null,
        birthplace: profile.player.birth.place ?? null,
        statistics: profile.statistics,
      };

      const { score, status, signals } = evaluateEligibility(eligibilityProfile);

      await db
        .update(playerCandidatesTable)
        .set({
          eligibilityConfidence: score,
          usmntStatus: status,
          dataSources: ["api_football"],
          // Demote below-threshold candidates to avoid surfacing low-quality noise
          ...(score < minScore ? { status: "dismissed" as const } : {}),
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

  logger.info({ processed, updated, failed }, "Rescore: all candidates rescored");
  return { processed, updated, failed };
}
