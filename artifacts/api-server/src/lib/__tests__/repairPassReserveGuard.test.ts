/**
 * Integration tests for `runRepairPass` — the fixture backfill path inside
 * syncApiFootballFixtures.
 *
 * ## Why this file exists
 * The reserve/youth fixture guard was historically applied using a name-only
 * pattern check on BOTH sides of a fixture (home || away), causing two bugs:
 *
 *   Bug 1 (Benfica B / Wynder): The club's own registered name ends in " B"
 *     which matched RESERVE_TEAM_PATTERN → every Benfica B fixture was blocked.
 *   Bug 2 (Real Monarchs / Gozo): Opponents ended in " II" (Timbers II, etc.)
 *     → the || fired on the opponent side → same zero-tag outcome.
 *
 * After the fix, the guard is side-aware: it looks up the club's own slot via
 * `teamId` from `freshById` (the API payload) and exempts clubs registered
 * under a name that matches the pattern when the API agrees with the name.
 *
 * ## What is tested
 * 1. A genuine reserve entry (API returns "Leeds United U21" under the senior
 *    club's team ID) is NOT backfilled with player links.
 * 2. A club tracked as "Benfica B" IS backfilled — names match, not reserve.
 * 3. A club with a clean name whose opponent ends in " II" IS backfilled —
 *    only the club's own side is checked.
 *
 * ## How it works
 * - Inserts minimal DB rows (club + player + fixture) directly.
 * - Calls `runRepairPass` with a hand-crafted `freshById` map that controls
 *   exactly what team names / IDs the API payload carries.
 * - Asserts on `fixture_players` rows created (or not created).
 * - `afterAll` cleans up all inserted rows.
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
import { runRepairPass } from "../apiFootballSync.js";
import type { AfFixture } from "../fixtureReconciliation.js";

// ─── cleanup tracking ────────────────────────────────────────────────────────

const insertedClubIds: number[] = [];
const insertedPlayerIds: number[] = [];
const insertedFixtureIds: number[] = [];

afterAll(async () => {
  for (const fid of insertedFixtureIds) {
    await db.delete(fixturePlayersTable).where(eq(fixturePlayersTable.fixtureId, fid));
    await db.delete(fixturesTable).where(eq(fixturesTable.id, fid));
  }
  for (const pid of insertedPlayerIds) {
    await db.delete(playersTable).where(eq(playersTable.id, pid));
  }
  for (const cid of insertedClubIds) {
    await db.delete(clubsTable).where(eq(clubsTable.id, cid));
  }
});

// ─── helpers ─────────────────────────────────────────────────────────────────

const BASE_PLAYER = {
  position: "MF" as const,
  category: "current" as const,
  age: 24,
  nationalTeamCaps: 0,
  nationalTeamGoals: 0,
  performanceTrend: "steady" as const,
  trending: false,
  bio: "",
  worldCupRoster: false,
};

/** Builds a minimal AfFixture for use in freshById. */
function makeAfFixture(opts: {
  apiId: number;
  homeId: number;
  homeName: string;
  awayId: number;
  awayName: string;
}): AfFixture {
  const kickoff = new Date(Date.now() + 48 * 60 * 60 * 1000);
  return {
    fixture: {
      id: opts.apiId,
      date: kickoff.toISOString(),
      status: { short: "NS", elapsed: null },
      venue: { name: "Test Arena" },
    },
    league: { name: "Test League" },
    teams: {
      home: { id: opts.homeId, name: opts.homeName, logo: null },
      away: { id: opts.awayId, name: opts.awayName, logo: null },
    },
    goals: { home: null, away: null },
  };
}

// ─── suite ───────────────────────────────────────────────────────────────────

describe("runRepairPass — reserve guard applied to repair/backfill path", () => {
  // ── Regression test 1: Leeds United U21 style ─────────────────────────────
  it(
    "does NOT create a fixture_players link when the API payload shows a reserve entry (e.g. U21) under the club's team ID",
    async () => {
      const TEAM_API_ID = 9_801_001;
      const FIXTURE_API_ID = 9_802_001;

      const [club] = await db
        .insert(clubsTable)
        .values({
          name: "__RP Test Leeds United__",
          league: "EFL Championship",
          country: "England",
          apiFootballTeamId: TEAM_API_ID,
        })
        .returning({ id: clubsTable.id, name: clubsTable.name });
      if (!club) throw new Error("Club insert failed");
      insertedClubIds.push(club.id);

      const [player] = await db
        .insert(playersTable)
        .values({
          ...BASE_PLAYER,
          name: "__RP Test Leeds Player__",
          slug: "__rp-test-leeds-player__",
          clubId: club.id,
        })
        .returning({ id: playersTable.id });
      if (!player) throw new Error("Player insert failed");
      insertedPlayerIds.push(player.id);

      // Insert a fixture as if it was previously synced — no fixture_players
      // link yet (simulating the first-insertion race or a prior guard bug).
      const kickoff = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const [fixture] = await db
        .insert(fixturesTable)
        .values({
          apiFootballFixtureId: FIXTURE_API_ID,
          isNationalTeam: false,
          competition: "EFL Trophy",
          kickoff,
          venue: "Elland Road",
          // The DB stores the name the API returned — already a U21 name,
          // which is what triggered the insert on the previous cycle.
          // No underscores around "U21": \bU21\b needs a word boundary after
          // the digit, and _ is a word character that would break the match.
          homeTeam: "Leeds United U21",
          awayTeam: "Oldham Athletic",
          status: "scheduled",
        })
        .returning({ id: fixturesTable.id });
      if (!fixture) throw new Error("Fixture insert failed");
      insertedFixtureIds.push(fixture.id);

      // freshById reflects what the API returns NOW: the U21 name under
      // the same team ID as the registered senior club.
      const freshById = new Map<number, AfFixture>([
        [
          FIXTURE_API_ID,
          makeAfFixture({
            apiId: FIXTURE_API_ID,
            homeId: TEAM_API_ID,        // same team ID as the registered senior club
            homeName: "Leeds United U21", // reserve squad name — no trailing _ so \bU21\b matches
            awayId: 9_890_001,
            awayName: "Oldham Athletic",
          }),
        ],
      ]);

      await runRepairPass({
        club,
        teamId: TEAM_API_ID,
        freshById,
        clubPlayerIds: [player.id],
      });

      const links = await db
        .select({ playerId: fixturePlayersTable.playerId })
        .from(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, fixture.id));

      expect(
        links.map((l) => l.playerId),
        `Player id=${player.id} should NOT be linked — the API payload shows ` +
          `"__RP Test Leeds United U21__" (differs from registered club name and ` +
          `matches the reserve pattern); the repair pass must apply the same guard ` +
          `as the main upsert loop`,
      ).not.toContain(player.id);
    },
    30_000,
  );

  // ── Regression test 2: Benfica B (registered name matches pattern) ─────────
  it(
    "DOES create a fixture_players link when the club is registered under a name matching the reserve pattern (e.g. Benfica B) and the API agrees",
    async () => {
      const TEAM_API_ID = 9_801_002;
      const FIXTURE_API_ID = 9_802_002;

      const [club] = await db
        .insert(clubsTable)
        .values({
          name: "__RP Test Benfica B__",
          league: "Liga Portugal 2",
          country: "Portugal",
          apiFootballTeamId: TEAM_API_ID,
        })
        .returning({ id: clubsTable.id, name: clubsTable.name });
      if (!club) throw new Error("Club insert failed");
      insertedClubIds.push(club.id);

      const [player] = await db
        .insert(playersTable)
        .values({
          ...BASE_PLAYER,
          name: "__RP Test Wynder Regression__",
          slug: "__rp-test-wynder-regression__",
          clubId: club.id,
        })
        .returning({ id: playersTable.id });
      if (!player) throw new Error("Player insert failed");
      insertedPlayerIds.push(player.id);

      const kickoff = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const [fixture] = await db
        .insert(fixturesTable)
        .values({
          apiFootballFixtureId: FIXTURE_API_ID,
          isNationalTeam: false,
          competition: "Liga Portugal 2",
          kickoff,
          venue: "Estadio da Luz B",
          homeTeam: "__RP Test Benfica B__",
          awayTeam: "Torreense",
          status: "scheduled",
        })
        .returning({ id: fixturesTable.id });
      if (!fixture) throw new Error("Fixture insert failed");
      insertedFixtureIds.push(fixture.id);

      // API returns the registered name — names match, guard must not fire.
      const freshById = new Map<number, AfFixture>([
        [
          FIXTURE_API_ID,
          makeAfFixture({
            apiId: FIXTURE_API_ID,
            homeId: TEAM_API_ID,
            homeName: "__RP Test Benfica B__", // same as registered club name
            awayId: 9_890_002,
            awayName: "Torreense",
          }),
        ],
      ]);

      await runRepairPass({
        club,
        teamId: TEAM_API_ID,
        freshById,
        clubPlayerIds: [player.id],
      });

      const links = await db
        .select({ playerId: fixturePlayersTable.playerId })
        .from(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, fixture.id));

      expect(
        links.map((l) => l.playerId),
        `Player id=${player.id} should be linked — the club is registered as ` +
          `"__RP Test Benfica B__" and the API returns the same name; the ` +
          `registered-name exemption must apply in the repair pass, not just the main loop`,
      ).toContain(player.id);
    },
    30_000,
  );

  // ── Regression test 3: Real Monarchs (opponent ends in " II") ─────────────
  it(
    "DOES create a fixture_players link when the club's name is clean but the OPPONENT ends in \" II\"",
    async () => {
      const TEAM_API_ID = 9_801_003;
      const FIXTURE_API_ID = 9_802_003;

      const [club] = await db
        .insert(clubsTable)
        .values({
          name: "__RP Test Monarchs__",
          league: "MLS Next Pro",
          country: "USA",
          apiFootballTeamId: TEAM_API_ID,
        })
        .returning({ id: clubsTable.id, name: clubsTable.name });
      if (!club) throw new Error("Club insert failed");
      insertedClubIds.push(club.id);

      const [player] = await db
        .insert(playersTable)
        .values({
          ...BASE_PLAYER,
          name: "__RP Test Gozo Regression__",
          slug: "__rp-test-gozo-regression__",
          clubId: club.id,
        })
        .returning({ id: playersTable.id });
      if (!player) throw new Error("Player insert failed");
      insertedPlayerIds.push(player.id);

      const kickoff = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const [fixture] = await db
        .insert(fixturesTable)
        .values({
          apiFootballFixtureId: FIXTURE_API_ID,
          isNationalTeam: false,
          competition: "MLS Next Pro",
          kickoff,
          venue: "Zions Bank Stadium",
          homeTeam: "Portland Timbers II",   // opponent matches reserve pattern
          awayTeam: "__RP Test Monarchs__",
          status: "scheduled",
        })
        .returning({ id: fixturesTable.id });
      if (!fixture) throw new Error("Fixture insert failed");
      insertedFixtureIds.push(fixture.id);

      // Club is AWAY — API's away team is the tracked club (clean name).
      // The opponent (home) ends in " II" but must not affect the guard.
      const freshById = new Map<number, AfFixture>([
        [
          FIXTURE_API_ID,
          makeAfFixture({
            apiId: FIXTURE_API_ID,
            homeId: 9_890_003,
            homeName: "Portland Timbers II",  // opponent — matches reserve pattern
            awayId: TEAM_API_ID,
            awayName: "__RP Test Monarchs__", // club's own side — clean
          }),
        ],
      ]);

      await runRepairPass({
        club,
        teamId: TEAM_API_ID,
        freshById,
        clubPlayerIds: [player.id],
      });

      const links = await db
        .select({ playerId: fixturePlayersTable.playerId })
        .from(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, fixture.id));

      expect(
        links.map((l) => l.playerId),
        `Player id=${player.id} should be linked — the club's own side ` +
          `("__RP Test Monarchs__") is clean; the opponent "Portland Timbers II" ` +
          `matching the reserve pattern must not prevent backfilling`,
      ).toContain(player.id);
    },
    30_000,
  );
});
