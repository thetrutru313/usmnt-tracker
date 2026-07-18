import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { SearchQueryParams, SearchResponse } from "@workspace/api-zod";
import { db, clubsTable, playersTable } from "@workspace/db";
import { eq, ilike, sql } from "drizzle-orm";
import { playerSummaryQuery, computeFormBadgesForPlayerIds, computePoolTier, resolveAge } from "../lib/queries";

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

  const [playersRaw, clubRows] = await Promise.all([
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

  // Overlay live form badges — playerSummaryColumns no longer selects the stale
  // players.performanceTrend column; badges are computed from player_stats here.
  const badgeMap = await computeFormBadgesForPlayerIds(playersRaw.map((p) => p.id));

  const players = playersRaw.map(({ worldCupRoster, dateOfBirth, age: storedAge, ...rest }) => {
    const age = resolveAge(dateOfBirth, storedAge);
    return {
      ...rest,
      age,
      poolTier: computePoolTier({ worldCupRoster, nationalTeamCaps: rest.nationalTeamCaps, age }),
      ...(badgeMap.get(rest.id) ?? { performanceTrend: "steady", trending: false }),
    };
  });

  res.json(SearchResponse.parse({ players, clubs: clubRows }));
});

export default router;
