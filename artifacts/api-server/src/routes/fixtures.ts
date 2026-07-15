import { Router, type IRouter } from "express";
import { ListFixturesQueryParams, ListFixturesResponse } from "@workspace/api-zod";
import { db, fixturesTable, fixturePlayersTable } from "@workspace/db";
import { and, eq, gte, inArray, lt, notIlike, or } from "drizzle-orm";
import { attachFeaturedPlayers } from "../lib/queries";

const router: IRouter = Router();

router.get("/fixtures", async (req, res): Promise<void> => {
  const parsed = ListFixturesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { scope, playerId } = parsed.data;

  // Exclude club friendlies; keep national-team fixtures regardless of competition name.
  const conditions = [or(eq(fixturesTable.isNationalTeam, true), notIlike(fixturesTable.competition, "%Friendlies%"))];

  if (scope === "today") {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    conditions.push(gte(fixturesTable.kickoff, startOfDay), lt(fixturesTable.kickoff, endOfDay));
  } else if (scope === "upcoming") {
    conditions.push(gte(fixturesTable.kickoff, new Date()));
  }

  if (playerId) {
    const rows = await db
      .select({ fixtureId: fixturePlayersTable.fixtureId })
      .from(fixturePlayersTable)
      .where(eq(fixturePlayersTable.playerId, playerId));
    const fixtureIds = rows.map((r) => r.fixtureId);
    if (fixtureIds.length === 0) {
      res.json(ListFixturesResponse.parse([]));
      return;
    }
    conditions.push(inArray(fixturesTable.id, fixtureIds));
  }

  const query = db.select().from(fixturesTable).orderBy(fixturesTable.kickoff);
  const rows = conditions.length ? await query.where(and(...conditions)) : await query;

  const withPlayers = await attachFeaturedPlayers(rows);
  res.json(ListFixturesResponse.parse(withPlayers));
});

export default router;
