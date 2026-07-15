import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, playerCandidatesTable, playersTable, clubsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger";

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
 * Callers must supply `Authorization: Bearer <SESSION_SECRET>`.
 * If SESSION_SECRET is not configured the routes are disabled entirely.
 */
function requireAdminToken(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) {
    res.status(503).json({ error: "Admin endpoints are not configured on this server" });
    return;
  }
  const auth = req.headers["authorization"] ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== secret) {
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
    // Most likely a slug or API ID conflict
    if (msg.includes("unique") || msg.includes("duplicate")) {
      res.status(409).json({ error: "A player with this name or API ID already exists in the pool", detail: msg });
    } else {
      logger.error({ err, candidateId: id }, "Admin: promote failed");
      res.status(500).json({ error: "Promote failed", detail: msg });
    }
  }
});

export default router;
