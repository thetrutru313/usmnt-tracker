import { Router, type IRouter } from "express";
import { SearchQueryParams, SearchResponse } from "@workspace/api-zod";
import { db, clubsTable, playersTable } from "@workspace/db";
import { eq, ilike, sql } from "drizzle-orm";
import { playerSummaryQuery, resolveAge } from "../lib/queries";

const router: IRouter = Router();

router.get("/search", async (req, res): Promise<void> => {
  const parsed = SearchQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { q } = parsed.data;

  const [players, clubRows] = await Promise.all([
    playerSummaryQuery().where(ilike(playersTable.name, `%${q}%`)).limit(10),
    db
      .select({
        name: clubsTable.name,
        league: clubsTable.league,
        country: clubsTable.country,
        logoUrl: clubsTable.logoUrl,
        playerCount: sql<number>`count(${playersTable.id})`.mapWith(Number),
      })
      .from(clubsTable)
      .leftJoin(playersTable, eq(playersTable.clubId, clubsTable.id))
      .where(ilike(clubsTable.name, `%${q}%`))
      .groupBy(clubsTable.id)
      .limit(10),
  ]);

  const resolvedPlayers = players.map(({ dateOfBirth, age: storedAge, ...rest }) => ({
    ...rest,
    age: resolveAge(dateOfBirth, storedAge),
  }));
  res.json(SearchResponse.parse({ players: resolvedPlayers, clubs: clubRows }));
});

export default router;
