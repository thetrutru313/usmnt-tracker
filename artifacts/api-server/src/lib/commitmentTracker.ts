import { db, playersTable, playerCandidatesTable, playerStatusHistoryTable } from "@workspace/db";
import { eq, ne, and, isNotNull, isNull, or } from "drizzle-orm";
import { logger } from "./logger";
import { afFetch } from "./apiFootballSync";
import { isFriendlyLeague } from "./playerStatsSync";

// ---------------------------------------------------------------------------
// Commitment Tracking & Auto-Flag Pipeline
//
// Detects when a tracked player or promoted candidate has made a senior debut
// for a non-US national team and updates their usmnt_status accordingly.
//
// DETECTION STRATEGY — two-layer guard against false positives:
//
//   Layer 1 — Team identity (primary guard):
//     Call /players/teams?player={id} to get the full list of teams a player
//     has been associated with, including the `national` boolean flag that
//     API-Football sets on the team entity. Only teams with national=true
//     are ever treated as national-team appearances. This eliminates club
//     competitions entirely: a player at a Liga MX club has blocks under
//     "Club América" (national=false), not under "Mexico" (national=true).
//     CONCACAF club tournaments (Champions Cup, Liga de Campeones) are also
//     clubs — they will never have national=true.
//
//   Layer 2 — Stat-block lookup (secondary guard):
//     After identifying verified non-US national team IDs, we only inspect
//     stat blocks where block.team.id is in that set. This ensures that even
//     if a competition name ambiguously matches a pattern, the block is still
//     only accepted when the TEAM is verified as a national side.
//
// Confidence classification:
//   HIGH — verified national team + non-friendly competition block with ≥1 start
//          → auto-update usmnt_status to CAP_TIED_OTHER + write history row
//   LOW  — verified national team + friendly-only appearances
//          → set needs_review = true; no status change
//   NONE — no verified non-US national team appearances found
//          → only run flag-condition checks (confidence threshold)
//
// Auto-flag rules (evaluateFlagConditions):
//   1. eligibility_confidence < MIN_CONFIDENCE_THRESHOLD (default 40)
//   2. A new non-US national-team appearance was detected (any confidence)
//
// Status transition guarantees:
//   - Never deletes a player record, match logs, stats, or fixtures.
//   - Every status change writes a row to player_status_history (audit trail).
//   - Only HIGH-confidence detections auto-change usmnt_status.
//   - LOW-confidence signals only set needs_review = true.
// ---------------------------------------------------------------------------

/** Minimum eligibility_confidence below which a player is auto-flagged. */
export const MIN_CONFIDENCE_THRESHOLD = 40;

const USA_TEAM_NAMES = new Set(["United States", "USA"]);
const USA_NATIONAL_TEAM_IDS = new Set([2384]); // API-Football team id for USA men's NT

// Shape returned by /players/teams?player={id}
interface AfPlayerTeamEntry {
  team: {
    id: number;
    name: string;
    /** true when this is a national team, false/absent for clubs */
    national?: boolean;
  };
  seasons?: unknown[];
}

// Shape of a season stat block (minimal fields we care about)
interface AfStatBlock {
  team: { id: number; name: string };
  league: { name: string; season: number };
  games: { lineups: number | null; minutes: number | null };
}

interface AfPlayerSeasonStats {
  player: { id: number };
  statistics: AfStatBlock[];
}

/**
 * Fetches the player's team history from API-Football and returns a map of
 * non-US national team IDs → team names.  Only teams with `national === true`
 * that are not the USA are included.
 *
 * Returns an empty map when the API call fails or the player has no national-
 * team associations; callers treat that as "no evidence of non-US commitment".
 */
export async function fetchPlayerNationalTeams(
  apiFootballPlayerId: number,
): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  try {
    const entries = await afFetch<AfPlayerTeamEntry[]>(`/players/teams?player=${apiFootballPlayerId}`);
    for (const entry of entries) {
      const { id, name, national } = entry.team;
      if (!national) continue;
      if (USA_NATIONAL_TEAM_IDS.has(id)) continue;
      if (USA_TEAM_NAMES.has(name)) continue;
      result.set(id, name);
    }
  } catch (err) {
    logger.warn({ err, apiFootballPlayerId }, "CommitmentTracker: /players/teams fetch failed — treating as no national-team history");
  }
  return result;
}

/**
 * Represents a detected non-US national team appearance.
 */
export interface NonUsDetection {
  teamId: number;
  teamName: string;
  leagueName: string;
  /** "competitive" = non-friendly national-team competition, "friendly" = exhibition only */
  kind: "competitive" | "friendly";
  /** Number of lineups (starts) in this competition block */
  lineups: number;
}

/**
 * Classification of the overall detection confidence.
 * HIGH → automatic status update; LOW → needs_review flag only; NONE → no action.
 */
export type DetectionConfidence = "HIGH" | "LOW" | "NONE";

export interface CommitmentDetectionResult {
  confidence: DetectionConfidence;
  detections: NonUsDetection[];
  /** Human-readable reason string for player_status_history; null when confidence=NONE */
  reason: string | null;
}

/**
 * Fetches a player's competition history across recent seasons and identifies
 * appearances for verified non-US national teams.
 *
 * The two-layer guard (team identity + stat-block lookup) prevents false
 * positives from club competitions — see module-level comment for details.
 */
export async function detectNonUsCommitment(
  apiFootballPlayerId: number,
): Promise<CommitmentDetectionResult> {
  // Layer 1: verify which teams are non-US national teams
  const nonUsNationalTeams = await fetchPlayerNationalTeams(apiFootballPlayerId);

  if (nonUsNationalTeams.size === 0) {
    // No non-US national team associations at all — skip stat fetch entirely
    return { confidence: "NONE", detections: [], reason: null };
  }

  // Layer 2: fetch season stats and check only verified national-team blocks
  const currentYear = new Date().getUTCFullYear();
  const seasonCandidates = [currentYear, currentYear - 1, currentYear - 2];
  const allStatBlocks: AfStatBlock[] = [];

  for (const season of seasonCandidates) {
    try {
      const [data] = await afFetch<AfPlayerSeasonStats[]>(`/players?id=${apiFootballPlayerId}&season=${season}`);
      if (data?.statistics?.length) {
        allStatBlocks.push(...data.statistics);
      }
    } catch (err) {
      logger.warn(
        { err, apiFootballPlayerId, season },
        "CommitmentTracker: season-stats fetch failed, skipping season",
      );
    }
  }

  const detections: NonUsDetection[] = [];

  for (const block of allStatBlocks) {
    const teamId = block.team.id;
    const teamName = nonUsNationalTeams.get(teamId);
    if (!teamName) continue; // Not a verified non-US national team — skip

    const lineups = block.games.lineups ?? 0;
    if (lineups === 0) continue; // Listed in team history but no actual appearances this block

    const leagueName = block.league.name;
    const kind: "competitive" | "friendly" = isFriendlyLeague(leagueName) ? "friendly" : "competitive";

    detections.push({ teamId, teamName, leagueName, kind, lineups });
  }

  const competitiveDetections = detections.filter((d) => d.kind === "competitive");
  const friendlyOnlyDetections = detections.filter((d) => d.kind === "friendly");

  if (competitiveDetections.length > 0) {
    const primary = competitiveDetections[0]!;
    const reason = `Senior debut detected for ${primary.teamName} in ${primary.leagueName} (${primary.lineups} start${primary.lineups === 1 ? "" : "s"})`;
    return { confidence: "HIGH", detections: competitiveDetections, reason };
  }

  if (friendlyOnlyDetections.length > 0) {
    const primary = friendlyOnlyDetections[0]!;
    const reason = `Friendly-only non-US national team appearance for ${primary.teamName} in ${primary.leagueName} — requires manual review`;
    return { confidence: "LOW", detections: friendlyOnlyDetections, reason };
  }

  // Had national team history but no actual starts in any block
  return { confidence: "NONE", detections: [], reason: null };
}

/**
 * Writes a status change row to player_status_history and updates the
 * usmnt_status column on the players table.
 *
 * Safe to call even if prevStatus is null (first-ever status assignment).
 * Never deletes any player data.
 */
export async function recordStatusChange(
  playerId: number,
  prevStatus: string | null,
  newStatus: string,
  reason: string,
  changedBy: string,
): Promise<void> {
  await db.insert(playerStatusHistoryTable).values({
    playerId,
    prevStatus,
    newStatus,
    reason,
    changedBy,
  });

  await db
    .update(playersTable)
    .set({
      usmntStatus: newStatus as
        | "US_ELIGIBLE_PROSPECT"
        | "DUAL_NATIONAL"
        | "CAP_TIED_OTHER"
        | "DECLARED_OTHER"
        | "UNKNOWN",
    })
    .where(eq(playersTable.id, playerId));

  logger.info(
    { playerId, prevStatus, newStatus, reason, changedBy },
    "CommitmentTracker: status changed",
  );
}

type PlayerForFlagCheck = {
  id: number;
  name: string;
  eligibilityConfidence?: number | null;
  needsReview?: boolean | null;
};

/**
 * Evaluates auto-flag conditions for a tracked player and sets
 * needs_review = true on the players table if any condition fires.
 * Does NOT change usmnt_status.
 *
 * Conditions:
 *   1. eligibility_confidence < MIN_CONFIDENCE_THRESHOLD
 *   2. A new non-US international appearance was detected (passed as argument)
 *
 * Returns true if needs_review is/was set (including already-set cases).
 */
export async function evaluateFlagConditions(
  player: PlayerForFlagCheck,
  newInternationalDetection: boolean,
): Promise<boolean> {
  const reasons: string[] = [];

  if (
    player.eligibilityConfidence != null &&
    player.eligibilityConfidence < MIN_CONFIDENCE_THRESHOLD
  ) {
    reasons.push(
      `eligibility_confidence (${player.eligibilityConfidence}) below threshold (${MIN_CONFIDENCE_THRESHOLD})`,
    );
  }

  if (newInternationalDetection) {
    reasons.push("new international appearance detected for non-US federation");
  }

  if (reasons.length === 0) return player.needsReview === true;

  if (!player.needsReview) {
    await db
      .update(playersTable)
      .set({ needsReview: true })
      .where(eq(playersTable.id, player.id));

    logger.info(
      { playerId: player.id, name: player.name, reasons },
      "CommitmentTracker: player flagged for review",
    );
  }

  return true;
}

/**
 * Same as evaluateFlagConditions but for player_candidates rows.
 */
async function evaluateCandidateFlagConditions(
  candidateId: number,
  candidateName: string,
  eligibilityConfidence: number | null,
  needsReview: boolean | null,
  newInternationalDetection: boolean,
): Promise<boolean> {
  const reasons: string[] = [];

  if (
    eligibilityConfidence != null &&
    eligibilityConfidence < MIN_CONFIDENCE_THRESHOLD
  ) {
    reasons.push(
      `eligibility_confidence (${eligibilityConfidence}) below threshold (${MIN_CONFIDENCE_THRESHOLD})`,
    );
  }

  if (newInternationalDetection) {
    reasons.push("new international appearance detected for non-US federation");
  }

  if (reasons.length === 0) return needsReview === true;

  if (!needsReview) {
    await db
      .update(playerCandidatesTable)
      .set({ needsReview: true })
      .where(eq(playerCandidatesTable.id, candidateId));

    logger.info(
      { candidateId, name: candidateName, reasons },
      "CommitmentTracker: candidate flagged for review",
    );
  }

  return true;
}

/**
 * Iterates all tracked players and non-dismissed candidates, detects
 * commitment signals, applies auto-flag rules, and batches the resulting
 * DB writes.
 *
 * For tracked players (players table):
 *   - HIGH confidence → status updated to CAP_TIED_OTHER + history row written
 *   - LOW confidence  → needs_review = true (no status change)
 *   - Any detection   → also runs flag-condition checks
 *
 * For pending/promoted candidates (player_candidates):
 *   - Only auto-flag rules apply (no status change — human review first)
 */
export async function runCommitmentSweep(): Promise<{
  playersChecked: number;
  statusUpdated: number;
  flagged: number;
  candidatesChecked: number;
  candidatesFlagged: number;
  errors: number;
}> {
  logger.info("CommitmentTracker: starting sweep");

  let playersChecked = 0;
  let statusUpdated = 0;
  let flagged = 0;
  let candidatesChecked = 0;
  let candidatesFlagged = 0;
  let errors = 0;

  // --- Tracked players -------------------------------------------------
  const players = await db
    .select({
      id: playersTable.id,
      name: playersTable.name,
      apiFootballPlayerId: playersTable.apiFootballPlayerId,
      usmntStatus: playersTable.usmntStatus,
      needsReview: playersTable.needsReview,
    })
    .from(playersTable)
    .where(
      and(
        isNotNull(playersTable.apiFootballPlayerId),
        // Skip players already confirmed as cap-tied — no need to re-check.
        // Must use OR with isNull because SQL `NULL <> 'CAP_TIED_OTHER'`
        // evaluates to NULL (not TRUE), which would silently exclude the entire
        // population of players whose usmnt_status is still NULL.
        or(
          isNull(playersTable.usmntStatus),
          ne(
            playersTable.usmntStatus as typeof playersTable.usmntStatus,
            "CAP_TIED_OTHER" as "CAP_TIED_OTHER",
          ),
        ),
      ),
    );

  for (const player of players) {
    playersChecked++;
    try {
      const detection = await detectNonUsCommitment(player.apiFootballPlayerId!);
      const hadDetection = detection.confidence !== "NONE";

      if (detection.confidence === "HIGH") {
        await recordStatusChange(
          player.id,
          player.usmntStatus ?? null,
          "CAP_TIED_OTHER",
          detection.reason!,
          "system",
        );
        statusUpdated++;
      }

      // Always pass the persisted needsReview value — evaluateFlagConditions
      // writes the DB update itself when needs_review is currently false.
      // Forcing true here would short-circuit that write and leave the flag
      // unset in the database for HIGH detections that haven't been flagged yet.
      const wasFlagged = await evaluateFlagConditions(
        {
          id: player.id,
          name: player.name,
          needsReview: player.needsReview,
          eligibilityConfidence: null, // not tracked on players table yet
        },
        hadDetection,
      );
      if (wasFlagged && !player.needsReview) flagged++;
    } catch (err) {
      errors++;
      logger.warn(
        { err, playerId: player.id, name: player.name },
        "CommitmentTracker: error processing player",
      );
    }
  }

  // --- Non-dismissed candidates ----------------------------------------
  const candidates = await db
    .select({
      id: playerCandidatesTable.id,
      name: playerCandidatesTable.name,
      apiFootballPlayerId: playerCandidatesTable.apiFootballPlayerId,
      eligibilityConfidence: playerCandidatesTable.eligibilityConfidence,
      needsReview: playerCandidatesTable.needsReview,
      status: playerCandidatesTable.status,
    })
    .from(playerCandidatesTable)
    .where(
      and(
        ne(playerCandidatesTable.status, "dismissed"),
        isNotNull(playerCandidatesTable.apiFootballPlayerId),
      ),
    );

  for (const candidate of candidates) {
    candidatesChecked++;
    try {
      const detection = await detectNonUsCommitment(candidate.apiFootballPlayerId);
      const hadDetection = detection.confidence !== "NONE";

      const wasFlagged = await evaluateCandidateFlagConditions(
        candidate.id,
        candidate.name,
        candidate.eligibilityConfidence,
        candidate.needsReview,
        hadDetection,
      );
      if (wasFlagged && !candidate.needsReview) candidatesFlagged++;
    } catch (err) {
      errors++;
      logger.warn(
        { err, candidateId: candidate.id, name: candidate.name },
        "CommitmentTracker: error processing candidate",
      );
    }
  }

  logger.info(
    {
      playersChecked,
      statusUpdated,
      flagged,
      candidatesChecked,
      candidatesFlagged,
      errors,
    },
    "CommitmentTracker: sweep complete",
  );

  return {
    playersChecked,
    statusUpdated,
    flagged,
    candidatesChecked,
    candidatesFlagged,
    errors,
  };
}
