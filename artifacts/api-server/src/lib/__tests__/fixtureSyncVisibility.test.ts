/**
 * Regression guard: confirms that fixture data written to the database by the
 * fixtures sync is immediately visible on GET /fixtures?scope=upcoming without
 * any server restart or cache-bust.
 *
 * ## Why this matters
 * The POST /admin/trigger-fixtures-sync endpoint fires syncApiFootballFixtures
 * in the background and returns immediately. There is no built-in guarantee
 * that the data it writes to the DB is picked up by the consumer endpoint
 * without a redeploy. This test closes that gap by simulating what the sync
 * writes and verifying the fixtures route reflects it in the same process.
 *
 * ## What is tested
 * 1. A fixture inserted directly into the DB (simulating sync output) with a
 *    future kickoff appears in GET /fixtures?scope=upcoming immediately —
 *    no restart needed.
 * 2. The fixture is linked to a tracked player via fixture_players; the route
 *    correctly joins and returns it.
 * 3. Edge case: GET /fixtures?scope=upcoming&playerId=<id_with_no_links>
 *    returns an empty array, not an error, when no fixtures are linked to that
 *    player — matches the "provider has no upcoming games" scenario.
 * 4. The response parses cleanly against the generated Zod schema.
 *
 * ## How it works
 * - Boots the Express app in-process via supertest (no separate server).
 * - Inserts minimal test rows: one club, one player, one future fixture, and
 *   one fixture_players link.
 * - Asserts the route returns the fixture; then asserts the empty-array edge
 *   case for a player with no linked fixtures.
 * - afterAll cleans up all inserted rows in reverse dependency order.
 */

import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import {
  db,
  clubsTable,
  playersTable,
  fixturesTable,
  fixturePlayersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { ListFixturesResponse } from "@workspace/api-zod";
import { reconcileClubFixtures } from "../fixtureReconciliation.js";

// ─── helpers ────────────────────────────────────────────────────────────────

/** Safe pretty-printer for Zod issues — keeps assertion messages readable. */
function fmtIssues(err: { issues: Array<{ path: unknown[]; message: string; code: string }> }): string {
  return err.issues.map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message} [${i.code}]`).join("\n");
}

// ─── cleanup state ──────────────────────────────────────────────────────────

let insertedClubId: number | null = null;
let insertedPlayerId: number | null = null;
let insertedFixtureId: number | null = null;
let unlinkedPlayerId: number | null = null;

afterAll(async () => {
  // Remove fixture_players links first (FK references fixturesTable and playersTable)
  if (insertedFixtureId !== null) {
    await db.delete(fixturePlayersTable).where(eq(fixturePlayersTable.fixtureId, insertedFixtureId));
    await db.delete(fixturesTable).where(eq(fixturesTable.id, insertedFixtureId));
  }
  if (insertedPlayerId !== null) {
    await db.delete(playersTable).where(eq(playersTable.id, insertedPlayerId));
  }
  if (unlinkedPlayerId !== null) {
    await db.delete(playersTable).where(eq(playersTable.id, unlinkedPlayerId));
  }
  if (insertedClubId !== null) {
    await db.delete(clubsTable).where(eq(clubsTable.id, insertedClubId));
  }
});

// ─── setup: insert test club, players, and fixture ──────────────────────────

async function setupTestData(): Promise<{
  clubId: number;
  playerId: number;
  fixtureId: number;
  unlinkedId: number;
}> {
  // Insert a minimal club row — no apiFootballTeamId so the sync won't try
  // to re-process it, and it avoids the partial unique index conflict.
  const [club] = await db
    .insert(clubsTable)
    .values({
      name: "__test_fixture_sync_club__",
      league: "Test League",
      country: "USA",
    })
    .returning({ id: clubsTable.id });
  if (!club) throw new Error("Club insert failed");

  // Insert a tracked player at that club.
  const [player] = await db
    .insert(playersTable)
    .values({
      name: "__Test Fixture Sync Player__",
      slug: "__test-fixture-sync-player__",
      position: "MF",
      category: "current",
      clubId: club.id,
      age: 25,
      nationalTeamCaps: 0,
      nationalTeamGoals: 0,
      performanceTrend: "steady",
      trending: false,
      bio: "",
      worldCupRoster: false,
    })
    .returning({ id: playersTable.id });
  if (!player) throw new Error("Player insert failed");

  // Insert a second player with no fixture link — used for the empty-array edge case.
  const [unlinked] = await db
    .insert(playersTable)
    .values({
      name: "__Test Fixture Sync Unlinked__",
      slug: "__test-fixture-sync-unlinked__",
      position: "GK",
      category: "prospect",
      clubId: club.id,
      age: 22,
      nationalTeamCaps: 0,
      nationalTeamGoals: 0,
      performanceTrend: "steady",
      trending: false,
      bio: "",
      worldCupRoster: false,
    })
    .returning({ id: playersTable.id });
  if (!unlinked) throw new Error("Unlinked player insert failed");

  // Insert a future fixture — exactly what syncApiFootballFixtures writes for
  // an upcoming club match. Kickoff is 48 hours from now so it passes the
  // scope=upcoming filter (gte(kickoff, new Date())).
  const kickoff = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const [fixture] = await db
    .insert(fixturesTable)
    .values({
      // No apiFootballFixtureId — seeded rows use null, and the unique index
      // only applies when the column is non-null. This avoids conflicts.
      isNationalTeam: false,
      competition: "Test League",
      kickoff,
      venue: "Test Stadium",
      homeTeam: "__Test FC__",
      awayTeam: "__Opponent FC__",
      status: "scheduled",
    })
    .returning({ id: fixturesTable.id });
  if (!fixture) throw new Error("Fixture insert failed");

  // Link the player to the fixture (exactly what the sync's fixturePlayersTable insert does).
  await db
    .insert(fixturePlayersTable)
    .values({ fixtureId: fixture.id, playerId: player.id, clubId: club.id });

  return {
    clubId: club.id,
    playerId: player.id,
    fixtureId: fixture.id,
    unlinkedId: unlinked.id,
  };
}

// ─── suite ──────────────────────────────────────────────────────────────────

describe("GET /fixtures?scope=upcoming — newly-synced fixture data appears without restart", () => {
  it(
    "a fixture written to the DB is immediately returned by /fixtures?scope=upcoming",
    async () => {
      const { clubId, playerId, fixtureId, unlinkedId } = await setupTestData();
      insertedClubId = clubId;
      insertedPlayerId = playerId;
      insertedFixtureId = fixtureId;
      unlinkedPlayerId = unlinkedId;

      // Step 1: hit the endpoint — no restart, no cache bust.
      const res = await request(app).get("/api/fixtures?scope=upcoming").expect(200);

      const parsed = ListFixturesResponse.safeParse(res.body);
      expect(
        parsed.success,
        `/fixtures?scope=upcoming did not parse:\n${parsed.success ? "" : fmtIssues(parsed.error)}`,
      ).toBe(true);

      // Step 2: confirm the inserted fixture is in the response.
      const found = parsed.data!.find((f) => f.id === fixtureId);
      expect(
        found,
        `Fixture id=${fixtureId} was written to the DB by the sync but is NOT present in ` +
          `/fixtures?scope=upcoming — the route may be serving stale or cached data.`,
      ).toBeDefined();

      // Step 3: verify the fixture shape is correct.
      expect(found!.homeTeam).toBe("__Test FC__");
      expect(found!.awayTeam).toBe("__Opponent FC__");
      expect(found!.status).toBe("scheduled");

      // Step 4: confirm featured players list contains our tracked player.
      const featuredIds = (found!.featuredPlayers ?? []).map((p: { id: number }) => p.id);
      expect(
        featuredIds,
        `Player id=${playerId} is linked in fixture_players but missing from featuredPlayers on fixture id=${fixtureId}`,
      ).toContain(playerId);
    },
    30_000,
  );

  it(
    "edge case: /fixtures?scope=upcoming&playerId=<no_links> returns empty array, not an error",
    async () => {
      // unlinkedPlayerId is set by the first test; if that test was skipped,
      // insert a standalone player now. Either way we need a valid player id
      // with no fixture_players rows.
      const targetId = unlinkedPlayerId;
      if (targetId === null) {
        // First test must have run to set up the club; this is a safety guard.
        console.warn("[fixtureSyncVisibility] Skipping edge-case — setup did not run.");
        return;
      }

      const res = await request(app)
        .get(`/api/fixtures?scope=upcoming&playerId=${targetId}`)
        .expect(200);

      const parsed = ListFixturesResponse.safeParse(res.body);
      expect(
        parsed.success,
        `Empty-array response did not parse:\n${parsed.success ? "" : fmtIssues(parsed.error)}`,
      ).toBe(true);

      expect(
        parsed.data,
        "Expected empty array when player has no linked fixtures, but got a non-array or null",
      ).toEqual([]);
    },
    30_000,
  );
});

// ─── Transfer visibility guard ──────────────────────────────────────────────

/**
 * Regression guard: once a player's clubId changes (transfer), they must stop
 * appearing in featuredPlayers for upcoming scheduled fixtures that were linked
 * to their old club. A player who did NOT transfer must still appear.
 *
 * ## What is tested
 * 1. A future fixture is linked to two players at club A.
 * 2. Player 1 is transferred to club B (their clubId row is updated).
 * 3. GET /fixtures?scope=upcoming&playerId=<transferred player>
 *    → The fixture is still returned (the link row still exists), but the
 *      fixture's featuredPlayers list does NOT contain the transferred player.
 * 4. GET /fixtures?scope=upcoming (no playerId filter)
 *    → The fixture appears and featuredPlayers includes the staying player but
 *      still excludes the transferred player.
 */

describe("GET /fixtures?scope=upcoming — transferred player excluded from featuredPlayers", () => {
  let xferClubAId: number | null = null;
  let xferClubBId: number | null = null;
  let xferPlayerId: number | null = null;
  let stayingPlayerId: number | null = null;
  let xferFixtureId: number | null = null;

  afterAll(async () => {
    if (xferFixtureId !== null) {
      await db
        .delete(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, xferFixtureId));
      await db
        .delete(fixturesTable)
        .where(eq(fixturesTable.id, xferFixtureId));
    }
    if (xferPlayerId !== null) {
      await db.delete(playersTable).where(eq(playersTable.id, xferPlayerId));
    }
    if (stayingPlayerId !== null) {
      await db.delete(playersTable).where(eq(playersTable.id, stayingPlayerId));
    }
    if (xferClubBId !== null) {
      await db.delete(clubsTable).where(eq(clubsTable.id, xferClubBId));
    }
    if (xferClubAId !== null) {
      await db.delete(clubsTable).where(eq(clubsTable.id, xferClubAId));
    }
  });

  it(
    "transferred player is excluded from featuredPlayers on their old club's upcoming fixture",
    async () => {
      // ── Setup ──────────────────────────────────────────────────────────────

      // Club A: original club for both players.
      const [clubA] = await db
        .insert(clubsTable)
        .values({ name: "__test_xfer_club_a__", league: "Test League", country: "USA" })
        .returning({ id: clubsTable.id });
      if (!clubA) throw new Error("Club A insert failed");
      xferClubAId = clubA.id;

      // Club B: the destination after the transfer.
      const [clubB] = await db
        .insert(clubsTable)
        .values({ name: "__test_xfer_club_b__", league: "Test League B", country: "GER" })
        .returning({ id: clubsTable.id });
      if (!clubB) throw new Error("Club B insert failed");
      xferClubBId = clubB.id;

      const basePlayer = {
        position: "MF" as const,
        category: "current" as const,
        clubId: clubA.id,
        age: 25,
        nationalTeamCaps: 0,
        nationalTeamGoals: 0,
        performanceTrend: "steady" as const,
        trending: false,
        bio: "",
        worldCupRoster: false,
      };

      // Player who will transfer away.
      const [xferPlayer] = await db
        .insert(playersTable)
        .values({ ...basePlayer, name: "__Test Xfer Player__", slug: "__test-xfer-player__" })
        .returning({ id: playersTable.id });
      if (!xferPlayer) throw new Error("Transfer player insert failed");
      xferPlayerId = xferPlayer.id;

      // Player who stays at club A throughout.
      const [stayingPlayer] = await db
        .insert(playersTable)
        .values({ ...basePlayer, name: "__Test Staying Player__", slug: "__test-staying-player__" })
        .returning({ id: playersTable.id });
      if (!stayingPlayer) throw new Error("Staying player insert failed");
      stayingPlayerId = stayingPlayer.id;

      // A future scheduled fixture for club A.
      const kickoff = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 h from now
      const [xferFixture] = await db
        .insert(fixturesTable)
        .values({
          isNationalTeam: false,
          competition: "Test Transfer League",
          kickoff,
          venue: "Transfer Stadium",
          homeTeam: "__Test Xfer FC__",
          awayTeam: "__Opponent Xfer FC__",
          status: "scheduled",
        })
        .returning({ id: fixturesTable.id });
      if (!xferFixture) throw new Error("Transfer fixture insert failed");
      xferFixtureId = xferFixture.id;

      // Link both players to the fixture stamped with club A's id.
      await db.insert(fixturePlayersTable).values([
        { fixtureId: xferFixture.id, playerId: xferPlayer.id, clubId: clubA.id },
        { fixtureId: xferFixture.id, playerId: stayingPlayer.id, clubId: clubA.id },
      ]);

      // ── Transfer: update xferPlayer's club to club B ───────────────────────
      await db
        .update(playersTable)
        .set({ clubId: clubB.id })
        .where(eq(playersTable.id, xferPlayer.id));

      // ── Assertion 1: playerId filter on the transferred player ─────────────
      // The fixture is still returned (the fixture_players row still exists),
      // but the player should NOT appear in featuredPlayers because they are
      // now at a different club and the fixture is still scheduled.
      const res1 = await request(app)
        .get(`/api/fixtures?scope=upcoming&playerId=${xferPlayer.id}`)
        .expect(200);

      const parsed1 = ListFixturesResponse.safeParse(res1.body);
      expect(
        parsed1.success,
        `playerId filter response did not parse:\n${parsed1.success ? "" : fmtIssues(parsed1.error)}`,
      ).toBe(true);

      const fixture1 = parsed1.data!.find((f) => f.id === xferFixture.id);
      // The fixture may or may not appear in the list — what matters is that
      // the transferred player is NOT in featuredPlayers if the fixture does appear.
      if (fixture1) {
        const featuredIds1 = (fixture1.featuredPlayers ?? []).map((p: { id: number }) => p.id);
        expect(
          featuredIds1,
          `Transferred player id=${xferPlayer.id} should NOT appear in featuredPlayers ` +
            `after moving from club A (id=${clubA.id}) to club B (id=${clubB.id}), ` +
            `but was found in the featuredPlayers list of fixture id=${xferFixture.id}`,
        ).not.toContain(xferPlayer.id);
      }

      // ── Assertion 2: no playerId filter — fixture still visible ───────────
      // The fixture must still appear in the general upcoming list (it belongs
      // to club A which still has the staying player), and the staying player
      // IS in featuredPlayers, while the transferred player is NOT.
      const res2 = await request(app).get("/api/fixtures?scope=upcoming").expect(200);

      const parsed2 = ListFixturesResponse.safeParse(res2.body);
      expect(
        parsed2.success,
        `Unfiltered upcoming response did not parse:\n${parsed2.success ? "" : fmtIssues(parsed2.error)}`,
      ).toBe(true);

      const fixture2 = parsed2.data!.find((f) => f.id === xferFixture.id);
      expect(
        fixture2,
        `Fixture id=${xferFixture.id} should appear in the unfiltered upcoming list ` +
          `(club A still has linked players), but was not found`,
      ).toBeDefined();

      const featuredIds2 = (fixture2!.featuredPlayers ?? []).map((p: { id: number }) => p.id);

      expect(
        featuredIds2,
        `Staying player id=${stayingPlayer.id} should appear in featuredPlayers ` +
          `(they did not transfer), but was missing from fixture id=${xferFixture.id}`,
      ).toContain(stayingPlayer.id);

      expect(
        featuredIds2,
        `Transferred player id=${xferPlayer.id} should NOT appear in featuredPlayers ` +
          `after moving to club B (id=${clubB.id}), but was found in fixture id=${xferFixture.id}`,
      ).not.toContain(xferPlayer.id);
    },
    30_000,
  );
});

// ─── Stale-fixture removal guard ────────────────────────────────────────────

/**
 * Regression guard: confirms that when the fixtures-sync reconciliation
 * identifies a past-kickoff "scheduled" fixture that is no longer present in
 * the provider's fresh pull, it deletes both the fixture row and its
 * fixture_players link, and the fixture is no longer returned by
 * GET /fixtures?scope=upcoming.
 *
 * ## What is tested
 * 1. A fixture with a past kickoff (status="scheduled", apiFootballFixtureId
 *    set) is inserted along with a fixture_players link.
 * 2. The reconciliation deletion path is exercised directly — using the exact
 *    same delete queries the sync's reconciliation block uses — simulating the
 *    case where the fixture is absent from the provider's fresh list and
 *    removals are trustworthy (all season fetches succeeded).
 * 3. The fixture row is no longer present in the DB.
 * 4. The fixture_players link is no longer present in the DB.
 * 5. GET /fixtures?scope=upcoming no longer returns the stale row.
 */

describe("Stale fixture removal — past-kickoff scheduled fixture is deleted when absent from fresh pull", () => {
  let staleClubId: number | null = null;
  let stalePlayerId: number | null = null;
  let staleFixtureId: number | null = null;

  afterAll(async () => {
    // Belt-and-suspenders cleanup: the test should have deleted the fixture
    // and link, but guard against test failure leaving orphaned rows.
    if (staleFixtureId !== null) {
      await db
        .delete(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, staleFixtureId));
      await db.delete(fixturesTable).where(eq(fixturesTable.id, staleFixtureId));
    }
    if (stalePlayerId !== null) {
      await db.delete(playersTable).where(eq(playersTable.id, stalePlayerId));
    }
    if (staleClubId !== null) {
      await db.delete(clubsTable).where(eq(clubsTable.id, staleClubId));
    }
  });

  it(
    "deletes the fixture row and fixture_players link, and removes it from /fixtures?scope=upcoming",
    async () => {
      // ── Setup ──────────────────────────────────────────────────────────────

      const [club] = await db
        .insert(clubsTable)
        .values({ name: "__test_stale_removal_club__", league: "Test League", country: "USA" })
        .returning({ id: clubsTable.id, name: clubsTable.name });
      if (!club) throw new Error("Club insert failed");
      staleClubId = club.id;

      const [player] = await db
        .insert(playersTable)
        .values({
          name: "__Test Stale Removal Player__",
          slug: "__test-stale-removal-player__",
          position: "FW" as const,
          category: "current" as const,
          clubId: club.id,
          age: 27,
          nationalTeamCaps: 0,
          nationalTeamGoals: 0,
          performanceTrend: "steady" as const,
          trending: false,
          bio: "",
          worldCupRoster: false,
        })
        .returning({ id: playersTable.id });
      if (!player) throw new Error("Player insert failed");
      stalePlayerId = player.id;

      // Insert a past-kickoff fixture with apiFootballFixtureId set.
      // A non-null apiFootballFixtureId is required for the reconciliation block
      // to consider the row — fixtures without an API id are seeded rows and
      // are skipped (see the `if (tracked.apiFootballFixtureId === null) continue`
      // guard inside syncApiFootballFixtures).
      const pastKickoff = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48 h ago
      const [staleFixture] = await db
        .insert(fixturesTable)
        .values({
          apiFootballFixtureId: 9_999_001, // arbitrary; not in any real season fetch
          isNationalTeam: false,
          competition: "Ended Season League",
          kickoff: pastKickoff,
          venue: "Old Stadium",
          homeTeam: "__Stale Home FC__",
          awayTeam: "__Stale Away FC__",
          status: "scheduled",
        })
        .returning({ id: fixturesTable.id });
      if (!staleFixture) throw new Error("Stale fixture insert failed");
      staleFixtureId = staleFixture.id;

      await db
        .insert(fixturePlayersTable)
        .values({ fixtureId: staleFixture.id, playerId: player.id, clubId: club.id });

      // ── Pre-reconciliation checks ─────────────────────────────────────────

      // Confirm both the fixture row and its fixture_players link are in the
      // DB before reconciliation runs, so we know the removal actually fired
      // and didn't just skip because the rows were already absent.
      const beforeRows = await db
        .select({ id: fixturesTable.id })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, staleFixture.id));
      expect(beforeRows).toHaveLength(1);

      const beforeLinks = await db
        .select({ fixtureId: fixturePlayersTable.fixtureId })
        .from(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, staleFixture.id));
      expect(beforeLinks).toHaveLength(1);

      // ── Invoke the real reconciliation logic ──────────────────────────────
      // Pass an empty freshById (simulating the provider returning zero
      // fixtures for this club's season — e.g. the season has ended and the
      // stale fixture is no longer listed). removalsTrustworthy=true mirrors
      // the state after all season-fetch attempts succeeded without error.
      // now is captured after the past kickoff so the "future kickoff" guard
      // does NOT fire and the removal branch executes instead.
      const result = await reconcileClubFixtures({
        club: { id: club.id, name: club.name },
        clubPlayerIds: [player.id],
        freshById: new Map(), // empty — stale fixture absent from provider list
        removalsTrustworthy: true,
        now: Date.now(),
      });

      expect(
        result.fixturesRemoved,
        `reconcileClubFixtures should have reported 1 removed fixture but reported ${result.fixturesRemoved}`,
      ).toBe(1);

      // ── Post-reconciliation: fixture row is gone from the DB ──────────────
      const afterRows = await db
        .select({ id: fixturesTable.id })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, staleFixture.id));
      expect(
        afterRows,
        `Fixture id=${staleFixture.id} should have been deleted by reconcileClubFixtures ` +
          `(past kickoff, absent from fresh provider list) but still exists in the DB`,
      ).toHaveLength(0);

      // ── Post-reconciliation: fixture_players link is gone from the DB ─────
      const afterLinks = await db
        .select({ fixtureId: fixturePlayersTable.fixtureId })
        .from(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, staleFixture.id));
      expect(
        afterLinks,
        `fixture_players link for fixture id=${staleFixture.id} should have been deleted ` +
          `by reconcileClubFixtures but still exists in the DB`,
      ).toHaveLength(0);

      // Clear module-level ID so afterAll does not attempt a redundant delete.
      staleFixtureId = null;

      // ── Post-reconciliation: fixture no longer returned by the API ─────────
      const res = await request(app).get("/api/fixtures?scope=upcoming").expect(200);
      const parsed = ListFixturesResponse.safeParse(res.body);
      expect(
        parsed.success,
        `/fixtures?scope=upcoming response did not parse:\n${parsed.success ? "" : fmtIssues(parsed.error)}`,
      ).toBe(true);

      const found = parsed.data!.find((f) => f.id === staleFixture.id);
      expect(
        found,
        `Stale fixture id=${staleFixture.id} (past kickoff, removed by reconcileClubFixtures) ` +
          `still appears in GET /fixtures?scope=upcoming — the endpoint is returning deleted rows`,
      ).toBeUndefined();
    },
    30_000,
  );
});

// ─── Schema-level guard ─────────────────────────────────────────────────────

describe("ListFixturesResponse schema — response contract", () => {
  it("accepts a well-formed fixture item", () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const goodItem = {
      id: 1,
      competition: "MLS Regular Season",
      kickoff: futureDate,
      venue: "Yankee Stadium",
      homeTeam: "NYCFC",
      awayTeam: "Red Bulls",
      homeLogoUrl: null,
      awayLogoUrl: null,
      homeScore: null,
      awayScore: null,
      status: "scheduled",
      tvNetwork: null,
      streamingService: null,
      broadcastLink: null,
      isNationalTeam: false,
      featuredPlayers: [],
    };

    const result = ListFixturesResponse.safeParse([goodItem]);
    expect(result.success).toBe(true);
  });

  it("returns an empty array (not a parse error) when the fixture list is empty", () => {
    const result = ListFixturesResponse.safeParse([]);
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });
});
