import { Router, type IRouter } from "express";
import { GetRankingsResponse } from "@workspace/api-zod";
import { db, playersTable, clubsTable } from "@workspace/db";
import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import {
  playerStatsTable,
  matchLogsTable,
  playerSummaryColumns,
  computePoolTier,
  resolveAge,
  computeFormBadgesForPlayerIds,
  withInjuryBadges,
  injuriesWithPlayerQuery,
  injuriesTable,
} from "../lib/queries";
import { seasonYearCandidates } from "../lib/playerStatsSync";

/** Mirrors the `listPlayers` transform: resolves age from DOB, replaces `worldCupRoster` with the derived `poolTier`, and strips `dateOfBirth` from the response. */
function withPoolTier<T extends { worldCupRoster: boolean; nationalTeamCaps: number; age: number; dateOfBirth?: string | null }>(
  rows: T[],
): (Omit<T, "worldCupRoster" | "dateOfBirth" | "age"> & { age: number; poolTier: ReturnType<typeof computePoolTier> })[] {
  return rows.map(({ worldCupRoster, dateOfBirth, age: storedAge, ...rest }) => {
    const age = resolveAge(dateOfBirth, storedAge);
    return { ...rest, age, poolTier: computePoolTier({ worldCupRoster, nationalTeamCaps: rest.nationalTeamCaps, age }) };
  });
}

const router: IRouter = Router();

router.get("/rankings", async (_req, res): Promise<void> => {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

  // seasonYearCandidates() returns [currentYear, currentYear-1, currentYear-2].
  // The first candidate is always the active season; used to pin both the
  // mostMinutes and mostGoalContributions leaderboards to season_all rows for
  // that year so all-club totals (not just current-club stats) are ranked.
  const [currentSeasonYear] = seasonYearCandidates();
  const currentSeasonStr = String(currentSeasonYear);

  const [
    mostInFormRaw,
    bestWeekendPerformancesRaw,
    mostMinutesRaw,
    mostGoalContributionsRaw,
    returningFromInjuryRaw,
    risingFastCandidatesRaw,
  ] = await Promise.all([
    db
      .select(playerSummaryColumns)
      .from(playerStatsTable)
      .innerJoin(playersTable, eq(playerStatsTable.playerId, playersTable.id))
      .innerJoin(clubsTable, eq(playersTable.clubId, clubsTable.id))
      // 270-minute gate mirrors the form badge's confidence threshold — only
      // players with meaningful playing time qualify as "most in form".
      .where(and(eq(playerStatsTable.periodType, "last5"), isNotNull(playerStatsTable.avgRating), gte(playerStatsTable.minutes, 270)))
      .orderBy(desc(playerStatsTable.avgRating))
      .limit(8),
    db
      .select({
        id: matchLogsTable.id,
        date: matchLogsTable.date,
        opponent: matchLogsTable.opponent,
        competition: matchLogsTable.competition,
        result: matchLogsTable.result,
        minutes: matchLogsTable.minutes,
        goals: matchLogsTable.goals,
        assists: matchLogsTable.assists,
        rating: matchLogsTable.rating,
        // performanceTrend removed from the stored column — overlaid below from computed badges.
        player: {
          id: playersTable.id,
          name: playersTable.name,
          slug: playersTable.slug,
          position: playersTable.position,
          photoUrl: playersTable.photoUrl,
        },
      })
      .from(matchLogsTable)
      .innerJoin(playersTable, eq(matchLogsTable.playerId, playersTable.id))
      // Only real, rated appearances from the past 7 days qualify — brief
      // cameos with no rating are excluded, and the window keeps results
      // current rather than showing all-time highlights.
      .where(and(
        isNotNull(matchLogsTable.rating),
        gte(matchLogsTable.date, sevenDaysAgoStr),
      ))
      .orderBy(desc(matchLogsTable.rating))
      .limit(8),
    // Ironmen: season_all so goals/minutes from all clubs in the season are
    // counted, not just the current club.  Pinned to currentSeasonStr so the
    // leaderboard doesn't mix seasons when a player has multi-year history.
    db
      .select(playerSummaryColumns)
      .from(playerStatsTable)
      .innerJoin(playersTable, eq(playerStatsTable.playerId, playersTable.id))
      .innerJoin(clubsTable, eq(playersTable.clubId, clubsTable.id))
      .where(and(eq(playerStatsTable.periodType, "season_all"), eq(playerStatsTable.season, currentSeasonStr)))
      .orderBy(desc(playerStatsTable.minutes))
      .limit(8),
    db
      .select({
        ...playerSummaryColumns,
        goals: playerStatsTable.goals,
        assists: playerStatsTable.assists,
      })
      .from(playerStatsTable)
      .innerJoin(playersTable, eq(playerStatsTable.playerId, playersTable.id))
      .innerJoin(clubsTable, eq(playersTable.clubId, clubsTable.id))
      .where(and(eq(playerStatsTable.periodType, "season_all"), eq(playerStatsTable.season, currentSeasonStr)))
      .limit(50),
    injuriesWithPlayerQuery().where(eq(injuriesTable.status, "returned")).orderBy(desc(injuriesTable.startDate)).limit(6),
    // Rising Prospects: over-fetch candidates — badge computation below filters to on_fire/rising only.
    // Removed stale inArray(performanceTrend, ...) filter; badges are now derived at query time.
    db
      .select(playerSummaryColumns)
      .from(playerStatsTable)
      .innerJoin(playersTable, eq(playerStatsTable.playerId, playersTable.id))
      .innerJoin(clubsTable, eq(playersTable.clubId, clubsTable.id))
      .where(
        and(
          eq(playerStatsTable.periodType, "last5"),
          isNotNull(playerStatsTable.avgRating),
          gte(playerStatsTable.minutes, 270),
          inArray(playersTable.category, ["prospect", "fringe"]),
        ),
      )
      .orderBy(desc(playerStatsTable.avgRating))
      .limit(50),
  ]);

  // Batch-compute live form badges for all player-summary rows in one round-trip.
  const summaryPlayerIds = [
    ...new Set([
      ...mostInFormRaw.map((p) => p.id),
      ...mostMinutesRaw.map((p) => p.id),
      ...mostGoalContributionsRaw.map((p) => p.id),
      ...risingFastCandidatesRaw.map((p) => p.id),
      ...bestWeekendPerformancesRaw.map((p) => p.player.id),
    ]),
  ];
  const badgeMap = await computeFormBadgesForPlayerIds(summaryPlayerIds);

  const overlayBadge = <T extends { id: number }>(rows: T[]) =>
    rows.map((p) => ({ ...p, ...(badgeMap.get(p.id) ?? { performanceTrend: "steady", trending: false }) }));

  // bestWeekendPerformances: badge lives at the player level, overlaid onto the log row.
  const bestWeekendPerformances = bestWeekendPerformancesRaw.map((row) => ({
    ...row,
    ...(badgeMap.get(row.player.id) ?? { performanceTrend: "steady", trending: false }),
  }));

  const mostGoalContributions = withPoolTier(
    overlayBadge(mostGoalContributionsRaw)
      .map(({ goals, assists, ...summary }) => ({ summary, contributions: goals + assists }))
      .sort((a, b) => b.contributions - a.contributions)
      .slice(0, 8)
      .map((r) => r.summary),
  );

  // Filter rising fast candidates to those whose computed badge is on_fire or rising.
  const risingFast = withPoolTier(
    overlayBadge(risingFastCandidatesRaw)
      .filter((p) => p.performanceTrend === "on_fire" || p.performanceTrend === "rising")
      .slice(0, 8),
  );

  const returningFromInjury = await withInjuryBadges(returningFromInjuryRaw);

  const payload = {
    mostInForm: withPoolTier(overlayBadge(mostInFormRaw)),
    bestWeekendPerformances,
    mostMinutes: withPoolTier(overlayBadge(mostMinutesRaw)),
    mostGoalContributions,
    returningFromInjury,
    risingFast,
    // seasonYear: the year both leaderboards (mostMinutes + mostGoalContributions)
    // cover — lets the UI label the "Ironmen" card without re-deriving the year.
    seasonYear: currentSeasonStr,
  };

  res.json(GetRankingsResponse.parse(payload));
});

export default router;
