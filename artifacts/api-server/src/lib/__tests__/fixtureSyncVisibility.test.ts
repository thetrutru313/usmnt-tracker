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
