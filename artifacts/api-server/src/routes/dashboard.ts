import { Router, type IRouter } from "express";
import { GetDashboardResponse } from "@workspace/api-zod";
import { db, scheduleEventsTable, playersTable, clubsTable } from "@workspace/db";
import { and, asc, avg, desc, eq, gte, inArray, isNotNull, isNull, lt, notIlike, notInArray, or, sql } from "drizzle-orm";
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
  seniorNtFixtureCondition,
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
        // Only show fixtures that have at least one tagged USMNT player; national-team
        // fixtures are always relevant regardless of fixture_players links.
        or(
          eq(fixturesTable.isNationalTeam, true),
          sql`EXISTS (SELECT 1 FROM fixture_players fp WHERE fp.fixture_id = ${fixturesTable.id})`,
        ),
      ))
      .orderBy(asc(fixturesTable.kickoff)),
    db
      .select()
      .from(fixturesTable)
      .where(and(
        gte(fixturesTable.kickoff, endOfDay),
        notInArray(fixturesTable.status, ["finished", "cancelled", "postponed"]),
        or(eq(fixturesTable.isNationalTeam, true), notIlike(fixturesTable.competition, "%Friendlies%")),
        // Same ghost-fixture guard as todaysGames and the Fixtures page.
        or(
          eq(fixturesTable.isNationalTeam, true),
          sql`EXISTS (SELECT 1 FROM fixture_players fp WHERE fp.fixture_id = ${fixturesTable.id})`,
        ),
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
    // Select the event whose window is either currently active or starts in the
    // future. Crucially, the effective end of a windowed event is extended by
    // 30 hours beyond endDate midnight UTC — exactly matching the fixture-
    // attachment window — so a final match that kicks off in ET (and therefore
    // has a UTC date of the next calendar day) does not cause the event to be
    // dropped prematurely.
    //
    // Example: Sept 26–29 window. Chile kicks off at Sept 30 00:00 UTC (8 PM
    // ET Sept 29). Without the +30 h extension, todayStr = "2026-09-30" would
    // make endDate ("2026-09-29") fail a >= check and the October event would be
    // shown instead. With the extension, the effective close is Sept 30 06:00
    // UTC, so the September event stays selected until the match finishes.
    //
    // Rules (all NULL-safe):
    //  - Has endDate   → keep while (endDate::date + 30 h) > NOW()
    //  - No endDate, has startDate → keep while startDate >= todayStr
    //  - No dates at all → always include (undated / TBD events)
    db
      .select()
      .from(scheduleEventsTable)
      .where(
        or(
          // Has endDate: active until 30 h after endDate midnight UTC.
          and(
            isNotNull(scheduleEventsTable.endDate),
            sql`(${scheduleEventsTable.endDate}::date + interval '30 hours') > NOW()`,
          ),
          // No endDate but has startDate: keep while the start date is upcoming.
          and(
            isNull(scheduleEventsTable.endDate),
            isNotNull(scheduleEventsTable.startDate),
            gte(scheduleEventsTable.startDate, todayStr),
          ),
          // No dates at all: undated / TBD events always appear.
          and(
            isNull(scheduleEventsTable.endDate),
            isNull(scheduleEventsTable.startDate),
          ),
        ),
      )
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

  // If the next schedule event has a defined date window, fetch any NT fixtures
  // that fall within it so the frontend can render a per-match layout.
  const nextEvent = nextScheduleEventRows[0];
  let nextEventFixtures: (typeof fixturesTable.$inferSelect)[] = [];
  if (nextEvent?.startDate != null && nextEvent?.endDate != null) {
    const startTs = new Date(nextEvent.startDate + "T00:00:00Z");
    // Extend by 30 h to cover late-ET matches (e.g. 10 PM ET = 02:00 UTC next day).
    const endExclusive = new Date(
      new Date(nextEvent.endDate + "T00:00:00Z").getTime() + 30 * 60 * 60 * 1000,
    );
    nextEventFixtures = await db
      .select()
      .from(fixturesTable)
      .where(
        and(
          seniorNtFixtureCondition,
          gte(fixturesTable.kickoff, startTs),
          lt(fixturesTable.kickoff, endExclusive),
        ),
      )
      .orderBy(asc(fixturesTable.kickoff));
  }

  const payload = {
    todaysGames,
    upcomingGames,
    latestNews,
    injuries,
    transfers,
    topPerformers: withPoolTier(overlayBadge(topPerformersRaw)),
    trending: withPoolTier(overlayBadge(trendingFiltered)),
    recentlyReturned,
    nextScheduleEvent: nextEvent
      ? {
          ...nextEvent,
          fixtures: nextEventFixtures.map((f) => ({ ...f, featuredPlayers: [] })),
        }
      : undefined,
  };

  res.json(GetDashboardResponse.parse(payload));
});

export default router;
