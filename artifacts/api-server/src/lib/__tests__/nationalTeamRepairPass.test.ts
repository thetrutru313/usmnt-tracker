/**
 * Regression guard: confirms that `runNationalTeamRepairPass` correctly
 * re-links players who return to a competition after missing a window, and
 * that it never over-links players with no prior history in the competition.
 *
 * ## Why this matters
 * `runNationalTeamRepairPass` links players to upcoming NT fixtures by reading
 * their past match history in the same competition.  If a player was dropped
 * for one window their only history may be older than the current window — the
 * pass must still find them and link them to all upcoming fixtures in that
 * competition so their chip appears on the fixture card.
 *
 * ## What is tested
 * 1. A player WITH a finished NT fixture in competition C is linked to all
 *    upcoming NT fixtures in competition C after the repair pass runs.
 * 2. A player with NO finished NT history in competition C is NOT linked to
 *    upcoming NT fixtures in competition C (over-linking guard).
 *
 * ## Test data isolation
 * Every inserted row uses a name prefix "__NTRP_" so cleanup is predictable.
 * afterAll deletes in FK-safe reverse order: fixture_players → fixtures →
 * players → clubs.
 */

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import {
  db,
  clubsTable,
  playersTable,
  fixturesTable,
  fixturePlayersTable,
} from "@workspace/db";
import { eq, inArray, like } from "drizzle-orm";
import { runNationalTeamRepairPass } from "../apiFootballSync.js";

// ─── Cleanup state ────────────────────────────────────────────────────────────

const insertedClubIds: number[] = [];
const insertedPlayerIds: number[] = [];
const insertedFixtureIds: number[] = [];

beforeAll(async () => {
  // Remove any stale rows left by a previously crashed run.  The test uses
  // "__NTRP_" / "__ntrp-" prefixes for all inserted rows; we delete them in
  // FK-safe order so fresh inserts can proceed cleanly.
  const stalePlayers = await db
    .select({ id: playersTable.id })
    .from(playersTable)
    .where(like(playersTable.slug, "__ntrp-%"));
  if (stalePlayers.length > 0) {
    const ids = stalePlayers.map((r) => r.id);
    await db.delete(fixturePlayersTable).where(inArray(fixturePlayersTable.playerId, ids)).catch(() => {});
    await db.delete(playersTable).where(inArray(playersTable.id, ids)).catch(() => {});
  }
  await db
    .delete(clubsTable)
    .where(like(clubsTable.name, "__NTRP_%"))
    .catch(() => {});
});

afterAll(async () => {
  // Belt-and-suspenders: delete fixture_players by BOTH playerId and fixtureId
  // so that rows created by runNationalTeamRepairPass for fixtures outside
  // insertedFixtureIds (e.g. pre-existing NT fixtures in the shared DB) are
  // also removed before we try to delete the player and fixture rows themselves.
  if (insertedPlayerIds.length > 0) {
    await db
      .delete(fixturePlayersTable)
      .where(inArray(fixturePlayersTable.playerId, insertedPlayerIds))
      .catch(() => {});
  }
  if (insertedFixtureIds.length > 0) {
    await db
      .delete(fixturePlayersTable)
      .where(inArray(fixturePlayersTable.fixtureId, insertedFixtureIds))
      .catch(() => {});
    await db
      .delete(fixturesTable)
      .where(inArray(fixturesTable.id, insertedFixtureIds));
  }
  if (insertedPlayerIds.length > 0) {
    await db
      .delete(playersTable)
      .where(inArray(playersTable.id, insertedPlayerIds));
  }
  if (insertedClubIds.length > 0) {
    await db
      .delete(clubsTable)
      .where(inArray(clubsTable.id, insertedClubIds));
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function insertClub(suffix: string): Promise<number> {
  const [row] = await db
    .insert(clubsTable)
    .values({
      name: `__NTRP_Club_${suffix}__`,
      league: "__NTRP Test League__",
      country: "USA",
    })
    .returning({ id: clubsTable.id });
  if (!row) throw new Error(`Club insert failed: ${suffix}`);
  insertedClubIds.push(row.id);
  return row.id;
}

async function insertPlayer(suffix: string, clubId: number): Promise<number> {
  const [row] = await db
    .insert(playersTable)
    .values({
      name: `__NTRP_Player_${suffix}__`,
      slug: `__ntrp-player-${suffix.toLowerCase().replace(/\s+/g, "-")}__`,
      position: "MF" as const,
      category: "current" as const,
      clubId,
      age: 24,
      nationalTeamCaps: 5,
      nationalTeamGoals: 0,
      bio: "",
      worldCupRoster: false,
    })
    .returning({ id: playersTable.id });
  if (!row) throw new Error(`Player insert failed: ${suffix}`);
  insertedPlayerIds.push(row.id);
  return row.id;
}

async function insertNtFixture(opts: {
  competition: string;
  status: "finished" | "scheduled" | "live";
  kickoffOffsetHours?: number;
}): Promise<number> {
  const offsetMs = (opts.kickoffOffsetHours ?? 48) * 60 * 60 * 1000;
  const kickoff = new Date(Date.now() + offsetMs);
  const [row] = await db
    .insert(fixturesTable)
    .values({
      isNationalTeam: true,
      competition: opts.competition,
      kickoff,
      venue: "__NTRP Venue__",
      homeTeam: "USA",
      awayTeam: "__NTRP Opponent__",
      status: opts.status,
    })
    .returning({ id: fixturesTable.id });
  if (!row) throw new Error(`NT fixture insert failed (${opts.competition} / ${opts.status})`);
  insertedFixtureIds.push(row.id);
  return row.id;
}

async function linkPlayer(fixtureId: number, playerId: number): Promise<void> {
  await db
    .insert(fixturePlayersTable)
    .values({ fixtureId, playerId, clubId: null });
}

async function getLinkedPlayerIds(fixtureId: number): Promise<number[]> {
  const rows = await db
    .select({ playerId: fixturePlayersTable.playerId })
    .from(fixturePlayersTable)
    .where(eq(fixturePlayersTable.fixtureId, fixtureId));
  return rows.map((r) => r.playerId);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("runNationalTeamRepairPass — re-linking after a missed window", () => {
  it(
    "links a returning player (with past NT history) to both upcoming fixtures in the same competition",
    async () => {
      // Scenario: a player played in competition C during a prior window
      // (finished fixture), was then dropped for the next window, and is now
      // back on the roster.  The repair pass must re-link them to all upcoming
      // fixtures in competition C.

      const COMPETITION = "__NTRP_Competition_Returning__";

      // ── Setup ──────────────────────────────────────────────────────────────
      const clubId = await insertClub("Returning");
      const playerId = await insertPlayer("Returning", clubId);

      // Past finished fixture — this is what qualifies the player as a veteran.
      const finishedFixtureId = await insertNtFixture({
        competition: COMPETITION,
        status: "finished",
        kickoffOffsetHours: -72, // 3 days ago
      });
      await linkPlayer(finishedFixtureId, playerId);

      // Two upcoming fixtures in the same competition the player was dropped
      // from (no existing fixture_players rows — simulates the missed window).
      const upcoming1Id = await insertNtFixture({
        competition: COMPETITION,
        status: "scheduled",
        kickoffOffsetHours: 48,
      });
      const upcoming2Id = await insertNtFixture({
        competition: COMPETITION,
        status: "scheduled",
        kickoffOffsetHours: 96,
      });

      // ── Run ────────────────────────────────────────────────────────────────
      const { linked } = await runNationalTeamRepairPass();

      // At least the two new links we expect must have been created.
      expect(linked, "repair pass must report at least 2 newly-linked rows").toBeGreaterThanOrEqual(2);

      // ── Assert ─────────────────────────────────────────────────────────────
      const linked1 = await getLinkedPlayerIds(upcoming1Id);
      expect(
        linked1,
        `player id=${playerId} must be linked to upcoming fixture 1 (id=${upcoming1Id})`,
      ).toContain(playerId);

      const linked2 = await getLinkedPlayerIds(upcoming2Id);
      expect(
        linked2,
        `player id=${playerId} must be linked to upcoming fixture 2 (id=${upcoming2Id})`,
      ).toContain(playerId);
    },
    30_000,
  );

  it(
    "does NOT link a player who has no past history in the competition (over-linking guard)",
    async () => {
      // Scenario: a player exists and has NT history in competition A, but has
      // NEVER played in competition B.  The repair pass must not link them to
      // upcoming fixtures in competition B.

      const COMPETITION_A = "__NTRP_Competition_A_Guard__";
      const COMPETITION_B = "__NTRP_Competition_B_Guard__";

      // ── Setup ──────────────────────────────────────────────────────────────
      const clubId = await insertClub("Guard");
      const playerId = await insertPlayer("Guard", clubId);

      // The player has a finished fixture in competition A only.
      const finishedInAId = await insertNtFixture({
        competition: COMPETITION_A,
        status: "finished",
        kickoffOffsetHours: -48,
      });
      await linkPlayer(finishedInAId, playerId);

      // An upcoming fixture in competition B — the player has no history here.
      const upcomingInBId = await insertNtFixture({
        competition: COMPETITION_B,
        status: "scheduled",
        kickoffOffsetHours: 72,
      });
      // Intentionally: NO fixture_players link for competition B.

      // ── Run ────────────────────────────────────────────────────────────────
      await runNationalTeamRepairPass();

      // ── Assert ─────────────────────────────────────────────────────────────
      const linkedInB = await getLinkedPlayerIds(upcomingInBId);
      expect(
        linkedInB,
        `player id=${playerId} must NOT be linked to competition B fixture (no history there)`,
      ).not.toContain(playerId);
    },
    30_000,
  );
});
