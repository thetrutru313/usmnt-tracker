/**
 * Regression guard: confirms that elapsedMinute is cleared to null in the DB
 * when a fixture transitions from live to finished via the reconciliation pass.
 *
 * ## What & Why
 * reconcileClubFixtures sets `elapsedMinute` to null whenever the fresh
 * provider status is anything other than "live". Without an automated test,
 * a future refactor could accidentally preserve the stale elapsed value, which
 * would leave "90'" displayed permanently on finished match cards.
 *
 * ## What is tested
 * 1. A "scheduled" fixture with a stale elapsedMinute (simulating a value left
 *    over from a previous live sync state) is inserted into the DB and linked
 *    to a tracked player.
 * 2. reconcileClubFixtures is called with fresh data reporting the fixture as
 *    "FT" (finished), elapsed=90.
 * 3. After reconciliation the DB row has status="finished" and
 *    elapsedMinute=null — the stale value was not preserved.
 * 4. A second fixture stays "live" with elapsedMinute=45 — ensures the
 *    clearing logic is conditional on status, not applied wholesale.
 *
 * ## How it works
 * Boots the reconciliation function directly (no HTTP, no full sync loop).
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
import { eq } from "drizzle-orm";
import { reconcileClubFixtures, type AfFixture } from "../fixtureReconciliation.js";

// ─── cleanup state ───────────────────────────────────────────────────────────

let cleanupClubId: number | null = null;
let cleanupPlayerId: number | null = null;
let cleanupFinishedFixtureId: number | null = null;
let cleanupLiveFixtureId: number | null = null;

afterAll(async () => {
  for (const fixtureId of [cleanupFinishedFixtureId, cleanupLiveFixtureId]) {
    if (fixtureId !== null) {
      await db.delete(fixturePlayersTable).where(eq(fixturePlayersTable.fixtureId, fixtureId));
      await db.delete(fixturesTable).where(eq(fixturesTable.id, fixtureId));
    }
  }
  if (cleanupPlayerId !== null) {
    await db.delete(playersTable).where(eq(playersTable.id, cleanupPlayerId));
  }
  if (cleanupClubId !== null) {
    await db.delete(clubsTable).where(eq(clubsTable.id, cleanupClubId));
  }
});

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Builds a minimal AfFixture with the given short status and elapsed value. */
function makeAfFixture(apiId: number, short: string, elapsed: number | null): AfFixture {
  return {
    fixture: {
      id: apiId,
      date: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      status: { short, elapsed },
      venue: { name: "Test Stadium" },
    },
    league: { name: "Test League" },
    teams: {
      home: { id: 1, name: "__Elapsed Home FC__", logo: null },
      away: { id: 2, name: "__Elapsed Away FC__", logo: null },
    },
    goals: { home: 2, away: 1 },
  };
}

// ─── suite ───────────────────────────────────────────────────────────────────

describe("reconcileClubFixtures — elapsedMinute clears when fixture finishes", () => {
  it(
    "sets elapsedMinute to null when fresh status is FT, preserves it when still live",
    async () => {
      // ── Setup: club and player ──────────────────────────────────────────────

      const [club] = await db
        .insert(clubsTable)
        .values({ name: "__test_elapsed_clear_club__", league: "Test League", country: "USA" })
        .returning({ id: clubsTable.id, name: clubsTable.name });
      if (!club) throw new Error("Club insert failed");
      cleanupClubId = club.id;

      const [player] = await db
        .insert(playersTable)
        .values({
          name: "__Test Elapsed Clear Player__",
          slug: "__test-elapsed-clear-player__",
          position: "MF" as const,
          category: "current" as const,
          clubId: club.id,
          age: 26,
          nationalTeamCaps: 0,
          nationalTeamGoals: 0,
          bio: "",
          worldCupRoster: false,
        })
        .returning({ id: playersTable.id });
      if (!player) throw new Error("Player insert failed");
      cleanupPlayerId = player.id;

      // ── Setup: fixture 1 — "scheduled" with a stale elapsedMinute ──────────
      // A stale elapsedMinute on a "scheduled" row simulates a value left over
      // from a previous sync pass (e.g. a bug or a data migration quirk).
      // Reconciliation must overwrite it with null when the provider says "FT".
      const pastKickoff = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 h ago
      const AF_ID_FINISHED = 9_998_001;

      const [finishedFixture] = await db
        .insert(fixturesTable)
        .values({
          apiFootballFixtureId: AF_ID_FINISHED,
          isNationalTeam: false,
          competition: "Test League",
          kickoff: pastKickoff,
          venue: "Test Stadium",
          homeTeam: "__Elapsed Home FC__",
          awayTeam: "__Elapsed Away FC__",
          status: "scheduled",
          elapsedMinute: 72, // stale value to prove the guard clears it
        })
        .returning({ id: fixturesTable.id });
      if (!finishedFixture) throw new Error("Finished-fixture insert failed");
      cleanupFinishedFixtureId = finishedFixture.id;

      await db.insert(fixturePlayersTable).values({
        fixtureId: finishedFixture.id,
        playerId: player.id,
        clubId: club.id,
      });

      // ── Setup: fixture 2 — "scheduled" that transitions to live ────────────
      // This fixture goes from scheduled → live in the same reconcile call,
      // proving elapsedMinute is only cleared for non-live outcomes.
      const AF_ID_LIVE = 9_998_002;

      const [liveFixture] = await db
        .insert(fixturesTable)
        .values({
          apiFootballFixtureId: AF_ID_LIVE,
          isNationalTeam: false,
          competition: "Test League",
          kickoff: new Date(Date.now() - 45 * 60 * 1000), // kicked off 45 min ago
          venue: "Test Stadium",
          homeTeam: "__Elapsed Live Home__",
          awayTeam: "__Elapsed Live Away__",
          status: "scheduled",
          elapsedMinute: null,
        })
        .returning({ id: fixturesTable.id });
      if (!liveFixture) throw new Error("Live-fixture insert failed");
      cleanupLiveFixtureId = liveFixture.id;

      await db.insert(fixturePlayersTable).values({
        fixtureId: liveFixture.id,
        playerId: player.id,
        clubId: club.id,
      });

      // ── Pre-reconciliation sanity: elapsedMinute is 72 in the DB ───────────

      const [beforeRow] = await db
        .select({ elapsedMinute: fixturesTable.elapsedMinute, status: fixturesTable.status })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, finishedFixture.id));

      expect(beforeRow?.elapsedMinute).toBe(72);
      expect(beforeRow?.status).toBe("scheduled");

      // ── Invoke reconciliation with "FT" for fixture 1, "1H"/45 for fixture 2

      const freshById = new Map<number, AfFixture>([
        [AF_ID_FINISHED, makeAfFixture(AF_ID_FINISHED, "FT", 90)],
        [AF_ID_LIVE,     makeAfFixture(AF_ID_LIVE,     "1H", 45)],
      ]);

      const result = await reconcileClubFixtures({
        club: { id: club.id, name: club.name },
        clubPlayerIds: [player.id],
        freshById,
        removalsTrustworthy: true,
        now: Date.now(),
      });

      expect(
        result.fixturesReconciled,
        "Both fixtures (finished + live) should be reported as reconciled",
      ).toBe(2);

      // ── Post-reconciliation: finished fixture has elapsedMinute = null ──────

      const [afterFinished] = await db
        .select({ elapsedMinute: fixturesTable.elapsedMinute, status: fixturesTable.status })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, finishedFixture.id));

      expect(
        afterFinished?.status,
        "Fixture should be updated to 'finished' after reconciliation with FT status",
      ).toBe("finished");

      expect(
        afterFinished?.elapsedMinute,
        "elapsedMinute must be null on a finished fixture — the stale '72' value was not cleared",
      ).toBeNull();

      // ── Post-reconciliation: live fixture still has elapsedMinute = 45 ──────

      const [afterLive] = await db
        .select({ elapsedMinute: fixturesTable.elapsedMinute, status: fixturesTable.status })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, liveFixture.id));

      expect(
        afterLive?.status,
        "Second fixture should be updated to 'live' after reconciliation with 1H status",
      ).toBe("live");

      expect(
        afterLive?.elapsedMinute,
        "elapsedMinute must be 45 on the live fixture — the provider-reported minute should be preserved",
      ).toBe(45);
    },
    30_000,
  );
});
