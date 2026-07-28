/**
 * Integration guard: confirms that a parent club ("Orlando City SC", team 1610)
 * and its reserve side ("Orlando City II", team 4026) keep strictly disjoint
 * fixture sets after a full mocked sync sweep.
 *
 * ## Why this test exists
 * API-Football assigns separate team IDs to parent and reserve clubs.  The DB
 * can hold both as distinct club rows, each with its own `apiFootballTeamId`.
 * The risk is that the sync for one club inadvertently links — or worse,
 * wipes — fixtures belonging to the other, e.g. if it resolves the wrong team
 * ID during the search phase or the reserve guard misfires.
 *
 * This file drives `runRepairPass` (the fixture-backfill path that wires
 * fixture_players links) with separate, non-overlapping `freshById` maps and
 * then verifies:
 *
 *   1. After the parent-club sweep, only the parent-club player is linked to
 *      the parent-club fixture — not to the reserve fixture.
 *
 *   2. After the reserve-club sweep, only the reserve-club player is linked to
 *      the reserve fixture — not to the parent fixture.
 *
 *   3. A reserve-side fixture returned under the PARENT team ID (e.g.
 *      API-Football occasionally groups "Orlando City II" games under team 1610)
 *      is correctly blocked by the reserve guard and does NOT create a
 *      fixture_players link for the parent-club player.
 *
 *   4. `reconcileClubFixtures` for the parent club does not remove or touch
 *      the reserve club's fixture, confirming the two clubs' managed sets stay
 *      independent across a full reconciliation pass.
 *
 * ## Strategy
 * All DB writes use unique sentinel names to avoid touching live data.
 * Sentinel names are prefix-based (__PRD__) so the suffix (" II" for the
 * reserve side) lands at the actual end of the string — required by
 * RESERVE_TEAM_PATTERN's end-anchor `(?:\sII)$`.
 * `afterAll` removes every inserted row in reverse FK order.
 * No real API calls are made — all freshById maps are hand-crafted.
 */

import { describe, it, expect, afterAll } from "vitest";
import {
  db,
  clubsTable,
  playersTable,
  fixturesTable,
  fixturePlayersTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { runRepairPass } from "../apiFootballSync.js";
import { reconcileClubFixtures } from "../fixtureReconciliation.js";
import type { AfFixture } from "../fixtureReconciliation.js";

// ─── Cleanup tracking ─────────────────────────────────────────────────────────

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

// ─── Sentinel names ───────────────────────────────────────────────────────────
// Prefix-based so the suffix lands at the end of the string — RESERVE_TEAM_PATTERN
// uses an end-anchor (`(?:\sII)$`) that requires " II" to be the final characters.

/** Parent club — clean name, never matches the reserve pattern. */
const SC_NAME   = "__PRD__ Orlando City SC";
/** Reserve club — ends in " II" so isReserveOrYouthTeam matches it. */
const II_NAME   = "__PRD__ Orlando City II";
/** Opponents — clean names, never the tracked club. */
const OPP_SC    = "__PRD__ Chicago Fire";
const OPP_II    = "__PRD__ Inter Miami CF II";
/** Opponent in the "leak" fixture — also a reserve side, not a tracked club. */
const OPP_LEAK  = "__PRD__ Timbers II";

// ─── API-Football team IDs ────────────────────────────────────────────────────
// Sufficiently large to avoid collisions with any seeded production data.

const ORLANDO_SC_API_TEAM_ID    = 9_810_201;
const ORLANDO_II_API_TEAM_ID    = 9_810_202;
const OPP_SC_TEAM_ID            = 9_890_020;
const OPP_II_TEAM_ID            = 9_890_021;
const OPP_LEAK_TEAM_ID          = 9_890_022;

// API-Football fixture IDs — one per team, non-overlapping
const SC_FIXTURE_API_ID         = 9_820_201;  // belongs to Orlando City SC
const II_FIXTURE_API_ID         = 9_820_202;  // belongs to Orlando City II
const LEAK_FIXTURE_API_ID       = 9_820_203;  // reserve entry served under the SC team ID

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_PLAYER = {
  position: "MF" as const,
  category: "current" as const,
  age: 23,
  nationalTeamCaps: 0,
  nationalTeamGoals: 0,
  performanceTrend: "steady" as const,
  trending: false,
  bio: "",
  worldCupRoster: false,
};

function makeFutureKickoff(hoursOut = 72): Date {
  return new Date(Date.now() + hoursOut * 60 * 60 * 1000);
}

/** Builds a minimal AfFixture with the given team IDs and names. */
function makeAfFixture(opts: {
  apiId: number;
  homeId: number;
  homeName: string;
  awayId: number;
  awayName: string;
  kickoff?: Date;
}): AfFixture {
  const kickoff = opts.kickoff ?? makeFutureKickoff();
  return {
    fixture: {
      id: opts.apiId,
      date: kickoff.toISOString(),
      status: { short: "NS", elapsed: null },
      venue: { name: "Test Stadium" },
    },
    league: { name: "MLS Next Pro" },
    teams: {
      home: { id: opts.homeId, name: opts.homeName, logo: null },
      away: { id: opts.awayId, name: opts.awayName, logo: null },
    },
    goals: { home: null, away: null },
  };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("parent/reserve club fixture disjoint invariant — full sync sweep", () => {
  // ── Shared state: DB rows created once, reused across all tests ─────────────

  let scClub:    { id: number; name: string };
  let iiClub:    { id: number; name: string };
  let scPlayer:  { id: number };
  let iiPlayer:  { id: number };
  let scFixture: { id: number };
  let iiFixture: { id: number };
  let leakFixture: { id: number };

  let setupDone = false;
  async function ensureSetup() {
    if (setupDone) return;
    setupDone = true;

    const kickoff = makeFutureKickoff(72);

    // ── Parent club ───────────────────────────────────────────────────────────
    const [scClubRow] = await db
      .insert(clubsTable)
      .values({
        name: SC_NAME,
        league: "Major League Soccer",
        country: "USA",
        apiFootballTeamId: ORLANDO_SC_API_TEAM_ID,
      })
      .returning({ id: clubsTable.id, name: clubsTable.name });
    if (!scClubRow) throw new Error("SC club insert failed");
    insertedClubIds.push(scClubRow.id);
    scClub = scClubRow;

    // ── Reserve club ──────────────────────────────────────────────────────────
    const [iiClubRow] = await db
      .insert(clubsTable)
      .values({
        name: II_NAME,
        league: "MLS Next Pro",
        country: "USA",
        apiFootballTeamId: ORLANDO_II_API_TEAM_ID,
      })
      .returning({ id: clubsTable.id, name: clubsTable.name });
    if (!iiClubRow) throw new Error("II club insert failed");
    insertedClubIds.push(iiClubRow.id);
    iiClub = iiClubRow;

    // ── Player at SC ──────────────────────────────────────────────────────────
    const [scPlayerRow] = await db
      .insert(playersTable)
      .values({
        ...BASE_PLAYER,
        name: "__PRD__ Test SC Player",
        slug: "__prd--test-sc-player",
        clubId: scClub.id,
      })
      .returning({ id: playersTable.id });
    if (!scPlayerRow) throw new Error("SC player insert failed");
    insertedPlayerIds.push(scPlayerRow.id);
    scPlayer = scPlayerRow;

    // ── Player at II ──────────────────────────────────────────────────────────
    const [iiPlayerRow] = await db
      .insert(playersTable)
      .values({
        ...BASE_PLAYER,
        name: "__PRD__ Test II Player",
        slug: "__prd--test-ii-player",
        clubId: iiClub.id,
      })
      .returning({ id: playersTable.id });
    if (!iiPlayerRow) throw new Error("II player insert failed");
    insertedPlayerIds.push(iiPlayerRow.id);
    iiPlayer = iiPlayerRow;

    // ── SC fixture: SC (home) vs OPP_SC (away) ────────────────────────────────
    const [scFixtureRow] = await db
      .insert(fixturesTable)
      .values({
        apiFootballFixtureId: SC_FIXTURE_API_ID,
        isNationalTeam: false,
        competition: "Major League Soccer",
        kickoff,
        venue: "Inter&Co Stadium",
        homeTeam: SC_NAME,
        awayTeam: OPP_SC,
        status: "scheduled",
      })
      .returning({ id: fixturesTable.id });
    if (!scFixtureRow) throw new Error("SC fixture insert failed");
    insertedFixtureIds.push(scFixtureRow.id);
    scFixture = scFixtureRow;

    // ── II fixture: II (home) vs OPP_II (away) ────────────────────────────────
    const [iiFixtureRow] = await db
      .insert(fixturesTable)
      .values({
        apiFootballFixtureId: II_FIXTURE_API_ID,
        isNationalTeam: false,
        competition: "MLS Next Pro",
        kickoff,
        venue: "Inter&Co Stadium II",
        homeTeam: II_NAME,
        awayTeam: OPP_II,
        status: "scheduled",
      })
      .returning({ id: fixturesTable.id });
    if (!iiFixtureRow) throw new Error("II fixture insert failed");
    insertedFixtureIds.push(iiFixtureRow.id);
    iiFixture = iiFixtureRow;

    // ── Leak fixture: a reserve entry that API-Football served under the SC
    //    team ID.  Stored in the DB with the reserve team name in homeTeam so
    //    the test can verify the repair pass blocks the link even when the
    //    fixture row already exists.
    const [leakFixtureRow] = await db
      .insert(fixturesTable)
      .values({
        apiFootballFixtureId: LEAK_FIXTURE_API_ID,
        isNationalTeam: false,
        competition: "MLS Next Pro",
        kickoff,
        venue: "Somewhere",
        homeTeam: II_NAME,      // reserve-side name in the DB
        awayTeam: OPP_LEAK,
        status: "scheduled",
      })
      .returning({ id: fixturesTable.id });
    if (!leakFixtureRow) throw new Error("Leak fixture insert failed");
    insertedFixtureIds.push(leakFixtureRow.id);
    leakFixture = leakFixtureRow;
  }

  // ── Test 1: SC repair pass links SC player to SC fixture only ──────────────
  it(
    "SC repair pass links the SC player to the SC fixture — not to the II fixture",
    async () => {
      await ensureSetup();

      // freshById for the SC sync: only the SC fixture is fetched under the SC
      // team ID.  The II fixture lives under a different team ID — the SC sync
      // never sees it.
      const scFreshById = new Map<number, AfFixture>([
        [
          SC_FIXTURE_API_ID,
          makeAfFixture({
            apiId: SC_FIXTURE_API_ID,
            homeId: ORLANDO_SC_API_TEAM_ID,
            homeName: SC_NAME,
            awayId: OPP_SC_TEAM_ID,
            awayName: OPP_SC,
          }),
        ],
      ]);

      await runRepairPass({
        club: scClub,
        teamId: ORLANDO_SC_API_TEAM_ID,
        freshById: scFreshById,
        clubPlayerIds: [scPlayer.id],
      });

      // SC player must be linked to SC fixture
      const scLinks = await db
        .select({ playerId: fixturePlayersTable.playerId })
        .from(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, scFixture.id));

      expect(
        scLinks.map((l) => l.playerId),
        "SC player must be linked to the SC fixture after the SC repair pass",
      ).toContain(scPlayer.id);

      // SC player must NOT be linked to the II fixture
      const crossLinks = await db
        .select({ playerId: fixturePlayersTable.playerId })
        .from(fixturePlayersTable)
        .where(
          and(
            eq(fixturePlayersTable.fixtureId, iiFixture.id),
            eq(fixturePlayersTable.playerId, scPlayer.id),
          ),
        );

      expect(
        crossLinks,
        "SC player must NOT be linked to the II club's fixture — that fixture " +
          "belongs to a different team ID and the SC sync never processes it",
      ).toHaveLength(0);
    },
    30_000,
  );

  // ── Test 2: II repair pass links II player to II fixture only ──────────────
  it(
    "II repair pass links the II player to the II fixture — not to the SC fixture",
    async () => {
      await ensureSetup();

      const iiFreshById = new Map<number, AfFixture>([
        [
          II_FIXTURE_API_ID,
          makeAfFixture({
            apiId: II_FIXTURE_API_ID,
            homeId: ORLANDO_II_API_TEAM_ID,
            homeName: II_NAME,
            awayId: OPP_II_TEAM_ID,
            awayName: OPP_II,
          }),
        ],
      ]);

      await runRepairPass({
        club: iiClub,
        teamId: ORLANDO_II_API_TEAM_ID,
        freshById: iiFreshById,
        clubPlayerIds: [iiPlayer.id],
      });

      // II player must be linked to II fixture
      const iiLinks = await db
        .select({ playerId: fixturePlayersTable.playerId })
        .from(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, iiFixture.id));

      expect(
        iiLinks.map((l) => l.playerId),
        "II player must be linked to the II fixture after the II repair pass",
      ).toContain(iiPlayer.id);

      // II player must NOT be linked to the SC fixture
      const crossLinks = await db
        .select({ playerId: fixturePlayersTable.playerId })
        .from(fixturePlayersTable)
        .where(
          and(
            eq(fixturePlayersTable.fixtureId, scFixture.id),
            eq(fixturePlayersTable.playerId, iiPlayer.id),
          ),
        );

      expect(
        crossLinks,
        "II player must NOT be linked to the SC club's fixture — wrong team ID",
      ).toHaveLength(0);
    },
    30_000,
  );

  // ── Test 3: Fixture sets are disjoint after both passes ────────────────────
  it(
    "after both repair passes, the SC and II players share no fixture_players rows — sets are disjoint",
    async () => {
      await ensureSetup();

      // Run both passes (idempotent — idempotency is also implicitly tested here
      // because Tests 1 and 2 above already called runRepairPass once each).
      const scFreshById = new Map<number, AfFixture>([
        [
          SC_FIXTURE_API_ID,
          makeAfFixture({
            apiId: SC_FIXTURE_API_ID,
            homeId: ORLANDO_SC_API_TEAM_ID,
            homeName: SC_NAME,
            awayId: OPP_SC_TEAM_ID,
            awayName: OPP_SC,
          }),
        ],
      ]);
      const iiFreshById = new Map<number, AfFixture>([
        [
          II_FIXTURE_API_ID,
          makeAfFixture({
            apiId: II_FIXTURE_API_ID,
            homeId: ORLANDO_II_API_TEAM_ID,
            homeName: II_NAME,
            awayId: OPP_II_TEAM_ID,
            awayName: OPP_II,
          }),
        ],
      ]);

      await Promise.all([
        runRepairPass({
          club: scClub,
          teamId: ORLANDO_SC_API_TEAM_ID,
          freshById: scFreshById,
          clubPlayerIds: [scPlayer.id],
        }),
        runRepairPass({
          club: iiClub,
          teamId: ORLANDO_II_API_TEAM_ID,
          freshById: iiFreshById,
          clubPlayerIds: [iiPlayer.id],
        }),
      ]);

      // Collect all fixture_players rows for both managed fixtures
      const allLinks = await db
        .select({
          fixtureId: fixturePlayersTable.fixtureId,
          playerId: fixturePlayersTable.playerId,
        })
        .from(fixturePlayersTable)
        .where(
          inArray(fixturePlayersTable.fixtureId, [scFixture.id, iiFixture.id]),
        );

      const byFixture = new Map<number, number[]>();
      for (const link of allLinks) {
        const players = byFixture.get(link.fixtureId) ?? [];
        players.push(link.playerId);
        byFixture.set(link.fixtureId, players);
      }

      const scPlayers = byFixture.get(scFixture.id) ?? [];
      const iiPlayers = byFixture.get(iiFixture.id) ?? [];

      // No player should appear in both sets
      const crossContaminated = scPlayers.filter((pid) => iiPlayers.includes(pid));
      expect(
        crossContaminated,
        "no player should be linked to BOTH the SC fixture and the II fixture — " +
          "the parent and reserve clubs must maintain disjoint fixture sets",
      ).toHaveLength(0);

      // Positive assertions: each player is linked to their own club's fixture
      expect(scPlayers).toContain(scPlayer.id);
      expect(scPlayers).not.toContain(iiPlayer.id);
      expect(iiPlayers).toContain(iiPlayer.id);
      expect(iiPlayers).not.toContain(scPlayer.id);
    },
    30_000,
  );

  // ── Test 4: Reserve guard blocks a reserve-name fixture under the parent ID ─
  it(
    'SC repair pass does NOT link the SC player when the API returns the II team name ("__PRD__ Orlando City II") under the SC team ID',
    async () => {
      await ensureSetup();

      // Simulate the API-Football quirk: a fixture for the reserve side is
      // served under the parent team's API ID.  The API payload's home slot
      // carries the reserve name (II_NAME = "__PRD__ Orlando City II") rather
      // than the parent name (SC_NAME).
      //
      // isReserveFixtureForClub(SC_NAME, II_NAME):
      //   • II_NAME ends in " II"  → isReserveOrYouthTeam(II_NAME) === true
      //   • II_NAME !== SC_NAME    → not exempt via name-equality
      //   → returns true → guard fires → no link created. ✓
      const scLeakFreshById = new Map<number, AfFixture>([
        [
          LEAK_FIXTURE_API_ID,
          makeAfFixture({
            apiId: LEAK_FIXTURE_API_ID,
            homeId: ORLANDO_SC_API_TEAM_ID, // fetched under the SC team ID …
            homeName: II_NAME,              // … but carries the II club name
            awayId: OPP_LEAK_TEAM_ID,
            awayName: OPP_LEAK,
          }),
        ],
      ]);

      await runRepairPass({
        club: scClub,
        teamId: ORLANDO_SC_API_TEAM_ID,
        freshById: scLeakFreshById,
        clubPlayerIds: [scPlayer.id],
      });

      const leakLinks = await db
        .select({ playerId: fixturePlayersTable.playerId })
        .from(fixturePlayersTable)
        .where(
          and(
            eq(fixturePlayersTable.fixtureId, leakFixture.id),
            eq(fixturePlayersTable.playerId, scPlayer.id),
          ),
        );

      expect(
        leakLinks,
        'SC player must NOT be linked to the leak fixture — the API returned "' +
          II_NAME + '" (a reserve name) under the parent team ID; ' +
          "the reserve guard (isReserveFixtureForClub) must block this cross-contamination",
      ).toHaveLength(0);
    },
    30_000,
  );

  // ── Test 5: reconcileClubFixtures for SC does not delete the II fixture ─────
  it(
    "reconcileClubFixtures for SC does not delete the II club's fixture row",
    async () => {
      await ensureSetup();

      // The SC reconciliation's freshById contains only SC fixtures.
      // reconcileClubFixtures scopes its DB query to players tracked at SC
      // (scPlayer.id only) — the II fixture has no scPlayer link, so it is
      // invisible to this pass and must not be touched.
      const scFreshById = new Map<number, AfFixture>([
        [
          SC_FIXTURE_API_ID,
          makeAfFixture({
            apiId: SC_FIXTURE_API_ID,
            homeId: ORLANDO_SC_API_TEAM_ID,
            homeName: SC_NAME,
            awayId: OPP_SC_TEAM_ID,
            awayName: OPP_SC,
          }),
        ],
      ]);

      await reconcileClubFixtures({
        club: scClub,
        clubPlayerIds: [scPlayer.id],
        freshById: scFreshById,
        removalsTrustworthy: true,
        now: Date.now(),
      });

      // The II fixture must still exist in the DB after the SC pass
      const iiRows = await db
        .select({ id: fixturesTable.id })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, iiFixture.id));

      expect(
        iiRows,
        "II fixture row must not be deleted when the SC reconciliation pass runs — " +
          "the two clubs manage independent fixture sets and do not interfere with each other",
      ).toHaveLength(1);
    },
    30_000,
  );
});
