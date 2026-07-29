import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, playerCandidatesTable, playersTable, clubsTable, eligibilitySignalsTable } from "@workspace/db";
import { eq, desc, isNull, isNotNull, or, gte, inArray, and } from "drizzle-orm";
import { rescoreAllCandidates } from "../lib/playerDiscovery";
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
  player: { birth: { date: string | null; place: string | null } };
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

/**
 * Simple token gate for all /admin/* routes.
 * Callers must supply `Authorization: Bearer <ADMIN_PASSWORD>`.
 * If ADMIN_PASSWORD is not configured the routes are disabled entirely.
 *
 * NOTE: must use ADMIN_PASSWORD (not SESSION_SECRET) — the verify endpoint in
 * transparency.ts checks ADMIN_PASSWORD, so both must use the same secret or
 * login succeeds but every subsequent admin API call returns 401.
 */
function requireAdminToken(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env["ADMIN_PASSWORD"];
  if (!secret) {
    res.status(503).json({ error: "Admin endpoints are not configured on this server" });
    return;
  }
  const auth = req.headers["authorization"] ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  // Use constant-time comparison to prevent timing side-channel attacks where
  // an attacker could infer the correct token prefix by measuring response times.
  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(secret);
  const tokenMatch =
    tokenBuf.length === secretBuf.length && timingSafeEqual(tokenBuf, secretBuf);
  if (!tokenMatch) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// Apply the token gate to every /admin/* route in this router.
router.use("/admin", requireAdminToken);

/**
 * GET /admin/player-candidates
 * Returns all pending candidates, most-played first.
 */
router.get("/admin/player-candidates", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: playerCandidatesTable.id,
      name: playerCandidatesTable.name,
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
 * GET /admin/review-queue
 * Returns all player_candidates rows where status = "pending" or
 * needs_review = true, ordered by eligibility_confidence descending.
 * Each record includes the candidate's core fields, club name, and the
 * full list of fired eligibility_signals.
 */
router.get("/admin/review-queue", async (_req, res): Promise<void> => {
  const candidates = await db
    .select({
      id: playerCandidatesTable.id,
      name: playerCandidatesTable.name,
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
    })
    .from(playerCandidatesTable)
    .leftJoin(clubsTable, eq(playerCandidatesTable.clubId, clubsTable.id))
    .where(
      or(
        eq(playerCandidatesTable.status, "pending"),
        eq(playerCandidatesTable.needsReview, true),
      ),
    )
    .orderBy(desc(playerCandidatesTable.eligibilityConfidence));

  if (candidates.length === 0) {
    res.json({ candidates: [] });
    return;
  }

  const candidateIds = candidates.map((c) => c.id);
  const signals = await db
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
    .where(inArray(eligibilitySignalsTable.candidateId, candidateIds));

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

  res.json({ candidates: enriched });
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

  logger.info({ promoted, skipped: errors.length, minConfidence }, "Admin: bulk-approve complete");
  res.json({ promoted, skipped: errors.length });
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

  logger.info({ count: candidates.length }, "Admin: candidate birthplace backfill started");
  res.json({ ok: true, queued: candidates.length });

  // Run in background — afFetch is already rate-limited by the shared queue.
  // Try seasons in descending order so players whose most recent activity is
  // in a prior season still get a birthplace returned.
  const currentYear = new Date().getUTCFullYear();
  const seasons = [currentYear, currentYear - 1, currentYear - 2];

  (async () => {
    let updated = 0;
    let failed = 0;
    let notFound = 0;
    for (const candidate of candidates) {
      // Defensive guard: skip any row that somehow arrived without an API ID
      // to avoid sending a malformed request (id=null) to API-Football.
      if (!candidate.apiFootballPlayerId) {
        logger.warn(
          { candidateId: candidate.id, name: candidate.name },
          "Candidate birthplace backfill: skipping — no apiFootballPlayerId",
        );
        notFound++;
        continue;
      }
      try {
        let birthplace: string | null = null;
        for (const season of seasons) {
          const [data] = await afFetch<AfPlayerRecord[]>(
            `/players?id=${candidate.apiFootballPlayerId}&season=${season}`,
          );
          birthplace = data?.player?.birth?.place ?? null;
          if (birthplace) break; // found — no need to check older seasons
        }
        if (!birthplace) {
          logger.debug(
            { candidateId: candidate.id, name: candidate.name },
            "Candidate birthplace backfill: no birthplace returned for any season",
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
          "Candidate birthplace backfill: updated",
        );
        updated++;
      } catch (err) {
        logger.warn(
          { err, candidateId: candidate.id, name: candidate.name },
          "Candidate birthplace backfill: fetch failed",
        );
        failed++;
      }
    }
    logger.info(
      { updated, notFound, failed, total: candidates.length },
      "Admin: candidate birthplace backfill complete",
    );
  })().catch((err) => logger.error({ err }, "Admin: candidate birthplace backfill crashed"));
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
