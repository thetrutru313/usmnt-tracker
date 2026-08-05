/**
 * Regression guard: confirms that `purgePhantomNtFixtures` treats fixtures
 * with a negative api_football_fixture_id (sentinel values for officially-
 * announced matches seeded before the feed publishes them) as protected from
 * phantom purging, even when no API-Football entry is found within ±1 day.
 *
 * ## Why this matters
 * Task #614 seeded 4 officially-announced USMNT friendlies using sentinel
 * negative IDs (-2001…-2004). The phantom purge logic must NOT delete these
 * rows just because API-Football hasn't published them yet — they are known
 * real matches. Only rows with `api_football_fixture_id IS NULL` are eligible
 * for the phantom check.
 *
 * ## What is tested
 * 1. **Sentinel kept** — a fixture with a negative api_football_fixture_id and
 *    no matching afFixture within the 90-day window is NOT purged.
 * 2. **Null still purged** — a fixture with no api_football_fixture_id (null)
 *    and no matching afFixture within 90 days IS purged (existing behaviour).
 *
 * ## How it works
 * - Inserts minimal NT fixture rows directly into the DB.
 * - Calls `purgePhantomNtFixtures` directly with an empty `afFixtures` list.
 * - Asserts DB state after the call.
 * - afterAll removes any rows that survived.
 */

import { describe, it, expect, afterAll } from "vitest";
import { db, fixturesTable, fixturePlayersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { purgePhantomNtFixtures } from "../apiFootballSync.js";

// ─── cleanup registry ─────────────────────────────────────────────────────────

const cleanup: { fixtureIds: number[] } = { fixtureIds: [] };

afterAll(async () => {
  for (const fid of cleanup.fixtureIds) {
    await db.delete(fixturePlayersTable).where(eq(fixturePlayersTable.fixtureId, fid)).catch(() => {});
    await db.delete(fixturesTable).where(eq(fixturesTable.id, fid)).catch(() => {});
  }
});

// ─── suites ───────────────────────────────────────────────────────────────────

describe("purgePhantomNtFixtures — sentinel (negative api_football_fixture_id) is protected", () => {
  it(
    "does NOT purge a negative-sentinel fixture even when no afFixture matches within the 90-day window",
    async () => {
      // Insert a future NT fixture with a negative sentinel ID (within 90 days).
      const kickoff = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const [fixture] = await db
        .insert(fixturesTable)
        .values({
          apiFootballFixtureId: -9902, // negative sentinel
          isNationalTeam: true,
          competition: "International Friendly",
          kickoff,
          venue: "__Sentinel Venue__",
          homeTeam: "USA",
          awayTeam: "__Sentinel Opponent__",
          status: "scheduled",
        })
        .returning({ id: fixturesTable.id });
      if (!fixture) throw new Error("Fixture insert failed");
      cleanup.fixtureIds.push(fixture.id);

      // Call purge with no afFixtures — if the sentinel were treated as null
      // (unbound), it would be purged here.
      const nowMs = Date.now();
      const result = await purgePhantomNtFixtures(
        [
          {
            id: fixture.id,
            apiFootballFixtureId: -9902,
            kickoff,
            homeTeam: "USA",
            awayTeam: "__Sentinel Opponent__",
          },
        ],
        [], // no afFixtures — simulates API-Football not yet publishing the match
        nowMs,
      );

      expect(
        result.phantomsPurged,
        "sentinel fixture should NOT have been purged (phantomsPurged should be 0)",
      ).toBe(0);
      expect(result.failures).toBe(0);

      // Verify the row still exists in the DB.
      const rows = await db
        .select({ id: fixturesTable.id })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, fixture.id));
      expect(
        rows,
        `Sentinel fixture id=${fixture.id} was incorrectly purged — negative sentinel IDs should be protected`,
      ).toHaveLength(1);
    },
    30_000,
  );
});

describe("purgePhantomNtFixtures — null-ID fixture within 90 days is still purged (existing behaviour)", () => {
  it(
    "purges a null-ID NT fixture absent from afFixtures within 90 days",
    async () => {
      const kickoff = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);
      const [fixture] = await db
        .insert(fixturesTable)
        .values({
          // No api_football_fixture_id — truly unbound
          isNationalTeam: true,
          competition: "International Friendly",
          kickoff,
          venue: "__Null ID Venue__",
          homeTeam: "USA",
          awayTeam: "__Null ID Opponent__",
          status: "scheduled",
        })
        .returning({ id: fixturesTable.id });
      if (!fixture) throw new Error("Fixture insert failed");
      cleanup.fixtureIds.push(fixture.id);

      const nowMs = Date.now();
      const result = await purgePhantomNtFixtures(
        [
          {
            id: fixture.id,
            apiFootballFixtureId: null,
            kickoff,
            homeTeam: "USA",
            awayTeam: "__Null ID Opponent__",
          },
        ],
        [],
        nowMs,
      );

      expect(
        result.phantomsPurged,
        "null-ID fixture with no afMatch should have been purged",
      ).toBe(1);

      const rows = await db
        .select({ id: fixturesTable.id })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, fixture.id));
      expect(rows, "null-ID phantom fixture should have been deleted from the DB").toHaveLength(0);

      // Row was deleted by purge — remove from cleanup to avoid a no-op delete.
      cleanup.fixtureIds.splice(cleanup.fixtureIds.indexOf(fixture.id), 1);
    },
    30_000,
  );
});
