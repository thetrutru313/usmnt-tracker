/**
 * Integration guard: confirms that `purgePhantomNtFixtures` correctly deletes
 * upcoming seeded NT fixture rows (and their fixture_players links) when no
 * matching entry exists in the API-Football USMNT fixture list, and leaves rows
 * alone when a match IS found or the kickoff is beyond the 90-day window.
 *
 * ## Why this matters
 * Task #376 added the purge guard to prevent speculative seed entries from
 * surviving more than one sync cycle.  Without a test, a regression in the loop
 * logic — off-by-one on the 90-day boundary, a delete that skips
 * `fixture_players`, or a wrong `ONE_DAY_MS` reuse — would silently re-enable
 * the phantom-fixture pattern.
 *
 * ## What is tested
 * 1. **Phantom purged** — unbound NT fixture within 90 days, absent from
 *    `afFixtures` → fixture row and fixture_players link are deleted;
 *    `phantomsPurged === 1`.
 * 2. **Match found, kept** — same setup but `afFixtures` contains an entry
 *    within ±1 day of the kickoff → fixture is NOT deleted;
 *    `phantomsPurged === 0`.
 * 3. **Beyond 90-day window, kept** — kickoff 91 days out, absent from
 *    `afFixtures` → fixture is NOT deleted (API-Football may not have it yet);
 *    `phantomsPurged === 0`.
 *
 * ## How it works
 * - Inserts minimal real DB rows (club, player, fixture, fixture_players).
 * - Calls `purgePhantomNtFixtures` directly, supplying a controlled
 *   `afFixtures` list and a pinned `nowMs` — no HTTP mocking required.
 * - Asserts DB state after the call.
 * - `afterAll` cleans up any rows that survived (belt-and-suspenders: tests
 *   that confirm deletion clear their own IDs so afterAll is a no-op for them).
 */

import { describe, it, expect, afterAll } from "vitest";
import { db, clubsTable, playersTable, fixturesTable, fixturePlayersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { purgePhantomNtFixtures } from "../apiFootballSync.js";
import type { AfFixture } from "../fixtureReconciliation.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Minimal AfFixture shape — only the fields purgePhantomNtFixtures inspects. */
function makeAfFixture(kickoffIso: string): AfFixture {
  return {
    fixture: {
      id: Math.floor(Math.random() * 9_000_000) + 1_000_000,
      date: kickoffIso,
      status: { short: "NS", elapsed: null },
      venue: { name: "Test Venue" },
    },
    league: { name: "International Friendly" },
    teams: {
      home: { id: 1, name: "USA", logo: null },
      away: { id: 2, name: "Germany", logo: null },
    },
    goals: { home: null, away: null },
  };
}

const basePlayer = {
  position: "MF" as const,
  category: "current" as const,
  age: 25,
  nationalTeamCaps: 5,
  nationalTeamGoals: 0,
  bio: "",
  worldCupRoster: false,
};

// ─── shared cleanup registry ──────────────────────────────────────────────────

// Each test registers IDs here so afterAll can clean up whatever was left
// behind (e.g. if the test asserted deletion and the test passed, but the
// deletion itself is part of what we're testing — we still want the guard).
const cleanup: {
  clubIds: number[];
  playerIds: number[];
  fixtureIds: number[];
} = { clubIds: [], playerIds: [], fixtureIds: [] };

afterAll(async () => {
  for (const fid of cleanup.fixtureIds) {
    await db.delete(fixturePlayersTable).where(eq(fixturePlayersTable.fixtureId, fid)).catch(() => {});
    await db.delete(fixturesTable).where(eq(fixturesTable.id, fid)).catch(() => {});
  }
  for (const pid of cleanup.playerIds) {
    await db.delete(playersTable).where(eq(playersTable.id, pid)).catch(() => {});
  }
  for (const cid of cleanup.clubIds) {
    await db.delete(clubsTable).where(eq(clubsTable.id, cid)).catch(() => {});
  }
});

// ─── suites ──────────────────────────────────────────────────────────────────

describe("purgePhantomNtFixtures — Case 1: phantom fixture within 90 days, absent from API-Football", () => {
  it(
    "deletes the fixture row and its fixture_players link; returns phantomsPurged=1",
    async () => {
      // ── Setup ──────────────────────────────────────────────────────────────
      const [club] = await db
        .insert(clubsTable)
        .values({ name: "__test_phantom_nt_club_1__", league: "Test League", country: "USA" })
        .returning({ id: clubsTable.id });
      if (!club) throw new Error("Club insert failed");
      cleanup.clubIds.push(club.id);

      const [player] = await db
        .insert(playersTable)
        .values({
          ...basePlayer,
          name: "__Test Phantom NT Player 1__",
          slug: "__test-phantom-nt-player-1__",
          clubId: club.id,
        })
        .returning({ id: playersTable.id });
      if (!player) throw new Error("Player insert failed");
      cleanup.playerIds.push(player.id);

      // NT fixture: no api_football_fixture_id, kickoff ~30 days out.
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
      const nowMs = Date.now();
      const kickoff = new Date(nowMs + THIRTY_DAYS_MS);

      const [fixture] = await db
        .insert(fixturesTable)
        .values({
          isNationalTeam: true,
          competition: "International Friendly",
          kickoff,
          venue: "Test Stadium",
          homeTeam: "USA",
          awayTeam: "__Phantom Opponent__",
          status: "scheduled",
          // No apiFootballFixtureId — seeded phantom row
        })
        .returning({ id: fixturesTable.id });
      if (!fixture) throw new Error("Fixture insert failed");
      cleanup.fixtureIds.push(fixture.id);

      // Link the player to the fixture (simulates a seed that created a link).
      await db
        .insert(fixturePlayersTable)
        .values({ fixtureId: fixture.id, playerId: player.id, clubId: club.id });

      // ── Pre-conditions ─────────────────────────────────────────────────────
      const beforeFixture = await db
        .select({ id: fixturesTable.id })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, fixture.id));
      expect(beforeFixture).toHaveLength(1);

      const beforeLinks = await db
        .select({ fixtureId: fixturePlayersTable.fixtureId })
        .from(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, fixture.id));
      expect(beforeLinks).toHaveLength(1);

      // ── Invoke purge loop ──────────────────────────────────────────────────
      // afFixtures is empty — no API-Football knowledge of this fixture.
      const result = await purgePhantomNtFixtures(
        [{ id: fixture.id, apiFootballFixtureId: null, kickoff, homeTeam: "USA", awayTeam: "__Phantom Opponent__" }],
        [], // no afFixtures
        nowMs,
      );

      // ── Assertions ─────────────────────────────────────────────────────────
      expect(result.phantomsPurged).toBe(1);
      expect(result.failures).toBe(0);

      const afterFixture = await db
        .select({ id: fixturesTable.id })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, fixture.id));
      expect(
        afterFixture,
        `NT fixture id=${fixture.id} should have been purged (unbound, within 90 days, absent from afFixtures) but still exists`,
      ).toHaveLength(0);

      const afterLinks = await db
        .select({ fixtureId: fixturePlayersTable.fixtureId })
        .from(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, fixture.id));
      expect(
        afterLinks,
        `fixture_players link for phantom fixture id=${fixture.id} should have been deleted alongside the fixture row but still exists`,
      ).toHaveLength(0);

      // Rows already deleted — clear from cleanup registry so afterAll is a no-op.
      cleanup.fixtureIds.splice(cleanup.fixtureIds.indexOf(fixture.id), 1);
    },
    30_000,
  );
});

describe("purgePhantomNtFixtures — Case 2: matching afFixture within ±1 day, row is kept", () => {
  it(
    "does NOT delete the fixture row when afFixtures contains a matching entry; returns phantomsPurged=0",
    async () => {
      // ── Setup ──────────────────────────────────────────────────────────────
      const [club] = await db
        .insert(clubsTable)
        .values({ name: "__test_phantom_nt_club_2__", league: "Test League", country: "USA" })
        .returning({ id: clubsTable.id });
      if (!club) throw new Error("Club insert failed");
      cleanup.clubIds.push(club.id);

      const [player] = await db
        .insert(playersTable)
        .values({
          ...basePlayer,
          name: "__Test Phantom NT Player 2__",
          slug: "__test-phantom-nt-player-2__",
          clubId: club.id,
        })
        .returning({ id: playersTable.id });
      if (!player) throw new Error("Player insert failed");
      cleanup.playerIds.push(player.id);

      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
      const nowMs = Date.now();
      const kickoff = new Date(nowMs + THIRTY_DAYS_MS);

      const [fixture] = await db
        .insert(fixturesTable)
        .values({
          isNationalTeam: true,
          competition: "International Friendly",
          kickoff,
          venue: "Test Stadium",
          homeTeam: "USA",
          awayTeam: "__Real Opponent__",
          status: "scheduled",
        })
        .returning({ id: fixturesTable.id });
      if (!fixture) throw new Error("Fixture insert failed");
      cleanup.fixtureIds.push(fixture.id);

      await db
        .insert(fixturePlayersTable)
        .values({ fixtureId: fixture.id, playerId: player.id, clubId: club.id });

      // ── Invoke purge loop with a matching afFixture ────────────────────────
      // The afFixture's date is the same as the kickoff — well within ±1 day.
      const matchingAfFixture = makeAfFixture(kickoff.toISOString());

      const result = await purgePhantomNtFixtures(
        [{ id: fixture.id, apiFootballFixtureId: null, kickoff, homeTeam: "USA", awayTeam: "__Real Opponent__" }],
        [matchingAfFixture],
        nowMs,
      );

      // ── Assertions ─────────────────────────────────────────────────────────
      expect(result.phantomsPurged).toBe(0);
      expect(result.failures).toBe(0);

      const afterFixture = await db
        .select({ id: fixturesTable.id })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, fixture.id));
      expect(
        afterFixture,
        `NT fixture id=${fixture.id} should NOT have been purged (a matching afFixture exists within ±1 day) but was deleted`,
      ).toHaveLength(1);

      const afterLinks = await db
        .select({ fixtureId: fixturePlayersTable.fixtureId })
        .from(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, fixture.id));
      expect(
        afterLinks,
        `fixture_players link for fixture id=${fixture.id} should still exist (fixture was NOT a phantom) but was deleted`,
      ).toHaveLength(1);
    },
    30_000,
  );
});

describe("purgePhantomNtFixtures — Case 3: kickoff beyond 90-day window, row is kept", () => {
  it(
    "does NOT delete a fixture whose kickoff is >90 days out, even with empty afFixtures; returns phantomsPurged=0",
    async () => {
      // ── Setup ──────────────────────────────────────────────────────────────
      const [club] = await db
        .insert(clubsTable)
        .values({ name: "__test_phantom_nt_club_3__", league: "Test League", country: "USA" })
        .returning({ id: clubsTable.id });
      if (!club) throw new Error("Club insert failed");
      cleanup.clubIds.push(club.id);

      const [player] = await db
        .insert(playersTable)
        .values({
          ...basePlayer,
          name: "__Test Phantom NT Player 3__",
          slug: "__test-phantom-nt-player-3__",
          clubId: club.id,
        })
        .returning({ id: playersTable.id });
      if (!player) throw new Error("Player insert failed");
      cleanup.playerIds.push(player.id);

      // 91 days out — just beyond the 90-day purge window.
      const NINETY_ONE_DAYS_MS = 91 * 24 * 60 * 60 * 1000;
      const nowMs = Date.now();
      const kickoff = new Date(nowMs + NINETY_ONE_DAYS_MS);

      const [fixture] = await db
        .insert(fixturesTable)
        .values({
          isNationalTeam: true,
          competition: "International Friendly",
          kickoff,
          venue: "Test Stadium",
          homeTeam: "USA",
          awayTeam: "__Far Future Opponent__",
          status: "scheduled",
        })
        .returning({ id: fixturesTable.id });
      if (!fixture) throw new Error("Fixture insert failed");
      cleanup.fixtureIds.push(fixture.id);

      await db
        .insert(fixturePlayersTable)
        .values({ fixtureId: fixture.id, playerId: player.id, clubId: club.id });

      // ── Invoke purge loop with empty afFixtures ────────────────────────────
      const result = await purgePhantomNtFixtures(
        [{ id: fixture.id, apiFootballFixtureId: null, kickoff, homeTeam: "USA", awayTeam: "__Far Future Opponent__" }],
        [], // no afFixtures — API-Football doesn't have it yet because it's too far out
        nowMs,
      );

      // ── Assertions ─────────────────────────────────────────────────────────
      expect(result.phantomsPurged).toBe(0);
      expect(result.failures).toBe(0);

      const afterFixture = await db
        .select({ id: fixturesTable.id })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, fixture.id));
      expect(
        afterFixture,
        `NT fixture id=${fixture.id} is 91 days out and should NOT have been purged ` +
          `(beyond the 90-day window where API-Football reliably lists fixtures) but was deleted`,
      ).toHaveLength(1);

      const afterLinks = await db
        .select({ fixtureId: fixturePlayersTable.fixtureId })
        .from(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, fixture.id));
      expect(
        afterLinks,
        `fixture_players link for fixture id=${fixture.id} should still exist (fixture is beyond the 90-day window) but was deleted`,
      ).toHaveLength(1);
    },
    30_000,
  );
});
