import { Router, type IRouter } from "express";
import { GetDashboardQueryParams, GetDashboardResponse } from "@workspace/api-zod";
import { db, scheduleEventsTable, playersTable, clubsTable } from "@workspace/db";
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, notIlike, notInArray, or, sql } from "drizzle-orm";
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
import { viewerDay } from "../lib/viewerDay.js";
import { matchWindowEnd, matchWindowStart, pickHeroEvent } from "../lib/scheduleWindow.js";

const router: IRouter = Router();

// Top Performers needs at least this many rated minutes over the 7-day window.
export const TOP_PERFORMER_MIN_MINUTES = 60;

// Minutes-weighted average rating; rated logs only (the query filters nulls).
const weekRatingExpr = sql<number>`sum(${matchLogsTable.rating} * ${matchLogsTable.minutes}) / nullif(sum(${matchLogsTable.minutes}), 0)`.mapWith(Number);
const weekMinutesExpr = sql<number>`sum(${matchLogsTable.minutes})`.mapWith(Number);

router.get("/dashboard", async (req, res): Promise<void> => {
  const parsed = GetDashboardQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { startOfDay, endOfDay, todayStr } = viewerDay(parsed.data.tz);
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
    scheduleEventRows,
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
    // Rank by minutes-weighted average match rating over the past 7 days —
    // more time-sensitive than the pre-computed last5 average, which can keep
    // a player at the top for weeks after their hot streak ended. Weighting by
    // minutes stops a short cameo counting as much as a full game, and the
    // TOP_PERFORMER_MIN_MINUTES floor keeps a single cameo off the list.
    db
      .select({
        playerId: matchLogsTable.playerId,
        weekRating: weekRatingExpr,
        weekMinutes: weekMinutesExpr,
      })
      .from(matchLogsTable)
      .where(and(
        gte(matchLogsTable.date, sevenDaysAgoStr),
        isNotNull(matchLogsTable.rating),
      ))
      .groupBy(matchLogsTable.playerId)
      .having(sql`sum(${matchLogsTable.minutes}) >= ${TOP_PERFORMER_MIN_MINUTES}`)
      .orderBy(desc(weekRatingExpr), desc(weekMinutesExpr))
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
    // All schedule events in display order; the hero is picked from them
    // below by pickHeroEvent (lib/scheduleWindow.ts). The table is small.
    db
      .select()
      .from(scheduleEventsTable)
      .orderBy(asc(scheduleEventsTable.sortOrder), asc(scheduleEventsTable.startDate)),
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
  const topPerformersRaw = recentRatings.flatMap((r) => {
    const p = profileMap.get(r.playerId);
    return p
      ? [{ ...p, weekRating: Math.round(r.weekRating * 100) / 100, weekMinutes: r.weekMinutes }]
      : [];
  });

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
  const nextEvent = pickHeroEvent(scheduleEventRows, new Date(), todayStr);
  let nextEventFixtures: (typeof fixturesTable.$inferSelect)[] = [];
  if (nextEvent?.startDate != null && nextEvent?.endDate != null) {
    const startTs = matchWindowStart(nextEvent.startDate);
    const endExclusive = matchWindowEnd(nextEvent.endDate);
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
