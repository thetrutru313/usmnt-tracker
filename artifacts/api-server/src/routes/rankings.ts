import { Router, type IRouter } from "express";
import { GetRankingsResponse } from "@workspace/api-zod";
import { db, playersTable, clubsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  playerStatsTable,
  matchLogsTable,
  playerSummaryQuery,
  playerSummaryColumns,
  transfersWithPlayerQuery,
  transfersTable,
  injuriesWithPlayerQuery,
  injuriesTable,
} from "../lib/queries";

const router: IRouter = Router();

router.get("/rankings", async (_req, res): Promise<void> => {
  const [mostInForm, bestWeekendPerformancesRaw, mostMinutes, mostGoalContributionsRaw, returningFromInjury, risingFast, transferBuzz] =
    await Promise.all([
      db
        .select(playerSummaryColumns)
        .from(playerStatsTable)
        .innerJoin(playersTable, eq(playerStatsTable.playerId, playersTable.id))
        .innerJoin(clubsTable, eq(playersTable.clubId, clubsTable.id))
        .where(eq(playerStatsTable.periodType, "last5"))
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
      playerSummaryQuery().where(eq(playersTable.performanceTrend, "rising")).limit(8),
      transfersWithPlayerQuery().where(eq(transfersTable.status, "rumor")).orderBy(desc(transfersTable.probabilityScore)).limit(6),
    ]);

  const mostGoalContributions = mostGoalContributionsRaw
    .map(({ goals, assists, ...summary }) => ({ summary, contributions: goals + assists }))
    .sort((a, b) => b.contributions - a.contributions)
    .slice(0, 8)
    .map((r) => r.summary);

  const payload = {
    mostInForm,
    bestWeekendPerformances: bestWeekendPerformancesRaw,
    mostMinutes,
    mostGoalContributions,
    returningFromInjury,
    risingFast,
    transferBuzz,
  };

  res.json(GetRankingsResponse.parse(payload));
});

export default router;
