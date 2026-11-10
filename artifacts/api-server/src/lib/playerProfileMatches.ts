/**
 * Recent and upcoming matches for the player profile.
 *
 * - Recent: club and USMNT matches are fetched separately (10 each), so the
 *   USMNT tab isn't emptied by a run of club games. USMNT also includes senior
 *   matches where the player was in the matchday squad but didn't play
 *   (from fixture_players, filled by syncSeniorNtSquads), marked didNotPlay.
 * - Upcoming: matches the player is linked to that haven't finished, without
 *   club friendlies (as on the Fixtures page) or links left over from a
 *   previous club.
 */
import { db, fixturePlayersTable, fixturesTable, matchLogsTable, playersTable } from "@workspace/db";
import { and, asc, count, desc, eq, gt, gte, isNull, ne, notIlike, or, sql } from "drizzle-orm";

export type ProfileMatch = {
  id: number;
  fixtureId: number | null;
  /** Kickoff time when the match is in the fixtures table — the UI shows the date in the viewer's zone. */
  kickoff: Date | null;
  date: string;
  opponent: string;
  competition: string;
  result: string;
  minutes: number;
  goals: number;
  assists: number;
  rating: number | null;
  isNationalTeam: boolean;
  didNotPlay: boolean;
};

async function loggedMatches(playerId: number, nationalTeam: boolean, limit: number): Promise<ProfileMatch[]> {
  const rows = await db
    .select({
      id: matchLogsTable.id,
      fixtureId: fixturesTable.id,
      kickoff: fixturesTable.kickoff,
      date: matchLogsTable.date,
      opponent: matchLogsTable.opponent,
      competition: matchLogsTable.competition,
      result: matchLogsTable.result,
      minutes: matchLogsTable.minutes,
      goals: matchLogsTable.goals,
      assists: matchLogsTable.assists,
      rating: matchLogsTable.rating,
      isNationalTeam: matchLogsTable.isNationalTeam,
    })
    .from(matchLogsTable)
    .leftJoin(fixturesTable, eq(fixturesTable.apiFootballFixtureId, matchLogsTable.apiFootballFixtureId))
    .where(and(eq(matchLogsTable.playerId, playerId), eq(matchLogsTable.isNationalTeam, nationalTeam)))
    .orderBy(desc(matchLogsTable.date), desc(matchLogsTable.id))
    .limit(limit);
  return rows.map((r) => ({ ...r, didNotPlay: false }));
}

/** Finished senior USMNT matches where the player was in the matchday squad but got no minutes. */
async function unusedSquadMatches(playerId: number, limit: number): Promise<ProfileMatch[]> {
  const rows = await db
    .select({
      id: fixturesTable.id,
      kickoff: fixturesTable.kickoff,
      homeTeam: fixturesTable.homeTeam,
      awayTeam: fixturesTable.awayTeam,
      homeScore: fixturesTable.homeScore,
      awayScore: fixturesTable.awayScore,
      competition: fixturesTable.competition,
    })
    .from(fixturePlayersTable)
    .innerJoin(fixturesTable, eq(fixturesTable.id, fixturePlayersTable.fixtureId))
    .where(and(
      eq(fixturePlayersTable.playerId, playerId),
      eq(fixturesTable.isNationalTeam, true),
      eq(fixturesTable.ntLevel, "SENIOR"),
      eq(fixturesTable.status, "finished"),
      sql`NOT EXISTS (
        SELECT 1 FROM match_logs ml
        WHERE ml.player_id = ${playerId} AND ml.is_national_team
          AND ml.api_football_fixture_id = ${fixturesTable.apiFootballFixtureId}
          AND ml.minutes > 0
      )`,
    ))
    .orderBy(desc(fixturesTable.kickoff))
    .limit(limit);

  return rows.map((f) => {
    const usHome = f.homeTeam === "USA";
    const ours = usHome ? f.homeScore : f.awayScore;
    const theirs = usHome ? f.awayScore : f.homeScore;
    const outcome = ours == null || theirs == null ? "" : ours > theirs ? "W" : ours < theirs ? "L" : "D";
    return {
      // Negative so it never collides with a match log id in the UI's list keys.
      id: -f.id,
      fixtureId: f.id,
      kickoff: f.kickoff,
      // Same UTC-date convention as match_logs.date.
      date: f.kickoff.toISOString().slice(0, 10),
      opponent: usHome ? f.awayTeam : f.homeTeam,
      competition: f.competition,
      result: outcome ? `${outcome} ${ours}-${theirs}` : "",
      minutes: 0,
      goals: 0,
      assists: 0,
      rating: null,
      isNationalTeam: true,
      didNotPlay: true,
    };
  });
}

/** The 10 most recent club matches and the 10 most recent USMNT matches (played or in the squad), newest first. */
export async function getRecentMatchesForPlayer(playerId: number, perKind = 10): Promise<ProfileMatch[]> {
  const [club, usmnt, unused] = await Promise.all([
    loggedMatches(playerId, false, perKind),
    loggedMatches(playerId, true, perKind),
    unusedSquadMatches(playerId, perKind),
  ]);
  const national = [...usmnt, ...unused].sort((a, b) => b.date.localeCompare(a.date)).slice(0, perKind);
  return [...club, ...national].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

/**
 * Matches the player is linked to that haven't finished (kicked off in the
 * last 3 hours or later), soonest first. Club friendlies and links made for a
 * previous club are left out; national-team links (club_id NULL) are kept.
 */
export async function getUpcomingFixtureIdsForPlayer(playerId: number): Promise<number[]> {
  const [player] = await db
    .select({ clubId: playersTable.clubId })
    .from(playersTable)
    .where(eq(playersTable.id, playerId));
  if (!player) return [];
  const rows = await db
    .select({ id: fixturesTable.id })
    .from(fixturePlayersTable)
    .innerJoin(fixturesTable, eq(fixturesTable.id, fixturePlayersTable.fixtureId))
    .where(and(
      eq(fixturePlayersTable.playerId, playerId),
      gte(fixturesTable.kickoff, new Date(Date.now() - 3 * 60 * 60 * 1000)),
      ne(fixturesTable.status, "finished"),
      or(eq(fixturesTable.isNationalTeam, true), notIlike(fixturesTable.competition, "%Friendlies%")),
      or(isNull(fixturePlayersTable.clubId), eq(fixturePlayersTable.clubId, player.clubId)),
    ))
    .orderBy(asc(fixturesTable.kickoff));
  return [...new Set(rows.map((r) => r.id))];
}

/** USMNT appearances (minutes > 0) in one World Cup cycle. */
export async function countCycleCaps(playerId: number, cycle: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(matchLogsTable)
    .where(and(
      eq(matchLogsTable.playerId, playerId),
      eq(matchLogsTable.isNationalTeam, true),
      eq(matchLogsTable.cycle, cycle),
      gt(matchLogsTable.minutes, 0),
    ));
  return row?.n ?? 0;
}
