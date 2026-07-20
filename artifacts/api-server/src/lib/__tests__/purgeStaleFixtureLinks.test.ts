/**
 * Regression guard: confirms that `purgeStaleTransferredPlayerLinks` removes
 * `fixture_players` links whose club_id no longer matches the player's current
 * club, while leaving finished-fixture links and national-team links untouched.
 *
 * ## Why this matters
 * When a player transfers clubs, their old-club upcoming fixture cards go blank
 * because `getFeaturedPlayersForFixtures` filters out stale links at runtime.
 * `purgeStaleTransferredPlayerLinks` runs at the start of every fixture-sync
 * sweep to clean those links up explicitly; the per-club `runRepairPass` that
 * follows then creates fresh links for the player's new club.
 *
 * ## What is tested
 * 1. A scheduled-fixture link where club_id ≠ player.club_id is deleted.
 * 2. A live-fixture link where club_id ≠ player.club_id is deleted.
 * 3. A finished-fixture link is preserved (historical record — not stale).
 * 4. A national-team link (club_id = null) is never touched.
 * 5. A scheduled-fixture link where club_id = player.club_id is preserved.
 */

import { describe, it, expect, afterAll } from "vitest";
import {
  db,
  clubsTable,
  playersTable,
  fixturesTable,
  fixturePlayersTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { purgeStaleTransferredPlayerLinks } from "../apiFootballSync.js";

// ─── cleanup ─────────────────────────────────────────────────────────────────

const insertedClubIds: number[] = [];
const insertedPlayerIds: number[] = [];
const insertedFixtureIds: number[] = [];

afterAll(async () => {
  if (insertedFixtureIds.length > 0) {
    await db.delete(fixturePlayersTable).where(inArray(fixturePlayersTable.fixtureId, insertedFixtureIds));
    await db.delete(fixturesTable).where(inArray(fixturesTable.id, insertedFixtureIds));
  }
  if (insertedPlayerIds.length > 0) {
    await db.delete(playersTable).where(inArray(playersTable.id, insertedPlayerIds));
  }
  if (insertedClubIds.length > 0) {
    await db.delete(clubsTable).where(inArray(clubsTable.id, insertedClubIds));
  }
});

// ─── helpers ─────────────────────────────────────────────────────────────────

async function insertClub(suffix: string): Promise<number> {
  const [row] = await db
    .insert(clubsTable)
    .values({ name: `__PurgeTest ${suffix}__`, league: "Test League", country: "USA" })
    .returning({ id: clubsTable.id });
  if (!row) throw new Error("Club insert failed");
  insertedClubIds.push(row.id);
  return row.id;
}

async function insertPlayer(clubId: number, suffix: string): Promise<number> {
  const [row] = await db
    .insert(playersTable)
    .values({
      name: `__PurgeTest Player ${suffix}__`,
      slug: `__purgetest-player-${suffix.toLowerCase().replace(/\s/g, "-")}__`,
      position: "MF",
      category: "current",
      clubId,
      age: 25,
      nationalTeamCaps: 0,
      nationalTeamGoals: 0,
      performanceTrend: "steady",
      trending: false,
      bio: "",
      worldCupRoster: false,
    })
    .returning({ id: playersTable.id });
  if (!row) throw new Error("Player insert failed");
  insertedPlayerIds.push(row.id);
  return row.id;
}

async function insertFixture(status: "scheduled" | "live" | "finished", suffix: string): Promise<number> {
  const kickoff =
    status === "finished"
      ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 days ago
      : new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours from now
  const [row] = await db
    .insert(fixturesTable)
    .values({
      isNationalTeam: false,
      competition: "Test League",
      kickoff,
      venue: "Test Stadium",
      homeTeam: `__PurgeTest Home ${suffix}__`,
      awayTeam: `__PurgeTest Away ${suffix}__`,
      status,
    })
    .returning({ id: fixturesTable.id });
  if (!row) throw new Error("Fixture insert failed");
  insertedFixtureIds.push(row.id);
  return row.id;
}

async function linkPlayerToFixture(fixtureId: number, playerId: number, clubId: number | null): Promise<void> {
  await db.insert(fixturePlayersTable).values({ fixtureId, playerId, clubId });
}

async function linkExists(fixtureId: number, playerId: number): Promise<boolean> {
  const rows = await db
    .select({ id: fixturePlayersTable.id })
    .from(fixturePlayersTable)
    .where(eq(fixturePlayersTable.fixtureId, fixtureId));
  return rows.some((r) => r.id !== undefined);
}

async function countLinks(fixtureId: number): Promise<number> {
  const rows = await db
    .select({ id: fixturePlayersTable.id })
    .from(fixturePlayersTable)
    .where(eq(fixturePlayersTable.fixtureId, fixtureId));
  return rows.length;
}

// ─── suite ───────────────────────────────────────────────────────────────────

describe("purgeStaleTransferredPlayerLinks", () => {
  it(
    "deletes a scheduled-fixture link when the player has transferred to a different club",
    async () => {
      const oldClubId = await insertClub("Old Sched A");
      const newClubId = await insertClub("New Sched A");
      const playerId = await insertPlayer(newClubId, "Sched Transfer A"); // player is now at newClub
      const fixtureId = await insertFixture("scheduled", "Sched Transfer A");

      // Link was created when player was at oldClub — club_id = oldClubId but player.club_id = newClubId
      await linkPlayerToFixture(fixtureId, playerId, oldClubId);

      const { purged } = await purgeStaleTransferredPlayerLinks();

      expect(purged).toBeGreaterThanOrEqual(1);
      expect(await countLinks(fixtureId)).toBe(0);
    },
    30_000,
  );

  it(
    "deletes a live-fixture link when the player has transferred away mid-match tracking",
    async () => {
      const oldClubId = await insertClub("Old Live B");
      const newClubId = await insertClub("New Live B");
      const playerId = await insertPlayer(newClubId, "Live Transfer B");
      const fixtureId = await insertFixture("live", "Live Transfer B");

      await linkPlayerToFixture(fixtureId, playerId, oldClubId);

      const { purged } = await purgeStaleTransferredPlayerLinks();

      expect(purged).toBeGreaterThanOrEqual(1);
      expect(await countLinks(fixtureId)).toBe(0);
    },
    30_000,
  );

  it(
    "preserves a finished-fixture link even when the player has since transferred",
    async () => {
      const oldClubId = await insertClub("Old Finished C");
      const newClubId = await insertClub("New Finished C");
      const playerId = await insertPlayer(newClubId, "Finished Transfer C");
      const fixtureId = await insertFixture("finished", "Finished Transfer C");

      // Historical link — should never be deleted regardless of current club
      await linkPlayerToFixture(fixtureId, playerId, oldClubId);

      await purgeStaleTransferredPlayerLinks();

      // Link must still exist
      expect(await countLinks(fixtureId)).toBe(1);
    },
    30_000,
  );

  it(
    "preserves a national-team link (club_id = null) for a scheduled USMNT fixture",
    async () => {
      const clubId = await insertClub("NT Club D");
      const playerId = await insertPlayer(clubId, "NT Player D");
      const [fixtureRow] = await db
        .insert(fixturesTable)
        .values({
          isNationalTeam: true,
          competition: "USMNT Friendly",
          kickoff: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          venue: "Test Stadium",
          homeTeam: "USA",
          awayTeam: "__NT Opponent D__",
          status: "scheduled",
        })
        .returning({ id: fixturesTable.id });
      if (!fixtureRow) throw new Error("NT fixture insert failed");
      insertedFixtureIds.push(fixtureRow.id);

      // National-team link has club_id = null (curated, not club-sync created)
      await linkPlayerToFixture(fixtureRow.id, playerId, null);

      await purgeStaleTransferredPlayerLinks();

      // Link must be preserved
      expect(await countLinks(fixtureRow.id)).toBe(1);
    },
    30_000,
  );

  it(
    "preserves a scheduled-fixture link when the player's club_id still matches",
    async () => {
      const clubId = await insertClub("Same Club E");
      const playerId = await insertPlayer(clubId, "Same Club Player E");
      const fixtureId = await insertFixture("scheduled", "Same Club E");

      // club_id matches player.club_id — this is a fresh, valid link
      await linkPlayerToFixture(fixtureId, playerId, clubId);

      await purgeStaleTransferredPlayerLinks();

      expect(await countLinks(fixtureId)).toBe(1);
    },
    30_000,
  );
});
