import { Router, type IRouter } from "express";
import { GetRankingsResponse } from "@workspace/api-zod";
import { db, playersTable, clubsTable } from "@workspace/db";
import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import {
  playerStatsTable,
  matchLogsTable,
  playerSummaryQuery,
  playerSummaryColumns,
  computePoolTier,
  resolveAge,
  transfersWithPlayerQuery,
  transfersTable,
  injuriesWithPlayerQuery,
  injuriesTable,
} from "../lib/queries";

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
  const [mostInForm, bestWeekendPerformancesRaw, mostMinutes, mostGoalContributionsRaw, returningFromInjury, risingFast, transferBuzz] =
    await Promise.all([
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
          performanceTrend: playersTable.performanceTrend,
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
        // Only real, rated appearances can be a "best performance" — brief
        // cameos with no API-Football rating are excluded rather than sorted
        // to the top by a null-as-highest ordering quirk.
        .where(isNotNull(matchLogsTable.rating))
        .orderBy(desc(matchLogsTable.rating))
        .limit(8),
      db
        .select(playerSummaryColumns)
        .from(playerStatsTable)
        .innerJoin(playersTable, eq(playerStatsTable.playerId, playersTable.id))
        .innerJoin(clubsTable, eq(playersTable.clubId, clubsTable.id))
        .where(eq(playerStatsTable.periodType, "season"))
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
        .where(eq(playerStatsTable.periodType, "season"))
        .limit(50),
      injuriesWithPlayerQuery().where(eq(injuriesTable.status, "returned")).orderBy(desc(injuriesTable.startDate)).limit(6),
      // Rising Prospects: prospect/fringe players trending up, ordered by
      // last5 avg rating so the hottest young player ranks first. Uses a
      // direct join against playerStatsTable (period last5) rather than the
      // generic playerSummaryQuery so we can order by the stat column and
      // apply the same 270-minute confidence gate as the form badge.
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
            inArray(playersTable.performanceTrend, ["on_fire", "rising"]),
            inArray(playersTable.category, ["prospect", "fringe"]),
          ),
        )
        .orderBy(desc(playerStatsTable.avgRating))
        .limit(8),
      transfersWithPlayerQuery().where(eq(transfersTable.status, "rumor")).orderBy(desc(transfersTable.probabilityScore)).limit(6),
    ]);

  const mostGoalContributions = withPoolTier(
    mostGoalContributionsRaw
      .map(({ goals, assists, ...summary }) => ({ summary, contributions: goals + assists }))
      .sort((a, b) => b.contributions - a.contributions)
      .slice(0, 8)
      .map((r) => r.summary),
  );

  const payload = {
    mostInForm: withPoolTier(mostInForm),
    bestWeekendPerformances: bestWeekendPerformancesRaw,
    mostMinutes: withPoolTier(mostMinutes),
    mostGoalContributions,
    returningFromInjury,
    risingFast: withPoolTier(risingFast),
    transferBuzz,
  };

  res.json(GetRankingsResponse.parse(payload));
});

export default router;
