/**
 * Integration guard: confirms that `purgePhantomYouthNtFixtures` correctly
 * deletes upcoming youth NT fixture rows (and their fixture_players links) when
 * the fixture's api_football_fixture_id is absent from the API-Football result
 * set for its age-group team, and leaves rows alone when the fixture is already
 * finished or its id IS present in the result set.
 *
 * ## Why this matters
 * Task #422 added `purgePhantomYouthNtFixtures` to stop cancelled youth NT
 * fixtures from persisting on the Fixtures page indefinitely after a sync.
 * Without a test, a regression in the ownership-detection logic — wrong age-
 * group extraction, a missing status guard, or an incorrect set-membership
 * check — would silently re-enable phantom fixture rows.
 *
 * ## What is tested
 * 1. **Phantom purged** — future youth NT fixture whose api_football_fixture_id
 *    is absent from the team's seenAfIds set → fixture row and fixture_players
 *    link are deleted; `phantomsPurged === 1`.
 * 2. **Finished fixture kept** — same missing-id setup but the fixture's status
 *    is "finished" → fixture is NOT deleted; `phantomsPurged === 0`.
 * 3. **ID in seenAfIds, kept** — future youth NT fixture whose
 *    api_football_fixture_id IS in seenAfIds → fixture is NOT deleted;
 *    `phantomsPurged === 0`.
 *
 * ## How it works
 * - Inserts minimal real DB rows (club, player, fixture, fixture_players).
 * - Calls `purgePhantomYouthNtFixtures` directly, supplying controlled
 *   `teamResults` and a pinned `nowMs` — no HTTP mocking required.
 * - Asserts DB state after the call.
 * - `afterAll` cleans up any rows that survived (belt-and-suspenders: tests
 *   that confirm deletion clear their own IDs so afterAll is a no-op for them).
 */

import { describe, it, expect, afterAll } from "vitest";
import { db, clubsTable, playersTable, fixturesTable, fixturePlayersTable } from "@workspace/db";
import { and, eq, isNotNull } from "drizzle-orm";
import { purgePhantomYouthNtFixtures } from "../apiFootballSync.js";
import type { YouthTeamFetchResult } from "../apiFootballSync.js";

// ─── constants ────────────────────────────────────────────────────────────────

/** Fake api_football_fixture_id for the phantom fixture (Case 1). */
const FAKE_PHANTOM_AF_ID = 9_901_001;

/** Fake api_football_fixture_id for the finished fixture (Case 2). */
const FAKE_FINISHED_AF_ID = 9_901_002;

/** Fake api_football_fixture_id for the kept fixture (Case 3). */
const FAKE_KEPT_AF_ID = 9_901_003;

/** A minimal team-result for the US U20 team with a complete fetch. */
function makeU20TeamResult(seenAfIds: Set<number>): YouthTeamFetchResult {
  return {
    teamId: 10306, // real US U20 team id — only used for logging, not for the purge logic
    label: "US U20",
    seenAfIds,
    fetchComplete: true,
  };
}

/**
 * Returns a Set of all api_football_fixture_ids currently in the DB for
 * future, non-finished, bound (afId IS NOT NULL) national-team fixtures.
 *
 * Used to pre-populate `seenAfIds` so the purge function considers existing
 * rows as "still returned by the API" and only evaluates the test row we
 * just inserted.  Without this, real future youth NT fixtures would also be
 * purged because their IDs would be missing from our controlled set.
 */
async function loadExistingYouthNtAfIds(): Promise<Set<number>> {
  const rows = await db
    .select({ afId: fixturesTable.apiFootballFixtureId })
    .from(fixturesTable)
    .where(and(eq(fixturesTable.isNationalTeam, true), isNotNull(fixturesTable.apiFootballFixtureId)));
  const ids = new Set<number>();
  for (const row of rows) {
    if (row.afId !== null) ids.add(row.afId);
  }
  return ids;
}

const basePlayer = {
  position: "MF" as const,
  category: "current" as const,
  age: 21,
  nationalTeamCaps: 3,
  nationalTeamGoals: 0,
  bio: "",
  worldCupRoster: false,
};

// ─── shared cleanup registry ──────────────────────────────────────────────────

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

describe("purgePhantomYouthNtFixtures — Case 1: phantom fixture absent from seenAfIds", () => {
  it(
    "deletes the fixture row and its fixture_players link; returns phantomsPurged=1",
    async () => {
      // ── Setup ──────────────────────────────────────────────────────────────
      const [club] = await db
        .insert(clubsTable)
        .values({ name: "__test_youth_phantom_club_1__", league: "Test League", country: "USA" })
        .returning({ id: clubsTable.id });
      if (!club) throw new Error("Club insert failed");
      cleanup.clubIds.push(club.id);

      const [player] = await db
        .insert(playersTable)
        .values({
          ...basePlayer,
          name: "__Test Youth Phantom NT Player 1__",
          slug: "__test-youth-phantom-nt-player-1__",
          clubId: club.id,
        })
        .returning({ id: playersTable.id });
      if (!player) throw new Error("Player insert failed");
      cleanup.playerIds.push(player.id);

      // Youth NT fixture: has api_football_fixture_id, kickoff ~30 days out.
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
      const nowMs = Date.now();
      const kickoff = new Date(nowMs + THIRTY_DAYS_MS);

      // Snapshot all existing bound youth NT fixture IDs *before* inserting the
      // test row.  These will be passed as seenAfIds so the purge treats every
      // pre-existing fixture as "still returned by the API" and only evaluates
      // the row we're about to insert.
      const existingAfIds = await loadExistingYouthNtAfIds();

      const [fixture] = await db
        .insert(fixturesTable)
        .values({
          isNationalTeam: true,
          competition: "World Cup - U20",
          kickoff,
          venue: "Youth Test Stadium",
          homeTeam: "USA U20",
          awayTeam: "Brazil U20",
          status: "scheduled",
          apiFootballFixtureId: FAKE_PHANTOM_AF_ID,
        })
        .returning({ id: fixturesTable.id });
      if (!fixture) throw new Error("Fixture insert failed");
      cleanup.fixtureIds.push(fixture.id);

      // Link the player to the fixture.
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

      // ── Invoke purge ───────────────────────────────────────────────────────
      // Build seenAfIds from the IDs already in the DB *before* we inserted the
      // test fixture.  This shields real rows from being treated as phantoms
      // while leaving FAKE_PHANTOM_AF_ID out of the set — which is the scenario
      // under test: API-Football no longer returns this fixture.
      const result = await purgePhantomYouthNtFixtures(
        [makeU20TeamResult(existingAfIds)],
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
        `Youth NT fixture id=${fixture.id} (afId=${FAKE_PHANTOM_AF_ID}) should have been purged ` +
          `(future, bound, absent from seenAfIds) but still exists`,
      ).toHaveLength(0);

      const afterLinks = await db
        .select({ fixtureId: fixturePlayersTable.fixtureId })
        .from(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, fixture.id));
      expect(
        afterLinks,
        `fixture_players link for phantom youth NT fixture id=${fixture.id} should have been ` +
          `deleted alongside the fixture row but still exists`,
      ).toHaveLength(0);

      // Rows already deleted — remove from cleanup registry.
      cleanup.fixtureIds.splice(cleanup.fixtureIds.indexOf(fixture.id), 1);
    },
    30_000,
  );
});

describe("purgePhantomYouthNtFixtures — Case 2: finished fixture with missing id is NOT deleted", () => {
  it(
    "does NOT delete a finished youth NT fixture even when its id is absent from seenAfIds; returns phantomsPurged=0",
    async () => {
      // ── Setup ──────────────────────────────────────────────────────────────
      const [club] = await db
        .insert(clubsTable)
        .values({ name: "__test_youth_phantom_club_2__", league: "Test League", country: "USA" })
        .returning({ id: clubsTable.id });
      if (!club) throw new Error("Club insert failed");
      cleanup.clubIds.push(club.id);

      const [player] = await db
        .insert(playersTable)
        .values({
          ...basePlayer,
          name: "__Test Youth Phantom NT Player 2__",
          slug: "__test-youth-phantom-nt-player-2__",
          clubId: club.id,
        })
        .returning({ id: playersTable.id });
      if (!player) throw new Error("Player insert failed");
      cleanup.playerIds.push(player.id);

      // Finished youth NT fixture: kickoff is in the past, status is "finished".
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;
      const nowMs = Date.now();
      const kickoff = new Date(nowMs - ONE_DAY_MS); // yesterday — already played

      // Pre-snapshot existing IDs so real future rows stay protected.
      const existingAfIds = await loadExistingYouthNtAfIds();

      const [fixture] = await db
        .insert(fixturesTable)
        .values({
          isNationalTeam: true,
          competition: "World Cup - U20",
          kickoff,
          venue: "Youth Test Stadium",
          homeTeam: "USA U20",
          awayTeam: "Mexico U20",
          status: "finished",
          apiFootballFixtureId: FAKE_FINISHED_AF_ID,
        })
        .returning({ id: fixturesTable.id });
      if (!fixture) throw new Error("Fixture insert failed");
      cleanup.fixtureIds.push(fixture.id);

      await db
        .insert(fixturePlayersTable)
        .values({ fixtureId: fixture.id, playerId: player.id, clubId: club.id });

      // ── Invoke purge ───────────────────────────────────────────────────────
      // seenAfIds covers all real future fixtures but does NOT include
      // FAKE_FINISHED_AF_ID.  The status + past-kickoff guard must prevent
      // deletion of finished/past fixtures regardless of the seen set.
      const result = await purgePhantomYouthNtFixtures(
        [makeU20TeamResult(existingAfIds)],
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
        `Finished youth NT fixture id=${fixture.id} should NOT have been purged ` +
          `(status=finished is a historical record) but was deleted`,
      ).toHaveLength(1);

      const afterLinks = await db
        .select({ fixtureId: fixturePlayersTable.fixtureId })
        .from(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, fixture.id));
      expect(
        afterLinks,
        `fixture_players link for finished fixture id=${fixture.id} should still exist but was deleted`,
      ).toHaveLength(1);
    },
    30_000,
  );
});

describe("purgePhantomYouthNtFixtures — Case 3: fixture id present in seenAfIds is NOT deleted", () => {
  it(
    "does NOT delete a future youth NT fixture whose id IS in seenAfIds; returns phantomsPurged=0",
    async () => {
      // ── Setup ──────────────────────────────────────────────────────────────
      const [club] = await db
        .insert(clubsTable)
        .values({ name: "__test_youth_phantom_club_3__", league: "Test League", country: "USA" })
        .returning({ id: clubsTable.id });
      if (!club) throw new Error("Club insert failed");
      cleanup.clubIds.push(club.id);

      const [player] = await db
        .insert(playersTable)
        .values({
          ...basePlayer,
          name: "__Test Youth Phantom NT Player 3__",
          slug: "__test-youth-phantom-nt-player-3__",
          clubId: club.id,
        })
        .returning({ id: playersTable.id });
      if (!player) throw new Error("Player insert failed");
      cleanup.playerIds.push(player.id);

      // Future youth NT fixture: api_football_fixture_id IS in the seen set.
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
      const nowMs = Date.now();
      const kickoff = new Date(nowMs + THIRTY_DAYS_MS);

      // Pre-snapshot existing IDs so real future rows stay protected.
      const existingAfIds = await loadExistingYouthNtAfIds();

      const [fixture] = await db
        .insert(fixturesTable)
        .values({
          isNationalTeam: true,
          competition: "World Cup - U20",
          kickoff,
          venue: "Youth Test Stadium",
          homeTeam: "USA U20",
          awayTeam: "Colombia U20",
          status: "scheduled",
          apiFootballFixtureId: FAKE_KEPT_AF_ID,
        })
        .returning({ id: fixturesTable.id });
      if (!fixture) throw new Error("Fixture insert failed");
      cleanup.fixtureIds.push(fixture.id);

      await db
        .insert(fixturePlayersTable)
        .values({ fixtureId: fixture.id, playerId: player.id, clubId: club.id });

      // ── Invoke purge ───────────────────────────────────────────────────────
      // seenAfIds covers all real future fixtures AND includes FAKE_KEPT_AF_ID —
      // API-Football still returns this fixture, so it must be left alone.
      const seenAfIds = new Set([...existingAfIds, FAKE_KEPT_AF_ID]);
      const result = await purgePhantomYouthNtFixtures(
        [makeU20TeamResult(seenAfIds)],
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
        `Youth NT fixture id=${fixture.id} (afId=${FAKE_KEPT_AF_ID}) should NOT have been purged ` +
          `(its id IS in seenAfIds — API-Football still returns it) but was deleted`,
      ).toHaveLength(1);

      const afterLinks = await db
        .select({ fixtureId: fixturePlayersTable.fixtureId })
        .from(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, fixture.id));
      expect(
        afterLinks,
        `fixture_players link for fixture id=${fixture.id} should still exist (fixture was kept) but was deleted`,
      ).toHaveLength(1);
    },
    30_000,
  );
});
