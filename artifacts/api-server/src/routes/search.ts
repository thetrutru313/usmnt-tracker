import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { SearchQueryParams, SearchResponse } from "@workspace/api-zod";
import { db, clubsTable, playersTable } from "@workspace/db";
import { eq, ilike, sql } from "drizzle-orm";
import { playerSummaryQuery, resolveAge } from "../lib/queries";

const router: IRouter = Router();

// Tighter rate limit specifically for the search endpoint: each request
// triggers two sequential-scan ILIKE queries, so we keep this conservative.
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many search requests, please slow down." },
});

const MAX_QUERY_LENGTH = 100;

router.get("/search", searchLimiter, async (req, res): Promise<void> => {
  const parsed = SearchQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { q } = parsed.data;

  if (q.length > MAX_QUERY_LENGTH) {
    res.status(400).json({ error: `Query must be ${MAX_QUERY_LENGTH} characters or fewer.` });
    return;
  }

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
