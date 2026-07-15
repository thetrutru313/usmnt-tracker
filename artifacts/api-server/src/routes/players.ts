import { Router, type IRouter } from "express";
import {
  ListPlayersQueryParams,
  ListPlayersResponse,
  GetPlayerParams,
  GetPlayerQueryParams,
  GetPlayerResponse,
} from "@workspace/api-zod";
import {
  listPlayers,
  getPlayerById,
  getStatsForPlayer,
  getClubSeasonStats,
  getAvailableClubSeasons,
  getNationalTeamCycleStats,
  getAvailableNationalTeamCycles,
  getMatchLogForPlayer,
  getInjuriesForPlayer,
  getTransfersForPlayer,
  attachFeaturedPlayers,
  attachPlayersToNews,
  fixturesTable,
  fixturePlayersTable,
  newsArticlesTable,
  newsArticlePlayersTable,
  and,
  desc,
  eq,
  gte,
  inArray,
} from "../lib/queries";
import { db } from "@workspace/db";

const router: IRouter = Router();

router.get("/players", async (req, res): Promise<void> => {
  const parsed = ListPlayersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const rows = await listPlayers(parsed.data);
  res.json(ListPlayersResponse.parse(rows));
});

router.get("/players/:id", async (req, res): Promise<void> => {
  const parsedParams = GetPlayerParams.safeParse(req.params);
  const parsedQuery = GetPlayerQueryParams.safeParse(req.query);
  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.message });
    return;
  }
  if (!parsedQuery.success) {
    res.status(400).json({ error: parsedQuery.error.message });
    return;
  }
  const { id } = parsedParams.data;
  const { season, cycle } = parsedQuery.data;

  const player = await getPlayerById(id);
  if (!player) {
    res.status(404).json({ error: "Player not found" });
    return;
  }

  const [seasonStats, last5Stats, previousSeasonStats, clubSeasonStats, availableClubSeasons, nationalTeamStats, availableCycles, matchLog, injuries, transfers] = await Promise.all([
    getStatsForPlayer(id, "season"),
    getStatsForPlayer(id, "last5"),
    getStatsForPlayer(id, "previous_season"),
    getClubSeasonStats(id, season),
    getAvailableClubSeasons(id),
    getNationalTeamCycleStats(id, cycle),
    getAvailableNationalTeamCycles(id),
    getMatchLogForPlayer(id, 10),
    getInjuriesForPlayer(id),
    getTransfersForPlayer(id),
  ]);

  const upcomingFixtureIds = await db
    .select({ fixtureId: fixturePlayersTable.fixtureId })
    .from(fixturePlayersTable)
    .where(eq(fixturePlayersTable.playerId, id));

  let upcomingFixtures: Awaited<ReturnType<typeof attachFeaturedPlayers>> = [];
  if (upcomingFixtureIds.length > 0) {
    const rows = await db
      .select()
      .from(fixturesTable)
      .where(
        and(
          inArray(fixturesTable.id, upcomingFixtureIds.map((r) => r.fixtureId)),
          gte(fixturesTable.kickoff, new Date(Date.now() - 1000 * 60 * 60 * 24)),
        ),
      )
      .orderBy(fixturesTable.kickoff);
    upcomingFixtures = await attachFeaturedPlayers(rows);
  }

  const articleIdRows = await db
    .select({ articleId: newsArticlePlayersTable.articleId })
    .from(newsArticlePlayersTable)
    .where(eq(newsArticlePlayersTable.playerId, id));

  let recentNews: Awaited<ReturnType<typeof attachPlayersToNews>> = [];
  if (articleIdRows.length > 0) {
    const rows = await db
      .select()
      .from(newsArticlesTable)
      .where(inArray(newsArticlesTable.id, articleIdRows.map((r) => r.articleId)))
      .orderBy(desc(newsArticlesTable.publishedAt))
      .limit(10);
    recentNews = await attachPlayersToNews(rows);
  }

  // Used only when we have no synced stats row for this player/period at
  // all (e.g. never resolved to an API-Football id yet). Percentage/rating
  // fields are null rather than a fabricated 0 — the UI shows "—" for these.
  const emptyStats = {
    season: "N/A",
    minutes: 0,
    starts: 0,
    goals: 0,
    assists: 0,
    shots: 0,
    keyPasses: 0,
    passCompletionPct: null,
    tackles: 0,
    interceptions: 0,
    duelsWonPct: null,
    cleanSheets: null,
    savePct: null,
    avgRating: null,
  };

  const profile = {
    ...player,
    seasonStats: seasonStats ?? emptyStats,
    last5Stats: last5Stats ?? emptyStats,
    previousSeasonStats: previousSeasonStats ?? emptyStats,
    clubSeasonStats: clubSeasonStats ?? emptyStats,
    availableClubSeasons,
    nationalTeamStats: nationalTeamStats ?? { ...emptyStats, season: availableCycles[0] ?? "2026 World Cup" },
    availableCycles,
    matchLog,
    injuries,
    transfers,
    upcomingFixtures,
    recentNews,
  };

  res.json(GetPlayerResponse.parse(profile));
});

export default router;
