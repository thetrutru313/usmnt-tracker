/**
 * Confirms that purgeStalePostponedFixtures correctly removes postponed
 * fixtures whose original kickoff was more than 24 hours ago, while leaving
 * recently-postponed fixtures (still within the grace window) untouched.
 *
 * ## Why this matters
 * API-Football uses `PST` for both same-day weather delays (game starts a few
 * hours late) and true reschedules/cancellations. The 24-hour grace window
 * means a weather-delayed game is never wrongly deleted during the delay, but
 * a cancelled or rescheduled game doesn't hang in the upcoming section
 * indefinitely once its original kickoff has long passed.
 *
 * ## What is tested
 * 1. A postponed fixture with kickoff 25 hours in the past is deleted.
 * 2. Its linked fixture_players row is also deleted.
 * 3. A postponed fixture with kickoff 23 hours in the past is kept.
 * 4. A scheduled fixture (not postponed) is never touched, regardless of age.
 */

import { describe, it, expect, afterAll } from "vitest";
import { db, clubsTable, playersTable, fixturesTable, fixturePlayersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { purgeStalePostponedFixtures } from "../fixtureReconciliation.js";

// ─── cleanup tracking ────────────────────────────────────────────────────────

const insertedFixtureIds: number[] = [];
const insertedPlayerIds: number[] = [];
let insertedClubId: number | null = null;

afterAll(async () => {
  if (insertedFixtureIds.length > 0) {
    await db.delete(fixturePlayersTable).where(inArray(fixturePlayersTable.fixtureId, insertedFixtureIds));
    await db.delete(fixturesTable).where(inArray(fixturesTable.id, insertedFixtureIds));
  }
  if (insertedPlayerIds.length > 0) {
    await db.delete(playersTable).where(inArray(playersTable.id, insertedPlayerIds));
  }
  if (insertedClubId !== null) {
    await db.delete(clubsTable).where(eq(clubsTable.id, insertedClubId));
  }
});

// ─── helpers ────────────────────────────────────────────────────────────────

/** Insert a minimal fixture row and return its id. */
async function insertFixture(opts: {
  status: "postponed" | "scheduled";
  kickoff: Date;
}): Promise<number> {
  const [row] = await db
    .insert(fixturesTable)
    .values({
      homeTeam: "Test Home",
      awayTeam: "Test Away",
      kickoff: opts.kickoff,
      status: opts.status,
      competition: "Test League",
      venue: "Test Stadium",
      isNationalTeam: false,
    })
    .returning({ id: fixturesTable.id });
  if (!row) throw new Error("Fixture insert failed");
  insertedFixtureIds.push(row.id);
  return row.id;
}

/** Link a player to a fixture and return the fixture id for convenience. */
async function linkPlayer(fixtureId: number, playerId: number): Promise<void> {
  await db.insert(fixturePlayersTable).values({ fixtureId, playerId });
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("purgeStalePostponedFixtures", () => {
  it("deletes a postponed fixture whose kickoff was 25 hours ago", async () => {
    const now = Date.now();
    const kickoff25hAgo = new Date(now - 25 * 60 * 60 * 1000);

    const fixtureId = await insertFixture({ status: "postponed", kickoff: kickoff25hAgo });

    const { purged } = await purgeStalePostponedFixtures(now);

    expect(purged).toBeGreaterThanOrEqual(1);

    const remaining = await db
      .select({ id: fixturesTable.id })
      .from(fixturesTable)
      .where(eq(fixturesTable.id, fixtureId));

    expect(remaining).toHaveLength(0);

    // Remove from cleanup list — already deleted by purge
    const idx = insertedFixtureIds.indexOf(fixtureId);
    if (idx !== -1) insertedFixtureIds.splice(idx, 1);
  }, 15_000);

  it("also deletes the fixture_players rows linked to a purged fixture", async () => {
    const now = Date.now();
    const kickoff25hAgo = new Date(now - 25 * 60 * 60 * 1000);

    // Need a player to link — reuse or create a minimal one
    if (insertedClubId === null) {
      const [club] = await db
        .insert(clubsTable)
        .values({ name: "Purge Test Club", league: "Test League", country: "US" })
        .returning({ id: clubsTable.id });
      insertedClubId = club!.id;
    }
    const [player] = await db
      .insert(playersTable)
      .values({ name: "Purge Test Player", slug: "purge-test-player", age: 25, clubId: insertedClubId, position: "MF", category: "pool" })
      .returning({ id: playersTable.id });
    insertedPlayerIds.push(player!.id);

    const fixtureId = await insertFixture({ status: "postponed", kickoff: kickoff25hAgo });
    await linkPlayer(fixtureId, player!.id);

    await purgeStalePostponedFixtures(now);

    // fixture_players row should be gone
    const remainingLinks = await db
      .select()
      .from(fixturePlayersTable)
      .where(eq(fixturePlayersTable.fixtureId, fixtureId));
    expect(remainingLinks).toHaveLength(0);

    // fixture row should be gone
    const remainingFixtures = await db
      .select({ id: fixturesTable.id })
      .from(fixturesTable)
      .where(eq(fixturesTable.id, fixtureId));
    expect(remainingFixtures).toHaveLength(0);

    // Remove from cleanup list — already deleted
    const idx = insertedFixtureIds.indexOf(fixtureId);
    if (idx !== -1) insertedFixtureIds.splice(idx, 1);
  }, 15_000);

  it("keeps a postponed fixture whose kickoff was only 23 hours ago", async () => {
    const now = Date.now();
    const kickoff23hAgo = new Date(now - 23 * 60 * 60 * 1000);

    const fixtureId = await insertFixture({ status: "postponed", kickoff: kickoff23hAgo });

    await purgeStalePostponedFixtures(now);

    const remaining = await db
      .select({ id: fixturesTable.id })
      .from(fixturesTable)
      .where(eq(fixturesTable.id, fixtureId));

    expect(remaining).toHaveLength(1);
    // will be cleaned up by afterAll
  }, 15_000);

  it("never touches a scheduled fixture regardless of age", async () => {
    const now = Date.now();
    const oldKickoff = new Date(now - 48 * 60 * 60 * 1000);

    const fixtureId = await insertFixture({ status: "scheduled", kickoff: oldKickoff });

    await purgeStalePostponedFixtures(now);

    const remaining = await db
      .select({ id: fixturesTable.id })
      .from(fixturesTable)
      .where(eq(fixturesTable.id, fixtureId));

    expect(remaining).toHaveLength(1);
    // will be cleaned up by afterAll
  }, 15_000);

  it("returns purged: 0 when no stale postponed fixtures exist", async () => {
    // Use a 'now' far in the past so nothing currently in the DB qualifies
    const ancientNow = new Date("2000-01-01").getTime();
    const { purged } = await purgeStalePostponedFixtures(ancientNow);
    expect(purged).toBe(0);
  }, 15_000);
});
