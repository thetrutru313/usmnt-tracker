/**
 * Confirms that reconcileClubFixtures correctly populates `newlyFinished`
 * when a fixture transitions to "finished" during reconciliation.
 *
 * ## What & Why
 * The post-match pipeline depends on `newlyFinished`: callers use it to fire
 * `syncStatsForFinishedFixture` immediately instead of waiting for the next
 * daily stats job. If `newlyFinished` is never populated, or populated for
 * fixtures that were already finished, the post-match trigger silently misfires.
 *
 * ## What is tested
 * 1. A "live → finished" transition populates `newlyFinished` with the correct
 *    fixture id and the full set of club player ids.
 * 2. A "scheduled → finished" transition (skipped the live phase entirely, e.g.
 *    a stats feed delay) also appears in `newlyFinished`.
 * 3. A fixture already stored as "finished" does NOT appear in `newlyFinished`
 *    on a second reconciliation pass (idempotency guard).
 *
 * ## How it works
 * Boots reconcileClubFixtures directly (no HTTP, no full sync loop).
 * Uses a real DB connection with a minimal set of seeded rows; all rows are
 * cleaned up in afterAll.
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
import { reconcileClubFixtures, type AfFixture } from "../fixtureReconciliation.js";

// ─── cleanup state ────────────────────────────────────────────────────────────

const insertedFixtureIds: number[] = [];
const insertedPlayerIds: number[] = [];
const insertedClubIds: number[] = [];

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

// ─── helpers ──────────────────────────────────────────────────────────────────

async function insertClub(name: string): Promise<{ id: number; name: string }> {
  const [club] = await db
    .insert(clubsTable)
    .values({ name, league: "Test League", country: "USA" })
    .returning({ id: clubsTable.id, name: clubsTable.name });
  if (!club) throw new Error("Club insert failed");
  insertedClubIds.push(club.id);
  return club;
}

async function insertPlayer(clubId: number, slug: string): Promise<number> {
  const [player] = await db
    .insert(playersTable)
    .values({
      name: `__NF Test Player ${slug}__`,
      slug: `__nf-test-${slug}__`,
      position: "MF" as const,
      category: "current" as const,
      clubId,
      age: 24,
    })
    .returning({ id: playersTable.id });
  if (!player) throw new Error("Player insert failed");
  insertedPlayerIds.push(player.id);
  return player.id;
}

async function insertFixture(opts: {
  apiFootballFixtureId: number;
  status: "scheduled" | "live" | "finished";
  kickoffOffsetMs?: number; // relative to now; negative = past
}): Promise<number> {
  const kickoff = new Date(Date.now() + (opts.kickoffOffsetMs ?? -2 * 60 * 60 * 1000));
  const [fixture] = await db
    .insert(fixturesTable)
    .values({
      apiFootballFixtureId: opts.apiFootballFixtureId,
      isNationalTeam: false,
      competition: "Test League",
      kickoff,
      venue: "Test Stadium",
      homeTeam: `__NF Home ${opts.apiFootballFixtureId}__`,
      awayTeam: `__NF Away ${opts.apiFootballFixtureId}__`,
      status: opts.status,
    })
    .returning({ id: fixturesTable.id });
  if (!fixture) throw new Error("Fixture insert failed");
  insertedFixtureIds.push(fixture.id);
  return fixture.id;
}

async function linkPlayer(fixtureId: number, playerId: number, clubId: number): Promise<void> {
  await db.insert(fixturePlayersTable).values({ fixtureId, playerId, clubId });
}

/** Minimal AfFixture stub with "FT" status. */
function makeFinishedAfFixture(apiId: number): AfFixture {
  return {
    fixture: {
      id: apiId,
      date: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      status: { short: "FT", elapsed: 90 },
      venue: { name: "Test Stadium" },
    },
    league: { name: "Test League" },
    teams: {
      home: { id: 10, name: `__NF Home ${apiId}__`, logo: null },
      away: { id: 11, name: `__NF Away ${apiId}__`, logo: null },
    },
    goals: { home: 2, away: 1 },
  };
}

// ─── suite ────────────────────────────────────────────────────────────────────

describe("reconcileClubFixtures — newlyFinished", () => {
  it(
    "live → finished transition: populates newlyFinished with the correct fixture id and player ids",
    async () => {
      const AF_ID = 8_880_001;
      const club = await insertClub("__NF Club Live Finished__");
      const playerId1 = await insertPlayer(club.id, "lf-1");
      const playerId2 = await insertPlayer(club.id, "lf-2");

      const fixtureId = await insertFixture({ apiFootballFixtureId: AF_ID, status: "live" });
      await linkPlayer(fixtureId, playerId1, club.id);
      await linkPlayer(fixtureId, playerId2, club.id);

      const freshById = new Map([[AF_ID, makeFinishedAfFixture(AF_ID)]]);

      const result = await reconcileClubFixtures({
        club,
        clubPlayerIds: [playerId1, playerId2],
        freshById,
        removalsTrustworthy: true,
        now: Date.now(),
      });

      expect(result.newlyFinished).toHaveLength(1);

      const entry = result.newlyFinished[0]!;
      expect(entry.fixtureId, "newlyFinished entry must carry the DB fixture id").toBe(fixtureId);
      expect(entry.playerIds, "newlyFinished entry must carry all tracked club player ids").toEqual(
        expect.arrayContaining([playerId1, playerId2]),
      );
      expect(entry.playerIds).toHaveLength(2);

      // Confirm the DB row was also updated
      const [row] = await db
        .select({ status: fixturesTable.status })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, fixtureId));
      expect(row?.status).toBe("finished");
    },
    30_000,
  );

  it(
    "scheduled → finished transition: also appears in newlyFinished (skipped live phase)",
    async () => {
      const AF_ID = 8_880_002;
      const club = await insertClub("__NF Club Sched Finished__");
      const playerId = await insertPlayer(club.id, "sf-1");

      const fixtureId = await insertFixture({ apiFootballFixtureId: AF_ID, status: "scheduled" });
      await linkPlayer(fixtureId, playerId, club.id);

      const freshById = new Map([[AF_ID, makeFinishedAfFixture(AF_ID)]]);

      const result = await reconcileClubFixtures({
        club,
        clubPlayerIds: [playerId],
        freshById,
        removalsTrustworthy: true,
        now: Date.now(),
      });

      expect(result.newlyFinished).toHaveLength(1);

      const entry = result.newlyFinished[0]!;
      expect(entry.fixtureId).toBe(fixtureId);
      expect(entry.playerIds).toContain(playerId);

      const [row] = await db
        .select({ status: fixturesTable.status })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, fixtureId));
      expect(row?.status).toBe("finished");
    },
    30_000,
  );

  it(
    "already-finished fixture does NOT appear in newlyFinished on a second reconciliation pass",
    async () => {
      const AF_ID = 8_880_003;
      const club = await insertClub("__NF Club Already Finished__");
      const playerId = await insertPlayer(club.id, "af-1");

      // Insert as "finished" — simulates a fixture already processed by a prior run
      const fixtureId = await insertFixture({ apiFootballFixtureId: AF_ID, status: "finished" });
      await linkPlayer(fixtureId, playerId, club.id);

      const freshById = new Map([[AF_ID, makeFinishedAfFixture(AF_ID)]]);

      const result = await reconcileClubFixtures({
        club,
        clubPlayerIds: [playerId],
        freshById,
        removalsTrustworthy: true,
        now: Date.now(),
      });

      // The DB query in reconcileClubFixtures filters to scheduled/live only,
      // so a stored "finished" fixture is invisible to the reconciliation loop
      // and can never appear in newlyFinished.
      expect(
        result.newlyFinished,
        "A fixture already stored as 'finished' must not re-appear in newlyFinished",
      ).toHaveLength(0);
    },
    30_000,
  );
});
