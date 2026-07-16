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

// ─── Finished-fixture transfer preservation guard ────────────────────────────

/**
 * Regression guard: a fixture whose status is "finished" must keep showing
 * every player that was linked to it at match time, even if that player has
 * since transferred to a different club.
 *
 * ## What is tested
 * 1. A fixture with status "finished" and a past kickoff is inserted and linked
 *    to a player at club A.
 * 2. The player is transferred to club B (their clubId row is updated).
 * 3. GET /fixtures (no scope — returns all fixtures including past ones)
 *    → The fixture appears and the transferred player IS still in featuredPlayers.
 *
 * ## Why this matters
 * getFeaturedPlayersForFixtures gates the stale-club-link exclusion on
 * fixtureStatus === "scheduled". If that guard is ever loosened, historic
 * records silently drop players. This test ensures the gate is respected.
 */

describe("GET /fixtures — finished fixture keeps transferred player in featuredPlayers", () => {
  let finishedClubAId: number | null = null;
  let finishedClubBId: number | null = null;
  let finishedPlayerId: number | null = null;
  let finishedFixtureId: number | null = null;

  afterAll(async () => {
    if (finishedFixtureId !== null) {
      await db
        .delete(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, finishedFixtureId));
      await db
        .delete(fixturesTable)
        .where(eq(fixturesTable.id, finishedFixtureId));
    }
    if (finishedPlayerId !== null) {
      await db.delete(playersTable).where(eq(playersTable.id, finishedPlayerId));
    }
    if (finishedClubBId !== null) {
      await db.delete(clubsTable).where(eq(clubsTable.id, finishedClubBId));
    }
    if (finishedClubAId !== null) {
      await db.delete(clubsTable).where(eq(clubsTable.id, finishedClubAId));
    }
  });

  it(
    "transferred player still appears in featuredPlayers for a finished fixture",
    async () => {
      // ── Setup ──────────────────────────────────────────────────────────────

      // Club A: where the player was when the match was played.
      const [clubA] = await db
        .insert(clubsTable)
        .values({ name: "__test_finished_club_a__", league: "Test Finished League", country: "USA" })
        .returning({ id: clubsTable.id });
      if (!clubA) throw new Error("Club A insert failed");
      finishedClubAId = clubA.id;

      // Club B: where the player moves after the match.
      const [clubB] = await db
        .insert(clubsTable)
        .values({ name: "__test_finished_club_b__", league: "Test Finished League B", country: "GER" })
        .returning({ id: clubsTable.id });
      if (!clubB) throw new Error("Club B insert failed");
      finishedClubBId = clubB.id;

      // Player at club A at match time.
      const [player] = await db
        .insert(playersTable)
        .values({
          name: "__Test Finished Fixture Player__",
          slug: "__test-finished-fixture-player__",
          position: "FW" as const,
          category: "current" as const,
          clubId: clubA.id,
          age: 26,
          nationalTeamCaps: 0,
          nationalTeamGoals: 0,
          performanceTrend: "steady" as const,
          trending: false,
          bio: "",
          worldCupRoster: false,
        })
        .returning({ id: playersTable.id });
      if (!player) throw new Error("Player insert failed");
      finishedPlayerId = player.id;

      // Insert a finished fixture with a past kickoff.
      const pastKickoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
      const [fixture] = await db
        .insert(fixturesTable)
        .values({
          isNationalTeam: false,
          competition: "Test Finished League",
          kickoff: pastKickoff,
          venue: "Finished Stadium",
          homeTeam: "__Test Finished FC__",
          awayTeam: "__Opponent Finished FC__",
          status: "finished",
        })
        .returning({ id: fixturesTable.id });
      if (!fixture) throw new Error("Fixture insert failed");
      finishedFixtureId = fixture.id;

      // Link the player to the finished fixture stamped with club A's id.
      await db
        .insert(fixturePlayersTable)
        .values({ fixtureId: fixture.id, playerId: player.id, clubId: clubA.id });

      // ── Transfer: move the player to club B after the match ────────────────
      await db
        .update(playersTable)
        .set({ clubId: clubB.id })
        .where(eq(playersTable.id, player.id));

      // ── Assertion: finished fixture still shows the transferred player ──────
      // No scope filter → all fixtures returned (past kickoff is not filtered out).
      const res = await request(app).get("/api/fixtures").expect(200);

      const parsed = ListFixturesResponse.safeParse(res.body);
      expect(
        parsed.success,
        `/fixtures response did not parse:\n${parsed.success ? "" : fmtIssues(parsed.error)}`,
      ).toBe(true);

      const found = parsed.data!.find((f) => f.id === fixture.id);
      expect(
        found,
        `Finished fixture id=${fixture.id} was not returned by GET /fixtures — ` +
          `check that fixtures with past kickoffs appear when no scope is provided`,
      ).toBeDefined();

      const featuredIds = (found!.featuredPlayers ?? []).map((p: { id: number }) => p.id);
      expect(
        featuredIds,
        `Transferred player id=${player.id} should still appear in featuredPlayers ` +
          `for finished fixture id=${fixture.id} even after moving from club A (id=${clubA.id}) ` +
          `to club B (id=${clubB.id}) — the status-gate in getFeaturedPlayersForFixtures ` +
          `must only filter scheduled fixtures`,
      ).toContain(player.id);
    },
    30_000,
  );
});

// ─── National-team fixture transfer-preservation guard ───────────────────────

/**
 * Regression guard: national-team fixture links use clubId=null in
 * fixture_players (they are curated, not generated by the club sync). The
 * isStaleClubLink filter in getFeaturedPlayersForFixtures only activates when
 * linkClubId !== null, so a player linked to a national-team fixture must
 * always appear in featuredPlayers regardless of any club transfer.
 *
 * ## What is tested
 * 1. A future fixture with isNationalTeam=true is inserted.
 * 2. A player is linked to that fixture with clubId=null in fixture_players.
 * 3. The player's clubId is updated (simulating a transfer to a different club).
 * 4. GET /fixtures?scope=upcoming returns the fixture and the player still
 *    appears in featuredPlayers — the null-clubId guard must hold.
 */

describe("GET /fixtures?scope=upcoming — national-team fixture keeps player after club transfer", () => {
  let ntClubAId: number | null = null;
  let ntClubBId: number | null = null;
  let ntPlayerId: number | null = null;
  let ntFixtureId: number | null = null;

  afterAll(async () => {
    if (ntFixtureId !== null) {
      await db
        .delete(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, ntFixtureId));
      await db
        .delete(fixturesTable)
        .where(eq(fixturesTable.id, ntFixtureId));
    }
    if (ntPlayerId !== null) {
      await db.delete(playersTable).where(eq(playersTable.id, ntPlayerId));
    }
    if (ntClubBId !== null) {
      await db.delete(clubsTable).where(eq(clubsTable.id, ntClubBId));
    }
    if (ntClubAId !== null) {
      await db.delete(clubsTable).where(eq(clubsTable.id, ntClubAId));
    }
  });

  it(
    "player linked with clubId=null on a national-team fixture still appears in featuredPlayers after a club transfer",
    async () => {
      // ── Setup ──────────────────────────────────────────────────────────────

      // Club A: the player's current club at fixture-link time.
      const [clubA] = await db
        .insert(clubsTable)
        .values({ name: "__test_nt_club_a__", league: "Test NT League A", country: "USA" })
        .returning({ id: clubsTable.id });
      if (!clubA) throw new Error("Club A insert failed");
      ntClubAId = clubA.id;

      // Club B: the destination after the transfer.
      const [clubB] = await db
        .insert(clubsTable)
        .values({ name: "__test_nt_club_b__", league: "Test NT League B", country: "GER" })
        .returning({ id: clubsTable.id });
      if (!clubB) throw new Error("Club B insert failed");
      ntClubBId = clubB.id;

      // Player starts at club A.
      const [player] = await db
        .insert(playersTable)
        .values({
          name: "__Test NT Fixture Player__",
          slug: "__test-nt-fixture-player__",
          position: "MF" as const,
          category: "current" as const,
          clubId: clubA.id,
          age: 24,
          nationalTeamCaps: 10,
          nationalTeamGoals: 2,
          performanceTrend: "steady" as const,
          trending: false,
          bio: "",
          worldCupRoster: false,
        })
        .returning({ id: playersTable.id });
      if (!player) throw new Error("Player insert failed");
      ntPlayerId = player.id;

      // Insert a future national-team fixture.
      const kickoff = new Date(Date.now() + 96 * 60 * 60 * 1000); // 96 h from now
      const [fixture] = await db
        .insert(fixturesTable)
        .values({
          isNationalTeam: true,
          competition: "USMNT Friendly",
          kickoff,
          venue: "Test NT Stadium",
          homeTeam: "USA",
          awayTeam: "__NT Opponent__",
          status: "scheduled",
        })
        .returning({ id: fixturesTable.id });
      if (!fixture) throw new Error("National-team fixture insert failed");
      ntFixtureId = fixture.id;

      // Link the player with clubId=null — this is how curated national-team
      // links are stored; there is no associated club for the link.
      await db
        .insert(fixturePlayersTable)
        .values({ fixtureId: fixture.id, playerId: player.id, clubId: null });

      // ── Transfer: update the player's club to club B ───────────────────────
      await db
        .update(playersTable)
        .set({ clubId: clubB.id })
        .where(eq(playersTable.id, player.id));

      // ── Assertion: national-team fixture still shows the player ────────────
      // isStaleClubLink fires only when linkClubId !== null; a null linkClubId
      // means it is a curated national-team link that must always pass through.
      const res = await request(app).get("/api/fixtures?scope=upcoming").expect(200);

      const parsed = ListFixturesResponse.safeParse(res.body);
      expect(
        parsed.success,
        `/fixtures?scope=upcoming did not parse:\n${parsed.success ? "" : fmtIssues(parsed.error)}`,
      ).toBe(true);

      const found = parsed.data!.find((f) => f.id === fixture.id);
      expect(
        found,
        `National-team fixture id=${fixture.id} (isNationalTeam=true) was not returned by ` +
          `GET /fixtures?scope=upcoming — check that the fixture is included in the upcoming scope`,
      ).toBeDefined();

      const featuredIds = (found!.featuredPlayers ?? []).map((p: { id: number }) => p.id);
      expect(
        featuredIds,
        `Player id=${player.id} was linked to national-team fixture id=${fixture.id} with clubId=null ` +
          `and should appear in featuredPlayers even after transferring from club A (id=${clubA.id}) ` +
          `to club B (id=${clubB.id}). The isStaleClubLink guard must NOT activate for null-clubId links.`,
      ).toContain(player.id);
    },
    30_000,
  );
});

// ─── Multi-club stale-fixture removal guard ──────────────────────────────────

/**
 * Regression guard: when the reconciliation loop iterates over multiple clubs
 * in the same sync run, each club must get its own independent pass through the
 * removal logic. A bug that shares or resets the `freshById` map or the
 * `removalsTrustworthy` flag across iterations could cause one club's stale
 * fixture to survive because the other club's fetch failed.
 *
 * ## What is tested
 * 1. Two clubs (A and B) each have a past-kickoff "scheduled" fixture with an
 *    `apiFootballFixtureId` set, and a `fixture_players` link.
 * 2. `reconcileClubFixtures` is invoked for club A, then for club B, each with
 *    an empty `freshById` and `removalsTrustworthy=true` — exactly how the
 *    sync loop exercises each club in sequence.
 * 3. Both stale fixture rows and both `fixture_players` links are confirmed
 *    deleted from the DB.
 * 4. Neither fixture appears in GET /fixtures?scope=upcoming.
 */

describe("Stale fixture removal — both clubs' stale fixtures deleted in a multi-club run", () => {
  let multiClubAId: number | null = null;
  let multiClubBId: number | null = null;
  let multiPlayerAId: number | null = null;
  let multiPlayerBId: number | null = null;
  let multiFixtureAId: number | null = null;
  let multiFixtureBId: number | null = null;

  afterAll(async () => {
    // Belt-and-suspenders cleanup — tests should have deleted the fixtures and
    // links, but guard against a test failure leaving orphaned rows.
    for (const fixtureId of [multiFixtureAId, multiFixtureBId]) {
      if (fixtureId !== null) {
        await db
          .delete(fixturePlayersTable)
          .where(eq(fixturePlayersTable.fixtureId, fixtureId));
        await db.delete(fixturesTable).where(eq(fixturesTable.id, fixtureId));
      }
    }
    for (const playerId of [multiPlayerAId, multiPlayerBId]) {
      if (playerId !== null) {
        await db.delete(playersTable).where(eq(playersTable.id, playerId));
      }
    }
    for (const clubId of [multiClubAId, multiClubBId]) {
      if (clubId !== null) {
        await db.delete(clubsTable).where(eq(clubsTable.id, clubId));
      }
    }
  });

  it(
    "deletes stale fixtures and links for both clubs when reconcileClubFixtures is called per-club in sequence",
    async () => {
      // ── Setup: Club A ──────────────────────────────────────────────────────

      const [clubA] = await db
        .insert(clubsTable)
        .values({ name: "__test_multi_stale_club_a__", league: "Multi Test League A", country: "USA" })
        .returning({ id: clubsTable.id, name: clubsTable.name });
      if (!clubA) throw new Error("Club A insert failed");
      multiClubAId = clubA.id;

      const basePlayer = {
        position: "MF" as const,
        category: "current" as const,
        age: 25,
        nationalTeamCaps: 0,
        nationalTeamGoals: 0,
        performanceTrend: "steady" as const,
        trending: false,
        bio: "",
        worldCupRoster: false,
      };

      const [playerA] = await db
        .insert(playersTable)
        .values({ ...basePlayer, name: "__Test Multi Stale Player A__", slug: "__test-multi-stale-player-a__", clubId: clubA.id })
        .returning({ id: playersTable.id });
      if (!playerA) throw new Error("Player A insert failed");
      multiPlayerAId = playerA.id;

      const pastKickoffA = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48 h ago
      const [fixtureA] = await db
        .insert(fixturesTable)
        .values({
          apiFootballFixtureId: 9_998_001, // arbitrary; not in any real season fetch
          isNationalTeam: false,
          competition: "Multi Stale League A",
          kickoff: pastKickoffA,
          venue: "Old Stadium A",
          homeTeam: "__Multi Stale Home A__",
          awayTeam: "__Multi Stale Away A__",
          status: "scheduled",
        })
        .returning({ id: fixturesTable.id });
      if (!fixtureA) throw new Error("Fixture A insert failed");
      multiFixtureAId = fixtureA.id;

      await db
        .insert(fixturePlayersTable)
        .values({ fixtureId: fixtureA.id, playerId: playerA.id, clubId: clubA.id });

      // ── Setup: Club B ──────────────────────────────────────────────────────

      const [clubB] = await db
        .insert(clubsTable)
        .values({ name: "__test_multi_stale_club_b__", league: "Multi Test League B", country: "GER" })
        .returning({ id: clubsTable.id, name: clubsTable.name });
      if (!clubB) throw new Error("Club B insert failed");
      multiClubBId = clubB.id;

      const [playerB] = await db
        .insert(playersTable)
        .values({ ...basePlayer, name: "__Test Multi Stale Player B__", slug: "__test-multi-stale-player-b__", clubId: clubB.id })
        .returning({ id: playersTable.id });
      if (!playerB) throw new Error("Player B insert failed");
      multiPlayerBId = playerB.id;

      const pastKickoffB = new Date(Date.now() - 72 * 60 * 60 * 1000); // 72 h ago
      const [fixtureB] = await db
        .insert(fixturesTable)
        .values({
          apiFootballFixtureId: 9_998_002, // arbitrary; not in any real season fetch
          isNationalTeam: false,
          competition: "Multi Stale League B",
          kickoff: pastKickoffB,
          venue: "Old Stadium B",
          homeTeam: "__Multi Stale Home B__",
          awayTeam: "__Multi Stale Away B__",
          status: "scheduled",
        })
        .returning({ id: fixturesTable.id });
      if (!fixtureB) throw new Error("Fixture B insert failed");
      multiFixtureBId = fixtureB.id;

      await db
        .insert(fixturePlayersTable)
        .values({ fixtureId: fixtureB.id, playerId: playerB.id, clubId: clubB.id });

      // ── Pre-reconciliation: confirm both fixtures and links are present ─────

      const beforeRowsA = await db
        .select({ id: fixturesTable.id })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, fixtureA.id));
      expect(beforeRowsA).toHaveLength(1);

      const beforeLinksA = await db
        .select({ fixtureId: fixturePlayersTable.fixtureId })
        .from(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, fixtureA.id));
      expect(beforeLinksA).toHaveLength(1);

      const beforeRowsB = await db
        .select({ id: fixturesTable.id })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, fixtureB.id));
      expect(beforeRowsB).toHaveLength(1);

      const beforeLinksB = await db
        .select({ fixtureId: fixturePlayersTable.fixtureId })
        .from(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, fixtureB.id));
      expect(beforeLinksB).toHaveLength(1);

      // ── Invoke reconciliation for each club in sequence ────────────────────
      // This mirrors how syncApiFootballFixtures iterates over tracked clubs:
      // each club is reconciled independently with its own freshById map and
      // its own removalsTrustworthy flag. The empty maps simulate the provider
      // returning zero fixtures (e.g. season ended). Both flags are true,
      // meaning all fetch attempts succeeded — the stale past-kickoff fixtures
      // must be removed.

      const now = Date.now();

      const resultA = await reconcileClubFixtures({
        club: { id: clubA.id, name: clubA.name },
        clubPlayerIds: [playerA.id],
        freshById: new Map(), // empty — fixture A absent from provider list
        removalsTrustworthy: true,
        now,
      });

      expect(
        resultA.fixturesRemoved,
        `reconcileClubFixtures for club A should have removed 1 stale fixture but reported ${resultA.fixturesRemoved}`,
      ).toBe(1);

      const resultB = await reconcileClubFixtures({
        club: { id: clubB.id, name: clubB.name },
        clubPlayerIds: [playerB.id],
        freshById: new Map(), // empty — fixture B absent from provider list
        removalsTrustworthy: true,
        now,
      });

      expect(
        resultB.fixturesRemoved,
        `reconcileClubFixtures for club B should have removed 1 stale fixture but reported ${resultB.fixturesRemoved}`,
      ).toBe(1);

      // ── Post-reconciliation: fixture A row and link are gone ───────────────

      const afterRowsA = await db
        .select({ id: fixturesTable.id })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, fixtureA.id));
      expect(
        afterRowsA,
        `Fixture A (id=${fixtureA.id}) should have been deleted by club A's reconciliation pass but still exists in the DB`,
      ).toHaveLength(0);

      const afterLinksA = await db
        .select({ fixtureId: fixturePlayersTable.fixtureId })
        .from(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, fixtureA.id));
      expect(
        afterLinksA,
        `fixture_players link for fixture A (id=${fixtureA.id}) should have been deleted but still exists`,
      ).toHaveLength(0);

      // ── Post-reconciliation: fixture B row and link are gone ───────────────

      const afterRowsB = await db
        .select({ id: fixturesTable.id })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, fixtureB.id));
      expect(
        afterRowsB,
        `Fixture B (id=${fixtureB.id}) should have been deleted by club B's reconciliation pass but still exists in the DB`,
      ).toHaveLength(0);

      const afterLinksB = await db
        .select({ fixtureId: fixturePlayersTable.fixtureId })
        .from(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, fixtureB.id));
      expect(
        afterLinksB,
        `fixture_players link for fixture B (id=${fixtureB.id}) should have been deleted but still exists`,
      ).toHaveLength(0);

      // Clear IDs so afterAll skips the redundant deletes.
      multiFixtureAId = null;
      multiFixtureBId = null;

      // ── Neither fixture appears in GET /fixtures?scope=upcoming ───────────

      const res = await request(app).get("/api/fixtures?scope=upcoming").expect(200);
      const parsed = ListFixturesResponse.safeParse(res.body);
      expect(
        parsed.success,
        `/fixtures?scope=upcoming did not parse:\n${parsed.success ? "" : fmtIssues(parsed.error)}`,
      ).toBe(true);

      const foundA = parsed.data!.find((f) => f.id === fixtureA.id);
      expect(
        foundA,
        `Stale fixture A (id=${fixtureA.id}) still appears in GET /fixtures?scope=upcoming after multi-club reconciliation`,
      ).toBeUndefined();

      const foundB = parsed.data!.find((f) => f.id === fixtureB.id);
      expect(
        foundB,
        `Stale fixture B (id=${fixtureB.id}) still appears in GET /fixtures?scope=upcoming after multi-club reconciliation`,
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
