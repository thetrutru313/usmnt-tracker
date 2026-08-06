import { Router, type IRouter } from "express";
import { db, playerCandidatesTable, playersTable, clubsTable, eligibilitySignalsTable } from "@workspace/db";
import { requireAdminSession } from "../lib/adminAuth";
import { eq, desc, isNull, isNotNull, or, inArray, and, count, lt, lte, asc } from "drizzle-orm";
import { rescoreAllCandidates, backfillCandidateBirthplaces } from "../lib/playerDiscovery";
import { getMaxCandidateAge, SIGNAL_REGISTRY, getResolvedWeights } from "../lib/eligibilitySignalsConfig";
import { logger } from "../lib/logger";
import { afFetch, apiKey } from "../lib/apiFootballSync";
import { ageFromBirthDate } from "../lib/playerClubSync";
import { syncPlayerStatsAndInjuries, syncStatsForFinishedFixture } from "../lib/playerStatsSync";
import { syncPlayerClubs } from "../lib/playerClubSync";
import { syncApiFootballFixtures, syncNationalTeamFixtures, syncYouthNtFixtures } from "../lib/apiFootballSync";
import { cleanupOrphanedAnonUsers } from "../lib/anonUserCleanup";
import { runCommitmentSweep } from "../lib/commitmentTracker";

/** Minimal shape we need from the /players API-Football endpoint. */
interface AfPlayerRecord {
  player: { firstname: string | null; birth: { date: string | null; place: string | null } };
}

const router: IRouter = Router();

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Apply the session gate to every /admin/* route in this router.
router.use("/admin", requireAdminSession);

/**
 * GET /admin/session
 * Lightweight liveness probe for the client to validate a stored token without
 * triggering a full data fetch. Used by the AdminPanel on mount and on
 * visibility-change to detect revoked or expired sessions quickly.
 */
router.get("/admin/session", (_req, res): void => {
  res.json({ ok: true });
});

/**
 * GET /admin/player-candidates
 * Returns all pending candidates, most-played first.
 */
router.get("/admin/player-candidates", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: playerCandidatesTable.id,
      name: playerCandidatesTable.name,
      firstName: playerCandidatesTable.firstName,
      position: playerCandidatesTable.position,
      age: playerCandidatesTable.age,
      clubName: clubsTable.name,
      clubId: playerCandidatesTable.clubId,
      apiFootballPlayerId: playerCandidatesTable.apiFootballPlayerId,
      nationality: playerCandidatesTable.nationality,
      birthCountry: playerCandidatesTable.birthCountry,
      currentSeasonStarts: playerCandidatesTable.currentSeasonStarts,
      currentSeasonMinutes: playerCandidatesTable.currentSeasonMinutes,
      currentSeasonRating: playerCandidatesTable.currentSeasonRating,
      priorNationalTeamCaps: playerCandidatesTable.priorNationalTeamCaps,
      eligibilityBasis: playerCandidatesTable.eligibilityBasis,
      status: playerCandidatesTable.status,
      discoveredAt: playerCandidatesTable.discoveredAt,
    })
    .from(playerCandidatesTable)
    .leftJoin(clubsTable, eq(playerCandidatesTable.clubId, clubsTable.id))
    .where(eq(playerCandidatesTable.status, "pending"))
    .orderBy(desc(playerCandidatesTable.currentSeasonStarts));

  res.json({ candidates: rows });
});

/**
 * POST /admin/player-candidates/:id/dismiss
 * Marks a candidate as dismissed so they won't be re-surfaced.
 */
router.post("/admin/player-candidates/:id/dismiss", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] ?? "", 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid candidate id" });
    return;
  }

  const [updated] = await db
    .update(playerCandidatesTable)
    .set({ status: "dismissed" })
    .where(eq(playerCandidatesTable.id, id))
    .returning({ id: playerCandidatesTable.id });

  if (!updated) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  logger.info({ candidateId: id }, "Admin: candidate dismissed");
  res.json({ ok: true });
});

/**
 * POST /admin/player-candidates/:id/promote
 * Inserts the candidate into the players table as a prospect, then marks
 * the candidate row as promoted.  The player's photoUrl, marketValueUsd,
 * and potentialCallUpScore will be populated on the next daily sync run.
 */
router.post("/admin/player-candidates/:id/promote", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] ?? "", 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid candidate id" });
    return;
  }

  const [candidate] = await db
    .select()
    .from(playerCandidatesTable)
    .where(eq(playerCandidatesTable.id, id))
    .limit(1);

  if (!candidate) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }
  if (candidate.status !== "pending") {
    res.status(409).json({ error: `Candidate is already ${candidate.status}` });
    return;
  }

  const slug = slugify(candidate.name);

  try {
    const newPlayerId = await db.transaction(async (tx) => {
      const [newPlayer] = await tx
        .insert(playersTable)
        .values({
          name: candidate.name,
          slug,
          position: candidate.position ?? "MF",
          category: "prospect",
          clubId: candidate.clubId,
          age: candidate.age ?? 0,
          apiFootballPlayerId: candidate.apiFootballPlayerId,
          nationalTeamCaps: 0,
          nationalTeamGoals: 0,
          performanceTrend: "steady",
          trending: false,
          bio: "",
          worldCupRoster: false,
          eligibilityConfidence: candidate.eligibilityConfidence ?? undefined,
        })
        .returning({ id: playersTable.id });

      await tx
        .update(playerCandidatesTable)
        .set({ status: "promoted" })
        .where(eq(playerCandidatesTable.id, id));

      return newPlayer?.id;
    });

    logger.info(
      { candidateId: id, playerId: newPlayerId, name: candidate.name },
      "Admin: candidate promoted to player pool",
    );
    res.json({ ok: true, playerId: newPlayerId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Most likely a slug or API ID conflict — log the raw DB error server-side
    // but return only a sanitized message to the caller so internal schema
    // details (table names, constraint names, conflicting values) are not exposed.
    if (msg.includes("unique") || msg.includes("duplicate")) {
      logger.warn({ err, candidateId: id }, "Admin: promote failed — unique constraint violation");
      res.status(409).json({ error: "A player with this name or API ID already exists in the pool" });
    } else {
      logger.error({ err, candidateId: id }, "Admin: promote failed");
      res.status(500).json({ error: "Promote failed" });
    }
  }
});

/**
 * GET /admin/rescore-status
 * Lightweight endpoint that returns the current rescore backlog so operators
 * can see how many candidates are waiting to be scored and whether the cap
 * needs adjusting.
 *
 * Response shape:
 *   {
 *     pendingTotal:   number  — non-override pending candidates
 *     cap:            number  — current per-run cap (RESCORE_MAX_CANDIDATES or 50)
 *     withinCap:      number  — candidates scored on the next run  (min(total, cap))
 *     backlog:        number  — candidates deferred beyond the cap (max(0, total − cap))
 *     pendingRescore: number  — pending candidates with last_scored_at null or > 7 days old
 *   }
 */
router.get("/admin/rescore-status", async (_req, res): Promise<void> => {
  const DEFAULT_CAP = 50;
  const envCap = parseInt(process.env["RESCORE_MAX_CANDIDATES"] ?? "", 10);
  const cap = Number.isFinite(envCap) && envCap > 0 ? envCap : DEFAULT_CAP;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [[totalRow], [pendingRescoreRow]] = await Promise.all([
    db
      .select({ total: count() })
      .from(playerCandidatesTable)
      .where(
        and(
          eq(playerCandidatesTable.status, "pending"),
          or(
            isNull(playerCandidatesTable.isManualOverride),
            eq(playerCandidatesTable.isManualOverride, false),
          ),
        ),
      ),
    db
      .select({ total: count() })
      .from(playerCandidatesTable)
      .where(
        and(
          eq(playerCandidatesTable.status, "pending"),
          or(
            isNull(playerCandidatesTable.lastScoredAt),
            lt(playerCandidatesTable.lastScoredAt, sevenDaysAgo),
          ),
        ),
      ),
  ]);

  const pendingTotal = totalRow?.total ?? 0;
  const pendingRescore = pendingRescoreRow?.total ?? 0;
  const withinCap = Math.min(pendingTotal, cap);
  const backlog = Math.max(0, pendingTotal - cap);

  res.json({ pendingTotal, withinCap, backlog, cap, pendingRescore });
});

/**
 * GET /admin/review-queue
 * Returns all player_candidates rows where status = "pending" or
 * needs_review = true, ordered by eligibility_confidence descending.
 * Each record includes the candidate's core fields, club name, and the
 * full list of fired eligibility_signals.
 *
 * Also includes a top-level `pendingRescore` count: the number of pending
 * candidates whose last_scored_at is null or older than 7 days.
 */
router.get("/admin/review-queue", async (_req, res): Promise<void> => {
  const maxAge = getMaxCandidateAge();

  const candidates = await db
    .select({
      id: playerCandidatesTable.id,
      name: playerCandidatesTable.name,
      firstName: playerCandidatesTable.firstName,
      position: playerCandidatesTable.position,
      age: playerCandidatesTable.age,
      clubName: clubsTable.name,
      usmntStatus: playerCandidatesTable.usmntStatus,
      eligibilityConfidence: playerCandidatesTable.eligibilityConfidence,
      dataSources: playerCandidatesTable.dataSources,
      status: playerCandidatesTable.status,
      needsReview: playerCandidatesTable.needsReview,
      isManualOverride: playerCandidatesTable.isManualOverride,
      statusNotes: playerCandidatesTable.statusNotes,
      duplicateOfId: playerCandidatesTable.duplicateOfId,
    })
    .from(playerCandidatesTable)
    .leftJoin(clubsTable, eq(playerCandidatesTable.clubId, clubsTable.id))
    .where(
      and(
        or(
          eq(playerCandidatesTable.status, "pending"),
          eq(playerCandidatesTable.needsReview, true),
        ),
        // Exclude over-age candidates so rows inserted before a rescore cleans
        // them up never surface in the UI. Candidates with no recorded age are
        // kept — missing age is not a reason to hide them.
        or(
          isNull(playerCandidatesTable.age),
          lte(playerCandidatesTable.age, maxAge),
        ),
      ),
    )
    .orderBy(desc(playerCandidatesTable.eligibilityConfidence));

  // Compute pendingRescore in parallel with the signal fetch so the UI can
  // show a backlog warning without a separate request.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  if (candidates.length === 0) {
    const [[pendingRescoreRow]] = await Promise.all([
      db
        .select({ total: count() })
        .from(playerCandidatesTable)
        .where(
          and(
            eq(playerCandidatesTable.status, "pending"),
            or(
              isNull(playerCandidatesTable.lastScoredAt),
              lt(playerCandidatesTable.lastScoredAt, sevenDaysAgo),
            ),
          ),
        ),
    ]);
    res.json({ candidates: [], pendingRescore: pendingRescoreRow?.total ?? 0 });
    return;
  }

  const candidateIds = candidates.map((c) => c.id);
  const [signals, [pendingRescoreRow]] = await Promise.all([
    db
      .select({
        id: eligibilitySignalsTable.id,
        candidateId: eligibilitySignalsTable.candidateId,
        signalType: eligibilitySignalsTable.signalType,
        signalValue: eligibilitySignalsTable.signalValue,
        weight: eligibilitySignalsTable.weight,
        source: eligibilitySignalsTable.source,
        detectedAt: eligibilitySignalsTable.detectedAt,
      })
      .from(eligibilitySignalsTable)
      .where(inArray(eligibilitySignalsTable.candidateId, candidateIds)),
    db
      .select({ total: count() })
      .from(playerCandidatesTable)
      .where(
        and(
          eq(playerCandidatesTable.status, "pending"),
          or(
            isNull(playerCandidatesTable.lastScoredAt),
            lt(playerCandidatesTable.lastScoredAt, sevenDaysAgo),
          ),
        ),
      ),
  ]);

  const signalsByCandidate = new Map<number, typeof signals>();
  for (const sig of signals) {
    const list = signalsByCandidate.get(sig.candidateId) ?? [];
    list.push(sig);
    signalsByCandidate.set(sig.candidateId, list);
  }

  const enriched = candidates.map((c) => ({
    ...c,
    signals: signalsByCandidate.get(c.id) ?? [],
  }));

  res.json({ candidates: enriched, pendingRescore: pendingRescoreRow?.total ?? 0 });
});

/**
 * POST /admin/review-queue/:id/approve
 * Promotes the candidate into the players table (same logic as promote),
 * sets needs_review = false, and appends an approval note to status_notes.
 */
router.post("/admin/review-queue/:id/approve", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] ?? "", 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid candidate id" });
    return;
  }

  const [candidate] = await db
    .select()
    .from(playerCandidatesTable)
    .where(eq(playerCandidatesTable.id, id))
    .limit(1);

  if (!candidate) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }
  if (candidate.status !== "pending") {
    res.status(409).json({ error: `Candidate is already ${candidate.status}` });
    return;
  }

  const slug = slugify(candidate.name);
  const approvedNote = `[${new Date().toISOString()}] Approved via review queue`;
  const updatedNotes = candidate.statusNotes
    ? `${candidate.statusNotes}\n${approvedNote}`
    : approvedNote;

  try {
    const newPlayerId = await db.transaction(async (tx) => {
      const [newPlayer] = await tx
        .insert(playersTable)
        .values({
          name: candidate.name,
          slug,
          position: candidate.position ?? "MF",
          category: "prospect",
          clubId: candidate.clubId,
          age: candidate.age ?? 0,
          apiFootballPlayerId: candidate.apiFootballPlayerId,
          nationalTeamCaps: 0,
          nationalTeamGoals: 0,
          performanceTrend: "steady",
          trending: false,
          bio: "",
          worldCupRoster: false,
          eligibilityConfidence: candidate.eligibilityConfidence ?? undefined,
        })
        .returning({ id: playersTable.id });

      await tx
        .update(playerCandidatesTable)
        .set({ status: "promoted", needsReview: false, statusNotes: updatedNotes })
        .where(eq(playerCandidatesTable.id, id));

      return newPlayer?.id;
    });

    logger.info({ candidateId: id, playerId: newPlayerId, name: candidate.name }, "Admin: review-queue candidate approved");
    res.json({ ok: true, playerId: newPlayerId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      logger.warn({ err, candidateId: id }, "Admin: review-queue approve failed — unique constraint violation");
      res.status(409).json({ error: "A player with this name or API ID already exists in the pool" });
    } else {
      logger.error({ err, candidateId: id }, "Admin: review-queue approve failed");
      res.status(500).json({ error: "Approve failed" });
    }
  }
});

/**
 * POST /admin/review-queue/:id/reject
 * Sets status = "dismissed" and clears needs_review.
 * The candidate row is retained for history.
 */
router.post("/admin/review-queue/:id/reject", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] ?? "", 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid candidate id" });
    return;
  }

  const [updated] = await db
    .update(playerCandidatesTable)
    .set({ status: "dismissed", needsReview: false })
    .where(eq(playerCandidatesTable.id, id))
    .returning({ id: playerCandidatesTable.id });

  if (!updated) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  logger.info({ candidateId: id }, "Admin: review-queue candidate rejected");
  res.json({ ok: true });
});

/**
 * POST /admin/review-queue/:id/override-status
 * Body: { usmnt_status: string; reason: string }
 * Updates usmnt_status and appends to status_notes, sets is_manual_override = true
 * so the scoring engine skips re-scoring this record, and leaves status = "pending"
 * so it remains visible in the queue until explicitly approved or dismissed.
 */
router.post("/admin/review-queue/:id/override-status", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] ?? "", 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid candidate id" });
    return;
  }

  const { usmnt_status, reason } = req.body as { usmnt_status?: unknown; reason?: unknown };
  if (typeof usmnt_status !== "string" || !usmnt_status.trim()) {
    res.status(400).json({ error: "usmnt_status is required" });
    return;
  }
  if (typeof reason !== "string" || !reason.trim()) {
    res.status(400).json({ error: "reason is required" });
    return;
  }

  const validStatuses = ["US_ELIGIBLE_PROSPECT", "DUAL_NATIONAL", "DECLARED_OTHER", "UNKNOWN"] as const;
  type ValidStatus = typeof validStatuses[number];
  if (!validStatuses.includes(usmnt_status.trim() as ValidStatus)) {
    res.status(400).json({ error: `usmnt_status must be one of: ${validStatuses.join(", ")}` });
    return;
  }

  const [candidate] = await db
    .select({ id: playerCandidatesTable.id, statusNotes: playerCandidatesTable.statusNotes })
    .from(playerCandidatesTable)
    .where(eq(playerCandidatesTable.id, id))
    .limit(1);

  if (!candidate) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  const noteEntry = `[${new Date().toISOString()}] Override: ${usmnt_status.trim()} — ${reason.trim()}`;
  const updatedNotes = candidate.statusNotes
    ? `${candidate.statusNotes}\n${noteEntry}`
    : noteEntry;

  await db
    .update(playerCandidatesTable)
    .set({
      usmntStatus: usmnt_status.trim() as ValidStatus,
      isManualOverride: true,
      statusNotes: updatedNotes,
    })
    .where(eq(playerCandidatesTable.id, id));

  logger.info({ candidateId: id, usmntStatus: usmnt_status.trim(), reason: reason.trim() }, "Admin: review-queue status overridden");
  res.json({ ok: true });
});

/**
 * POST /admin/review-queue/bulk-approve
 * Body (optional): { minConfidence?: number }  Default: 80
 * Approves all pending candidates with eligibility_confidence >= minConfidence
 * in a single transaction. Returns { promoted: number }.
 */
router.post("/admin/review-queue/bulk-approve", async (req, res): Promise<void> => {
  const raw = (req.body as { minConfidence?: unknown })?.minConfidence;
  const minConfidence = typeof raw === "number" && raw >= 0 ? raw : 80;

  const candidates = await db
    .select()
    .from(playerCandidatesTable)
    .where(
      or(
        eq(playerCandidatesTable.status, "pending"),
        eq(playerCandidatesTable.needsReview, true),
      ),
    );

  const qualifying = candidates.filter(
    (c) =>
      c.status === "pending" &&
      !c.isManualOverride &&
      (c.eligibilityConfidence ?? 0) >= minConfidence,
  );

  if (qualifying.length === 0) {
    res.json({ promoted: 0 });
    return;
  }

  let promoted = 0;
  const errors: Array<{ id: number; name: string; error: string }> = [];

  try {
    await db.transaction(async (tx) => {
      for (const candidate of qualifying) {
        const slug = slugify(candidate.name);
        const approvedNote = `[${new Date().toISOString()}] Bulk approved via review queue (minConfidence=${minConfidence})`;
        const updatedNotes = candidate.statusNotes
          ? `${candidate.statusNotes}\n${approvedNote}`
          : approvedNote;

        try {
          await tx
            .insert(playersTable)
            .values({
              name: candidate.name,
              slug,
              position: candidate.position ?? "MF",
              category: "prospect",
              clubId: candidate.clubId,
              age: candidate.age ?? 0,
              apiFootballPlayerId: candidate.apiFootballPlayerId,
              nationalTeamCaps: 0,
              nationalTeamGoals: 0,
              performanceTrend: "steady",
              trending: false,
              bio: "",
              worldCupRoster: false,
              eligibilityConfidence: candidate.eligibilityConfidence ?? undefined,
            });

          await tx
            .update(playerCandidatesTable)
            .set({ status: "promoted", needsReview: false, statusNotes: updatedNotes })
            .where(eq(playerCandidatesTable.id, candidate.id));

          promoted++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          // Skip duplicates and continue — log the skip but don't abort the batch
          if (msg.includes("unique") || msg.includes("duplicate")) {
            logger.warn({ candidateId: candidate.id, name: candidate.name }, "Admin: bulk-approve skipped — already in player pool");
            errors.push({ id: candidate.id, name: candidate.name, error: "already exists" });
          } else {
            throw err; // unexpected — roll back the entire transaction
          }
        }
      }
    });
  } catch (err) {
    logger.error({ err }, "Admin: bulk-approve transaction failed");
    res.status(500).json({ error: "Bulk approve failed" });
    return;
  }

  const skippedDetails = errors.map(({ id, name }) => ({ id, name, reason: "slug_collision" }));
  logger.info({ promoted, skipped: errors.length, minConfidence }, "Admin: bulk-approve complete");
  res.json({ promoted, skipped: errors.length, skippedDetails });
});

/**
 * POST /admin/backfill-dob
 * For every player that has an api_football_player_id but no date_of_birth,
 * fetches their birth date from API-Football (/players?id=&season=2026) and
 * writes it to the DB. Runs in the background — returns immediately with the
 * number of players queued. Check server logs for per-player progress.
 */
router.post("/admin/backfill-dob", async (_req, res): Promise<void> => {
  if (!apiKey()) {
    res.status(503).json({ error: "API_FOOTBALL_KEY not configured" });
    return;
  }

  const players = await db
    .select({ id: playersTable.id, name: playersTable.name, apiFootballPlayerId: playersTable.apiFootballPlayerId, age: playersTable.age })
    .from(playersTable)
    .where(isNotNull(playersTable.apiFootballPlayerId) && isNull(playersTable.dateOfBirth));

  logger.info({ count: players.length }, "Admin: DOB backfill started");
  res.json({ ok: true, queued: players.length });

  // Run in background — afFetch is already rate-limited by the shared queue
  // so calls go out at the correct pace without additional throttling here.
  // Try seasons in descending order (same as the main playerStats sync) so
  // players whose most recent activity is in a prior season still get a DOB.
  const currentYear = new Date().getUTCFullYear();
  const seasons = [currentYear, currentYear - 1, currentYear - 2];

  (async () => {
    let updated = 0;
    let failed = 0;
    for (const player of players) {
      try {
        let birthDate: string | null = null;
        for (const season of seasons) {
          const [data] = await afFetch<AfPlayerRecord[]>(`/players?id=${player.apiFootballPlayerId}&season=${season}`);
          birthDate = data?.player?.birth?.date ?? null;
          if (birthDate) break; // found it — no need to check older seasons
        }
        if (!birthDate) {
          logger.debug({ playerId: player.id, name: player.name }, "DOB backfill: no birth date returned for any season");
          continue;
        }
        const liveAge = ageFromBirthDate(birthDate) ?? player.age;
        await db.update(playersTable).set({ dateOfBirth: birthDate, age: liveAge }).where(eq(playersTable.id, player.id));
        logger.info({ playerId: player.id, name: player.name, birthDate, liveAge }, "DOB backfill: updated");
        updated++;
      } catch (err) {
        logger.warn({ err, playerId: player.id, name: player.name }, "DOB backfill: fetch failed");
        failed++;
      }
    }
    logger.info({ updated, failed, total: players.length }, "Admin: DOB backfill complete");
  })().catch((err) => logger.error({ err }, "Admin: DOB backfill crashed"));
});

/**
 * POST /admin/backfill-candidate-birthplace
 * For every player_candidates row that has an api_football_player_id but no
 * birthplace, fetches birth.place from API-Football (/players?id=&season=…)
 * and writes it to the DB.  Runs in the background — returns immediately with
 * the number of candidates queued.  Check server logs for per-candidate progress.
 * After this completes, trigger /admin/trigger-eligibility-rescore so the
 * us_state_birthplace signal is evaluated against the newly-populated values.
 */
router.post("/admin/backfill-candidate-birthplace", async (_req, res): Promise<void> => {
  if (!apiKey()) {
    res.status(503).json({ error: "API_FOOTBALL_KEY not configured" });
    return;
  }

  logger.info("Admin: candidate birthplace backfill triggered");
  res.json({ ok: true });

  // Run in background — backfillCandidateBirthplaces is rate-limited via
  // the shared afFetch queue.
  backfillCandidateBirthplaces().catch((err) =>
    logger.error({ err }, "Admin: candidate birthplace backfill crashed"),
  );
});

/**
 * POST /admin/backfill-candidate-first-names
 * For every player_candidates row where first_name IS NULL, fetches the
 * player's full firstname from API-Football and writes it back.
 * Returns immediately with the count queued; runs in the background.
 * Safe to call multiple times — only processes rows that are still null.
 */
router.post("/admin/backfill-candidate-first-names", async (_req, res): Promise<void> => {
  if (!apiKey()) {
    res.status(503).json({ error: "API_FOOTBALL_KEY not configured" });
    return;
  }

  const candidates = await db
    .select({ id: playerCandidatesTable.id, apiFootballPlayerId: playerCandidatesTable.apiFootballPlayerId })
    .from(playerCandidatesTable)
    .where(
      and(
        isNull(playerCandidatesTable.firstName),
        isNotNull(playerCandidatesTable.apiFootballPlayerId),
      ),
    );

  logger.info({ count: candidates.length }, "Admin: candidate first-name backfill triggered");
  res.json({ ok: true, queued: candidates.length });

  // Run in background, rate-limited through the shared afFetch queue.
  (async () => {
    const currentYear = new Date().getUTCFullYear();
    const seasons = [currentYear, currentYear - 1];
    let updated = 0;
    let failed = 0;

    for (const candidate of candidates) {
      if (!candidate.apiFootballPlayerId) continue;
      try {
        let firstname: string | null = null;
        for (const season of seasons) {
          const results = await afFetch<AfPlayerRecord[]>(
            `/players?id=${candidate.apiFootballPlayerId}&season=${season}`,
          );
          const fn = results[0]?.player?.firstname ?? null;
          if (fn) { firstname = fn; break; }
        }
        if (firstname) {
          await db
            .update(playerCandidatesTable)
            .set({ firstName: firstname })
            .where(eq(playerCandidatesTable.id, candidate.id));
          updated++;
          logger.debug({ candidateId: candidate.id, firstname }, "First-name backfill: updated");
        } else {
          logger.debug({ candidateId: candidate.id }, "First-name backfill: no firstname returned");
        }
      } catch (err) {
        failed++;
        logger.warn({ err, candidateId: candidate.id }, "First-name backfill: fetch failed");
      }
    }

    logger.info({ updated, failed, total: candidates.length }, "Admin: candidate first-name backfill complete");
  })().catch((err) => logger.error({ err }, "Admin: candidate first-name backfill crashed"));
});

/**
 * POST /admin/trigger-sync
 * Body (optional): { playerIds?: number[] }
 * Triggers syncPlayerStatsAndInjuries scoped to the given player IDs (or the
 * full pool if playerIds is omitted). Returns immediately; sync runs in the
 * background. Use playerIds to sync only newly-added players without burning
 * API quota on the rest of the pool.
 */
router.post("/admin/trigger-sync", async (req, res): Promise<void> => {
  if (!apiKey()) {
    res.status(503).json({ error: "API_FOOTBALL_KEY not configured" });
    return;
  }
  const playerIds: number[] | undefined = Array.isArray(req.body?.playerIds)
    ? (req.body.playerIds as unknown[]).filter((v): v is number => typeof v === "number")
    : undefined;
  const scope = playerIds ? `${playerIds.length} players` : "full pool";
  logger.info({ scope, playerIds }, "Admin: trigger-sync started");
  res.json({ ok: true, scope });
  syncPlayerStatsAndInjuries(12, playerIds).catch((err) =>
    logger.error({ err }, "Admin trigger-sync failed"),
  );
});

/**
 * POST /admin/trigger-club-sync
 * Triggers syncPlayerClubs for all players, bypassing the 23-hour cooldown.
 * Use when a player's club assignment needs to be refreshed immediately —
 * e.g. after a transfer window move that the scheduled sync hasn't caught yet.
 * Returns immediately; sync runs in the background.
 */
router.post("/admin/trigger-club-sync", async (_req, res): Promise<void> => {
  if (!apiKey()) {
    res.status(503).json({ error: "API_FOOTBALL_KEY not configured" });
    return;
  }
  logger.info("Admin: trigger-club-sync started");
  res.json({ ok: true });
  syncPlayerClubs().catch((err) =>
    logger.error({ err }, "Admin trigger-club-sync failed"),
  );
});

/**
 * POST /admin/trigger-fixtures-sync
 * Body (optional): { playerIds?: number[] }
 * Triggers syncApiFootballFixtures scoped to the given player IDs (or all
 * tracked players if playerIds is omitted). Returns immediately; sync runs in
 * the background. Use playerIds to seed fixtures for a specific subset of
 * players without re-sweeping everyone and burning API-Football quota.
 */
router.post("/admin/trigger-fixtures-sync", async (req, res): Promise<void> => {
  if (!apiKey()) {
    res.status(503).json({ error: "API_FOOTBALL_KEY not configured" });
    return;
  }
  const playerIds: number[] | undefined = Array.isArray(req.body?.playerIds)
    ? (req.body.playerIds as unknown[]).filter((v): v is number => typeof v === "number")
    : undefined;
  const scope = playerIds ? `${playerIds.length} players` : "all players";
  logger.info({ scope, playerIds }, "Admin: trigger-fixtures-sync started");
  res.json({ ok: true, scope });
  syncApiFootballFixtures(playerIds).catch((err) =>
    logger.error({ err }, "Admin trigger-fixtures-sync failed"),
  );
});

/**
 * POST /admin/trigger-nt-sync
 * Triggers syncNationalTeamFixtures — updates scores and statuses for seeded
 * national-team fixture rows (is_national_team = true, USA as home or away).
 * Returns immediately; sync runs in the background.
 */
router.post("/admin/trigger-nt-sync", async (_req, res): Promise<void> => {
  if (!apiKey()) {
    res.status(503).json({ error: "API_FOOTBALL_KEY not configured" });
    return;
  }
  logger.info("Admin: trigger-nt-sync started");
  res.json({ ok: true });
  syncNationalTeamFixtures().catch((err) =>
    logger.error({ err }, "Admin trigger-nt-sync failed"),
  );
});

/**
 * POST /admin/trigger-youth-nt-sync
 * Triggers syncYouthNtFixtures — discovers and upserts US U20 / US U17
 * fixtures from API-Football. Returns immediately; sync runs in the background.
 */
router.post("/admin/trigger-youth-nt-sync", async (_req, res): Promise<void> => {
  if (!apiKey()) {
    res.status(503).json({ error: "API_FOOTBALL_KEY not configured" });
    return;
  }
  logger.info("Admin: trigger-youth-nt-sync started");
  res.json({ ok: true });
  syncYouthNtFixtures().catch((err) =>
    logger.error({ err }, "Admin trigger-youth-nt-sync failed"),
  );
});

/**
 * POST /admin/sync-player-stats
 * Body: { playerIds: number[] }
 *
 * Immediately re-runs the post-match stats pipeline for the given players,
 * bypassing the daily cooldown guard.  Use when a player's match log is stuck
 * in "stats pending" because the scheduled sync ran before API-Football had
 * finished populating that fixture's player statistics.
 */
router.post("/admin/sync-player-stats", async (req, res): Promise<void> => {
  if (!process.env["API_FOOTBALL_KEY"]) {
    res.status(503).json({ error: "API_FOOTBALL_KEY not configured" });
    return;
  }
  const { playerIds } = req.body as { playerIds?: unknown };
  if (
    !Array.isArray(playerIds) ||
    playerIds.length === 0 ||
    !playerIds.every((id) => typeof id === "number")
  ) {
    res.status(400).json({ error: "Body must be { playerIds: number[] } with at least one id" });
    return;
  }
  logger.info({ playerCount: playerIds.length, playerIds }, "Admin: sync-player-stats triggered");
  res.json({ ok: true, playerCount: playerIds.length });
  syncStatsForFinishedFixture(playerIds as number[]).catch((err) =>
    logger.error({ err }, "Admin sync-player-stats failed"),
  );
});

/**
 * POST /admin/trigger-eligibility-rescore
 * Re-runs evaluateEligibility for all non-dismissed candidates and updates
 * their eligibility_confidence, usmnt_status, data_sources, and signal rows.
 * Never touches any row in the `players` table.
 * Returns immediately; rescore runs in the background.
 *
 * Body (optional): { maxCandidates?: number }
 *   Overrides the per-run candidate cap (default: RESCORE_MAX_CANDIDATES env
 *   var or 50). Pass a higher value only when you need a full rescore and can
 *   afford the extra API-Football quota spend.
 */
router.post("/admin/trigger-eligibility-rescore", async (req, res): Promise<void> => {
  if (!process.env["API_FOOTBALL_KEY"]) {
    res.status(503).json({ error: "API_FOOTBALL_KEY not configured" });
    return;
  }
  const rawMax = (req.body as { maxCandidates?: unknown })?.maxCandidates;
  const maxCandidates =
    typeof rawMax === "number" && Number.isInteger(rawMax) && rawMax > 0
      ? rawMax
      : undefined;
  logger.info({ maxCandidates }, "Admin: eligibility rescore triggered");
  res.json({ ok: true, maxCandidates: maxCandidates ?? null });
  rescoreAllCandidates({ maxCandidates }).catch((err) =>
    logger.error({ err }, "Admin eligibility rescore failed"),
  );
});

/**
 * POST /admin/trigger-commitment-check
 * Manually triggers the commitment sweep for all tracked players and
 * non-dismissed candidates. The sweep inspects API-Football competition history
 * for non-US national team appearances, updates usmnt_status on high-confidence
 * detections (CAP_TIED_OTHER), and flags ambiguous cases via needs_review = true.
 * Returns immediately; sweep runs in the background.
 */
router.post("/admin/trigger-commitment-check", async (_req, res): Promise<void> => {
  if (!apiKey()) {
    res.status(503).json({ error: "API_FOOTBALL_KEY not configured" });
    return;
  }
  logger.info("Admin: commitment check triggered");
  res.json({ ok: true });
  runCommitmentSweep().catch((err) =>
    logger.error({ err }, "Admin commitment check failed"),
  );
});

/**
 * GET /admin/config
 * Returns the resolved eligibility signal registry — each signal's default
 * weight, active weight, max contribution cap, and which env-var key is
 * overriding it (if any). Read-only; weights can only be changed via env vars.
 */
router.get("/admin/config", (_req, res): void => {
  const resolved = getResolvedWeights();
  const signals = SIGNAL_REGISTRY.map((def) => {
    const envKey = `ELIGIBILITY_WEIGHT_${def.signalType.toUpperCase()}`;
    const activeWeight = resolved[def.signalType] ?? def.defaultWeight;
    const isOverridden = process.env[envKey] !== undefined;
    return {
      signalType: def.signalType,
      label: def.label,
      defaultWeight: def.defaultWeight,
      maxContribution: def.maxContribution,
      activeWeight,
      overriddenBy: isOverridden ? envKey : null,
    };
  });
  res.json({ signals });
});

/**
 * GET /admin/players
 * Returns all tracked players with their current club (and override, if set).
 * Lightweight — just id, name, clubId, clubName, clubOverrideId, clubOverrideName.
 */
router.get("/admin/players", async (_req, res): Promise<void> => {
  const overrideClubs = clubsTable;
  const rows = await db
    .select({
      id: playersTable.id,
      name: playersTable.name,
      clubId: playersTable.clubId,
      clubName: clubsTable.name,
      clubOverrideId: playersTable.clubOverrideId,
      clubOverrideSetAt: playersTable.clubOverrideSetAt,
    })
    .from(playersTable)
    .leftJoin(clubsTable, eq(playersTable.clubId, clubsTable.id))
    .orderBy(asc(playersTable.name));

  // Enrich rows that have an override with the override club name
  const overrideIds = rows
    .map((r) => r.clubOverrideId)
    .filter((id): id is number => id != null);

  const overrideClubRows =
    overrideIds.length > 0
      ? await db
          .select({ id: overrideClubs.id, name: overrideClubs.name })
          .from(overrideClubs)
          .where(inArray(overrideClubs.id, overrideIds))
      : [];
  const overrideClubById = new Map(overrideClubRows.map((c) => [c.id, c.name]));

  const enriched = rows.map((r) => ({
    ...r,
    clubOverrideName: r.clubOverrideId != null ? (overrideClubById.get(r.clubOverrideId) ?? null) : null,
  }));

  res.json({ players: enriched });
});

/**
 * GET /admin/clubs
 * Returns all clubs (id + name) for use in dropdowns.
 */
router.get("/admin/clubs", async (_req, res): Promise<void> => {
  const rows = await db
    .select({ id: clubsTable.id, name: clubsTable.name })
    .from(clubsTable)
    .orderBy(asc(clubsTable.name));
  res.json({ clubs: rows });
});

/**
 * PATCH /admin/players/:id/club
 * Body: { clubId: number } to set an override, or { clubId: null } to clear it.
 * Sets (or clears) the manual club override for a player.  When set, the
 * transfer-sync and fixture-sync both skip API resolution and use this club
 * directly.  Clearing it (clubId: null) restores automatic API-driven sync.
 */
router.patch("/admin/players/:id/club", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] ?? "", 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid player id" });
    return;
  }

  const body = req.body as { clubId?: unknown };
  const rawClubId = body.clubId;

  // null clears the override; a positive integer sets it.
  if (rawClubId !== null && (typeof rawClubId !== "number" || !Number.isInteger(rawClubId) || rawClubId <= 0)) {
    res.status(400).json({ error: "clubId must be a positive integer or null" });
    return;
  }

  const [player] = await db
    .select({ id: playersTable.id, name: playersTable.name })
    .from(playersTable)
    .where(eq(playersTable.id, id))
    .limit(1);

  if (!player) {
    res.status(404).json({ error: "Player not found" });
    return;
  }

  if (rawClubId === null) {
    // Clear the override — restore automatic sync.
    await db
      .update(playersTable)
      .set({ clubOverrideId: null, clubOverrideSetAt: null })
      .where(eq(playersTable.id, id));
    logger.info({ playerId: id, playerName: player.name }, "Admin: club override cleared");
    res.json({ ok: true, cleared: true });
    return;
  }

  // Validate the target club exists.
  const [club] = await db
    .select({ id: clubsTable.id, name: clubsTable.name })
    .from(clubsTable)
    .where(eq(clubsTable.id, rawClubId as number))
    .limit(1);

  if (!club) {
    res.status(404).json({ error: "Club not found" });
    return;
  }

  await db
    .update(playersTable)
    .set({ clubOverrideId: club.id, clubOverrideSetAt: new Date(), clubId: club.id })
    .where(eq(playersTable.id, id));

  logger.info(
    { playerId: id, playerName: player.name, clubId: club.id, clubName: club.name },
    "Admin: club override set",
  );
  res.json({ ok: true, clubId: club.id, clubName: club.name });
});

/**
 * POST /admin/cleanup-anon-users
 * Deletes orphaned `anon_users` rows — those with no `user_follows` children
 * that were created more than 90 days ago. Associated `recovery_tokens` rows
 * are removed first within the same transaction.
 *
 * The operation is synchronous (runs inline, not in background) because it is
 * expected to be fast — a bounded DELETE on an indexed FK column.
 */
router.post("/admin/cleanup-anon-users", async (_req, res): Promise<void> => {
  try {
    const deleted = await cleanupOrphanedAnonUsers();
    res.json({ ok: true, deleted });
  } catch (err) {
    logger.error({ err }, "Admin cleanup-anon-users failed");
    res.status(500).json({ error: "Cleanup failed" });
  }
});

export default router;
