/**
 * Senior USMNT call-ups, entered on the admin page when US Soccer announces a
 * roster. API-Football only publishes matchday lineups (about an hour before
 * kickoff), so this is the only source for who is in camp.
 *
 * A call-up is a fixture_players link with club_id NULL on an upcoming senior
 * USMNT match. It puts the match on the player's profile and makes them
 * eligible for that match's alerts. After the match, syncSeniorNtSquads
 * replaces the call-ups with the real matchday squad.
 */
import { db, clubsTable, fixturePlayersTable, fixturesTable, playersTable } from "@workspace/db";
import { and, asc, eq, gt, inArray, isNull, notInArray } from "drizzle-orm";

/** Upcoming senior USMNT matches with the players currently called up for each. */
export async function upcomingSeniorCallups() {
  const fixtures = await db
    .select({
      id: fixturesTable.id,
      kickoff: fixturesTable.kickoff,
      kickoffTimeTbd: fixturesTable.kickoffTimeTbd,
      homeTeam: fixturesTable.homeTeam,
      awayTeam: fixturesTable.awayTeam,
      competition: fixturesTable.competition,
    })
    .from(fixturesTable)
    .where(and(
      eq(fixturesTable.isNationalTeam, true),
      eq(fixturesTable.ntLevel, "SENIOR"),
      eq(fixturesTable.status, "scheduled"),
      gt(fixturesTable.kickoff, new Date()),
    ))
    .orderBy(asc(fixturesTable.kickoff));
  if (fixtures.length === 0) return [];
  const links = await db
    .select({ fixtureId: fixturePlayersTable.fixtureId, playerId: fixturePlayersTable.playerId })
    .from(fixturePlayersTable)
    .where(and(inArray(fixturePlayersTable.fixtureId, fixtures.map((f) => f.id)), isNull(fixturePlayersTable.clubId)));
  return fixtures.map((f) => ({
    ...f,
    playerIds: [...new Set(links.filter((l) => l.fixtureId === f.id).map((l) => l.playerId))],
  }));
}

/** Every tracked player, for the call-up picker. */
export async function callupPlayerOptions() {
  return db
    .select({ id: playersTable.id, name: playersTable.name, position: playersTable.position, clubName: clubsTable.name })
    .from(playersTable)
    .leftJoin(clubsTable, eq(clubsTable.id, playersTable.clubId))
    .orderBy(asc(playersTable.name));
}

export class CallupError extends Error {}

/**
 * Make `playerIds` exactly the call-ups for each of `fixtureIds`: adds the
 * missing links and removes other national-team links. Club links are never
 * touched. Every fixture must be an upcoming senior USMNT match.
 */
export async function setCallups(fixtureIds: number[], playerIds: number[]): Promise<{ added: number; removed: number }> {
  const ids = [...new Set(fixtureIds)];
  const players = [...new Set(playerIds)];
  const valid = await db
    .select({ id: fixturesTable.id })
    .from(fixturesTable)
    .where(and(
      inArray(fixturesTable.id, ids),
      eq(fixturesTable.isNationalTeam, true),
      eq(fixturesTable.ntLevel, "SENIOR"),
      eq(fixturesTable.status, "scheduled"),
      gt(fixturesTable.kickoff, new Date()),
    ));
  if (valid.length !== ids.length) throw new CallupError("Call-ups can only be set for upcoming senior USMNT matches");
  if (players.length > 0) {
    const known = await db.select({ id: playersTable.id }).from(playersTable).where(inArray(playersTable.id, players));
    if (known.length !== players.length) throw new CallupError("Unknown player in the call-up list");
  }

  let added = 0;
  let removed = 0;
  await db.transaction(async (tx) => {
    for (const fixtureId of ids) {
      const dropped = await tx
        .delete(fixturePlayersTable)
        .where(and(
          eq(fixturePlayersTable.fixtureId, fixtureId),
          isNull(fixturePlayersTable.clubId),
          ...(players.length > 0 ? [notInArray(fixturePlayersTable.playerId, players)] : []),
        ))
        .returning({ id: fixturePlayersTable.id });
      removed += dropped.length;
      const existing = await tx
        .select({ playerId: fixturePlayersTable.playerId })
        .from(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, fixtureId));
      const linked = new Set(existing.map((e) => e.playerId));
      const toAdd = players.filter((p) => !linked.has(p));
      if (toAdd.length > 0) {
        await tx.insert(fixturePlayersTable).values(toAdd.map((playerId) => ({ fixtureId, playerId, clubId: null })));
        added += toAdd.length;
      }
    }
  });
  return { added, removed };
}
