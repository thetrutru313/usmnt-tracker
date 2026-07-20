import { Router, type IRouter } from "express";
import { GetDashboardResponse } from "@workspace/api-zod";
import { db, scheduleEventsTable, playersTable, clubsTable } from "@workspace/db";
import { and, asc, avg, desc, eq, gte, inArray, isNotNull, lt, notIlike, notInArray, or } from "drizzle-orm";
import {
  fixturesTable,
  matchLogsTable,
  newsArticlesTable,
  injuriesTable,
  playerStatsTable,
  attachFeaturedPlayers,
  attachPlayersToNews,
  injuriesWithPlayerQuery,
  transfersWithPlayerQuery,
  transfersTable,
  playerSummaryColumns,
  computeFormBadgesForPlayerIds,
  withInjuryBadges,
  withTransferBadges,
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
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

  const [
    todaysGamesRaw,
    upcomingGamesRaw,
    latestNewsRaw,
    injuriesRaw,
    transfersRaw,
    recentRatings,
    trendingCandidatesRaw,
    recentlyReturnedRaw,
    nextScheduleEventRows,
  ] = await Promise.all([
    db
      .select()
      .from(fixturesTable)
      .where(and(
        gte(fixturesTable.kickoff, startOfDay),
        lt(fixturesTable.kickoff, endOfDay),
        notInArray(fixturesTable.status, ["finished", "cancelled", "postponed"]),
        or(eq(fixturesTable.isNationalTeam, true), notIlike(fixturesTable.competition, "%Friendlies%")),
      ))
      .orderBy(asc(fixturesTable.kickoff)),
    db
      .select()
      .from(fixturesTable)
      .where(and(
        gte(fixturesTable.kickoff, endOfDay),
        notInArray(fixturesTable.status, ["finished", "cancelled", "postponed"]),
        or(eq(fixturesTable.isNationalTeam, true), notIlike(fixturesTable.competition, "%Friendlies%")),
      ))
      .orderBy(asc(fixturesTable.kickoff))
      .limit(8),
    db.select().from(newsArticlesTable).orderBy(desc(newsArticlesTable.publishedAt)).limit(8),
    injuriesWithPlayerQuery().where(eq(injuriesTable.status, "active")).orderBy(desc(injuriesTable.startDate)).limit(6),
    transfersWithPlayerQuery().orderBy(desc(transfersTable.announcedAt)).limit(6),
    // Rank by average match rating over the past 7 days — more time-sensitive
    // than the pre-computed last5 average, which can keep a player at the top
    // for weeks after their hot streak ended.
    db
      .select({
        playerId: matchLogsTable.playerId,
        avgRating7d: avg(matchLogsTable.rating),
      })
      .from(matchLogsTable)
      .where(and(
        gte(matchLogsTable.date, sevenDaysAgoStr),
        isNotNull(matchLogsTable.rating),
      ))
      .groupBy(matchLogsTable.playerId)
      .orderBy(desc(avg(matchLogsTable.rating)))
      .limit(5),
    // Over-fetch for "trending" — badge computation below filters to on_fire/rising only.
    db
      .select(playerSummaryColumns)
      .from(playerStatsTable)
      .innerJoin(playersTable, eq(playerStatsTable.playerId, playersTable.id))
      .innerJoin(clubsTable, eq(playersTable.clubId, clubsTable.id))
      .where(and(eq(playerStatsTable.periodType, "last5"), isNotNull(playerStatsTable.avgRating)))
      .orderBy(desc(playerStatsTable.avgRating))
      .limit(50),
    injuriesWithPlayerQuery().where(eq(injuriesTable.status, "returned")).orderBy(desc(injuriesTable.startDate)).limit(4),
    db
      .select()
      .from(scheduleEventsTable)
      .where(gte(scheduleEventsTable.startDate, todayStr))
      .orderBy(asc(scheduleEventsTable.sortOrder), asc(scheduleEventsTable.startDate))
      .limit(1),
  ]);

  // Resolve player profiles for the 7-day top performers in ranked order.
  const topPlayerIds = recentRatings.map((r) => r.playerId);
  const topProfiles = topPlayerIds.length > 0
    ? await db
        .select(playerSummaryColumns)
        .from(playerStatsTable)
        .innerJoin(playersTable, eq(playerStatsTable.playerId, playersTable.id))
        .innerJoin(clubsTable, eq(playersTable.clubId, clubsTable.id))
        .where(and(
          eq(playerStatsTable.periodType, "last5"),
          inArray(playerStatsTable.playerId, topPlayerIds),
        ))
    : [];
  const profileMap = new Map(topProfiles.map((p) => [p.id, p]));
  const topPerformersRaw = topPlayerIds
    .map((id) => profileMap.get(id))
    .filter((p): p is NonNullable<typeof p> => p !== undefined);

  // Batch-compute live form badges for topPerformers + trending candidates.
  const badgeCandidateIds = [
    ...new Set([...topPerformersRaw.map((p) => p.id), ...trendingCandidatesRaw.map((p) => p.id)]),
  ];
  const badgeMap = await computeFormBadgesForPlayerIds(badgeCandidateIds);

  const overlayBadge = <T extends { id: number }>(rows: T[]) =>
    rows.map((p) => ({ ...p, ...(badgeMap.get(p.id) ?? { performanceTrend: "steady", trending: false }) }));

  const [todaysGames, upcomingGames, injuries, transfers, recentlyReturned] = await Promise.all([
    attachFeaturedPlayers(todaysGamesRaw),
    attachFeaturedPlayers(upcomingGamesRaw),
    withInjuryBadges(injuriesRaw),
    withTransferBadges(transfersRaw),
    withInjuryBadges(recentlyReturnedRaw),
  ]);
  const latestNews = await attachPlayersToNews(latestNewsRaw);

  const withPoolTier = <T extends { worldCupRoster: boolean; nationalTeamCaps: number; age: number; dateOfBirth?: string | null }>(rows: T[]) =>
    rows.map(({ worldCupRoster, dateOfBirth, age: storedAge, ...row }) => {
      const age = resolveAge(dateOfBirth, storedAge);
      return { ...row, age, poolTier: computePoolTier({ worldCupRoster, nationalTeamCaps: row.nationalTeamCaps, age }) };
    });

  // Filter trending to players whose computed badge is on_fire or rising.
  const trendingFiltered = trendingCandidatesRaw
    .filter((p) => {
      const b = badgeMap.get(p.id);
      return b?.performanceTrend === "on_fire" || b?.performanceTrend === "rising";
    })
    .slice(0, 6);

  const payload = {
    todaysGames,
    upcomingGames,
    latestNews,
    injuries,
    transfers,
    topPerformers: withPoolTier(overlayBadge(topPerformersRaw)),
    trending: withPoolTier(overlayBadge(trendingFiltered)),
    recentlyReturned,
    nextScheduleEvent: nextScheduleEventRows[0],
  };

  res.json(GetDashboardResponse.parse(payload));
});

export default router;
