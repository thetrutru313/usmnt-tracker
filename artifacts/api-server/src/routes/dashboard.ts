import { Router, type IRouter } from "express";
import { GetDashboardResponse } from "@workspace/api-zod";
import { db, scheduleEventsTable, playersTable, clubsTable } from "@workspace/db";
import { and, asc, desc, eq, gte, isNotNull, lt, notIlike, or } from "drizzle-orm";
import {
  fixturesTable,
  newsArticlesTable,
  injuriesTable,
  playerStatsTable,
  attachFeaturedPlayers,
  attachPlayersToNews,
  injuriesWithPlayerQuery,
  transfersWithPlayerQuery,
  transfersTable,
  playerSummaryQuery,
  playerSummaryColumns,
  computePoolTier,
  resolveAge,
} from "../lib/queries";

const router: IRouter = Router();

router.get("/dashboard", async (_req, res): Promise<void> => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);
  const todayStr = new Date().toISOString().slice(0, 10);

  const [
    todaysGamesRaw,
    upcomingGamesRaw,
    latestNewsRaw,
    injuries,
    transfers,
    topPerformers,
    trending,
    recentlyReturned,
    nextScheduleEventRows,
  ] = await Promise.all([
    db
      .select()
      .from(fixturesTable)
      .where(and(
        gte(fixturesTable.kickoff, startOfDay),
        lt(fixturesTable.kickoff, endOfDay),
        or(eq(fixturesTable.isNationalTeam, true), notIlike(fixturesTable.competition, "%Friendlies%")),
      ))
      .orderBy(asc(fixturesTable.kickoff)),
    db
      .select()
      .from(fixturesTable)
      .where(and(
        gte(fixturesTable.kickoff, endOfDay),
        or(eq(fixturesTable.isNationalTeam, true), notIlike(fixturesTable.competition, "%Friendlies%")),
      ))
      .orderBy(asc(fixturesTable.kickoff))
      .limit(8),
    db.select().from(newsArticlesTable).orderBy(desc(newsArticlesTable.publishedAt)).limit(8),
    injuriesWithPlayerQuery().where(eq(injuriesTable.status, "active")).orderBy(desc(injuriesTable.startDate)).limit(6),
    transfersWithPlayerQuery().orderBy(desc(transfersTable.announcedAt)).limit(6),
    db
      .select(playerSummaryColumns)
      .from(playerStatsTable)
      .innerJoin(playersTable, eq(playerStatsTable.playerId, playersTable.id))
      .innerJoin(clubsTable, eq(playersTable.clubId, clubsTable.id))
      .where(and(eq(playerStatsTable.periodType, "last5"), isNotNull(playerStatsTable.avgRating)))
      .orderBy(desc(playerStatsTable.avgRating))
      .limit(5),
    playerSummaryQuery().where(eq(playersTable.trending, true)).limit(6),
    injuriesWithPlayerQuery().where(eq(injuriesTable.status, "returned")).orderBy(desc(injuriesTable.startDate)).limit(4),
    db
      .select()
      .from(scheduleEventsTable)
      .where(gte(scheduleEventsTable.startDate, todayStr))
      .orderBy(asc(scheduleEventsTable.sortOrder), asc(scheduleEventsTable.startDate))
      .limit(1),
  ]);

  const [todaysGames, upcomingGames] = await Promise.all([
    attachFeaturedPlayers(todaysGamesRaw),
    attachFeaturedPlayers(upcomingGamesRaw),
  ]);
  const latestNews = await attachPlayersToNews(latestNewsRaw);

  const withPoolTier = <T extends { worldCupRoster: boolean; nationalTeamCaps: number; age: number; dateOfBirth?: string | null }>(rows: T[]) =>
    rows.map(({ worldCupRoster, dateOfBirth, age: storedAge, ...row }) => {
      const age = resolveAge(dateOfBirth, storedAge);
      return { ...row, age, poolTier: computePoolTier({ worldCupRoster, nationalTeamCaps: row.nationalTeamCaps, age }) };
    });

  const payload = {
    todaysGames,
    upcomingGames,
    latestNews,
    injuries,
    transfers,
    topPerformers: withPoolTier(topPerformers),
    trending: withPoolTier(trending),
    recentlyReturned,
    nextScheduleEvent: nextScheduleEventRows[0],
  };

  res.json(GetDashboardResponse.parse(payload));
});

export default router;
