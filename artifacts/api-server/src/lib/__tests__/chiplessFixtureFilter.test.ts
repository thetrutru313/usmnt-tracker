/**
 * Regression guard: confirms that GET /fixtures hides upcoming non-national-team
 * fixture cards that have zero fixture_players entries, regardless of scope.
 *
 * ## Why this matters
 * When a player transfers away from a club, `purgeStaleTransferredPlayerLinks`
 * removes their `fixture_players` rows but the `fixtures` row itself is kept as
 * a historical record. Without a filter, the fixture card still appears in the
 * UI but shows zero player chips — confusing and misleading.
 *
 * The Fixtures page calls scope=all (so it can render both upcoming and recent
 * finished matches in one request), so the filter must apply regardless of scope
 * parameter. It is gated on kickoff time — upcoming chipless fixtures are hidden,
 * past chipless fixtures remain as historical records.
 *
 * ## What is tested
 * 1. A future non-NT fixture with NO fixture_players entry is NOT returned by
 *    GET /fixtures?scope=upcoming.
 * 2. A future non-NT fixture WITH a fixture_players entry IS returned.
 * 3. Adding a fixture_players link to a chipless fixture makes it appear
 *    immediately (no restart needed).
 * 4. A future national-team fixture with NO fixture_players IS returned
 *    (NT fixtures always show regardless of player links).
 * 5. A future chipless non-NT fixture is also hidden when scope=all (Fixtures
 *    page path).
 * 6. A PAST chipless non-NT fixture IS returned even without a scope param —
 *    historical records must remain visible.
 *
 * ## Test data isolation
 * Every inserted row uses a name prefix "__CFF_" so cleanup is predictable.
 * afterAll deletes in FK-safe reverse order (fixture_players → fixtures →
 * players → clubs).
 */

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import {
  db,
  clubsTable,
  playersTable,
  fixturesTable,
  fixturePlayersTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { ListFixturesResponse } from "@workspace/api-zod";
import {
  purgeStaleTransferredPlayerLinks,
  runRepairPass,
} from "../apiFootballSync.js";
import type { AfFixture } from "../fixtureReconciliation.js";

// ─── Cleanup state ─────────────────────────────────────────────────────────

const insertedClubIds: number[] = [];
const insertedPlayerIds: number[] = [];
const insertedFixtureIds: number[] = [];

/**
 * Purge any stale CFF rows left by a prior run whose afterAll cleanup failed.
 * This prevents unique-constraint errors when test setup re-inserts the same slugs/IDs.
 */
beforeAll(async () => {
  // 1. Remove stale fixtures by known API IDs used in this suite (cascade their players links).
  const staleFixtures = await db
    .select({ id: fixturesTable.id })
    .from(fixturesTable)
    .where(inArray(fixturesTable.apiFootballFixtureId, [9_740_001]));
  if (staleFixtures.length > 0) {
    const staleFixtureIds = staleFixtures.map((r) => r.id);
    await db
      .delete(fixturePlayersTable)
      .where(inArray(fixturePlayersTable.fixtureId, staleFixtureIds));
    await db
      .delete(fixturesTable)
      .where(inArray(fixturesTable.id, staleFixtureIds));
  }

  // 2. Remove stale players by slug, then cascade their fixture_players links.
  const stalePlayers = await db
    .select({ id: playersTable.id })
    .from(playersTable)
    .where(
      inArray(playersTable.slug, [
        "__cff-linked-player__",
        "__cff-late-link-player__",
        "__cff-return-player__",
        "__cff-nt-player__",
        "__cff-past-player__",
        "__cff-scope-all-player__",
      ]),
    );
  if (stalePlayers.length > 0) {
    const stalePlayerIds = stalePlayers.map((r) => r.id);
    await db
      .delete(fixturePlayersTable)
      .where(inArray(fixturePlayersTable.playerId, stalePlayerIds));
    await db.delete(playersTable).where(inArray(playersTable.id, stalePlayerIds));
  }
});

afterAll(async () => {
  if (insertedFixtureIds.length > 0) {
    await db
      .delete(fixturePlayersTable)
      .where(inArray(fixturePlayersTable.fixtureId, insertedFixtureIds));
    await db
      .delete(fixturesTable)
      .where(inArray(fixturesTable.id, insertedFixtureIds));
  }
  if (insertedPlayerIds.length > 0) {
    await db
      .delete(playersTable)
      .where(inArray(playersTable.id, insertedPlayerIds));
  }
  if (insertedClubIds.length > 0) {
    await db
      .delete(clubsTable)
      .where(inArray(clubsTable.id, insertedClubIds));
  }
});

// ─── Helpers ───────────────────────────────────────────────────────────────

async function insertClub(name: string) {
  const [club] = await db
    .insert(clubsTable)
    .values({ name, league: "__CFF Test League__", country: "USA" })
    .returning({ id: clubsTable.id });
  if (!club) throw new Error(`Club insert failed: ${name}`);
  insertedClubIds.push(club.id);
  return club;
}

async function insertPlayer(name: string, clubId: number) {
  const [player] = await db
    .insert(playersTable)
    .values({
      name,
      slug: name.toLowerCase().replace(/\s+/g, "-"),
      position: "MF" as const,
      category: "current" as const,
      clubId,
      age: 25,
      nationalTeamCaps: 0,
      nationalTeamGoals: 0,
      bio: "",
      worldCupRoster: false,
    })
    .returning({ id: playersTable.id });
  if (!player) throw new Error(`Player insert failed: ${name}`);
  insertedPlayerIds.push(player.id);
  return player;
}

async function insertFixture(opts: {
  homeTeam: string;
  awayTeam: string;
  isNationalTeam?: boolean;
  /** Hours from now (positive = future, negative = past) */
  kickoffOffsetHours?: number;
}) {
  const offsetMs = (opts.kickoffOffsetHours ?? 48) * 60 * 60 * 1000;
  const kickoff = new Date(Date.now() + offsetMs);
  const [fixture] = await db
    .insert(fixturesTable)
    .values({
      isNationalTeam: opts.isNationalTeam ?? false,
      competition: "__CFF Test Competition__",
      kickoff,
      venue: "__CFF Venue__",
      homeTeam: opts.homeTeam,
      awayTeam: opts.awayTeam,
      status: "scheduled",
    })
    .returning({ id: fixturesTable.id });
  if (!fixture) throw new Error(`Fixture insert failed: ${opts.homeTeam} vs ${opts.awayTeam}`);
  insertedFixtureIds.push(fixture.id);
  return fixture;
}

async function linkPlayer(fixtureId: number, playerId: number, clubId: number) {
  await db
    .insert(fixturePlayersTable)
    .values({ fixtureId, playerId, clubId });
}

function parseUpcoming(body: unknown) {
  const parsed = ListFixturesResponse.safeParse(body);
  if (!parsed.success) {
    throw new Error(
      `Response did not parse as ListFixturesResponse:\n${
        parsed.error.issues
          .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("\n")
      }`,
    );
  }
  return parsed.data;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("GET /fixtures?scope=upcoming — chipless club fixture filter", () => {
  it("excludes a future non-national-team fixture that has no fixture_players entry", async () => {
    // Insert a club with no tracked players, and a future fixture for it.
    // Nothing links any player to this fixture — simulating a club whose last
    // tracked player just transferred away.
    const club = await insertClub("__CFF Chipless Club__");
    const fixture = await insertFixture({
      homeTeam: "__CFF Chipless Home FC__",
      awayTeam: "__CFF Chipless Away FC__",
    });
    // Intentionally: NO fixture_players insert.

    const res = await request(app).get("/api/fixtures?scope=upcoming").expect(200);
    const fixtures = parseUpcoming(res.body);

    const chiplessFixture = fixtures.find((f) => f.id === fixture.id);
    expect(chiplessFixture).toBeUndefined();

    // Suppress TS unused-variable warning; club.id is used by afterAll cleanup.
    void club;
  });

  it("includes a future non-national-team fixture that has a fixture_players entry", async () => {
    const club = await insertClub("__CFF Linked Club__");
    const player = await insertPlayer("__CFF Linked Player__", club.id);
    const fixture = await insertFixture({
      homeTeam: "__CFF Linked Home FC__",
      awayTeam: "__CFF Linked Away FC__",
    });
    await linkPlayer(fixture.id, player.id, club.id);

    const res = await request(app).get("/api/fixtures?scope=upcoming").expect(200);
    const fixtures = parseUpcoming(res.body);

    const linkedFixture = fixtures.find((f) => f.id === fixture.id);
    expect(linkedFixture).toBeDefined();
  });

  it("makes a chipless fixture visible immediately once a fixture_players link is added", async () => {
    // Step 1: insert a chipless fixture (simulates post-transfer state).
    const club = await insertClub("__CFF Late-Link Club__");
    const player = await insertPlayer("__CFF Late-Link Player__", club.id);
    const fixture = await insertFixture({
      homeTeam: "__CFF Late-Link Home FC__",
      awayTeam: "__CFF Late-Link Away FC__",
    });
    // No link yet.

    const res1 = await request(app).get("/api/fixtures?scope=upcoming").expect(200);
    expect(parseUpcoming(res1.body).find((f) => f.id === fixture.id)).toBeUndefined();

    // Step 2: add the link (simulates the repair pass or a new sync).
    await linkPlayer(fixture.id, player.id, club.id);

    // Step 3: confirm the fixture now appears — no restart needed.
    const res2 = await request(app).get("/api/fixtures?scope=upcoming").expect(200);
    expect(parseUpcoming(res2.body).find((f) => f.id === fixture.id)).toBeDefined();
  });

  it("always includes a national-team future fixture even with no fixture_players entry", async () => {
    // National-team fixtures are curated/seeded and are shown regardless of
    // how many players are currently linked.
    const fixture = await insertFixture({
      homeTeam: "__CFF NT Home__",
      awayTeam: "__CFF NT Away__",
      isNationalTeam: true,
    });
    // No fixture_players link — intentional.

    const res = await request(app).get("/api/fixtures?scope=upcoming").expect(200);
    const fixtures = parseUpcoming(res.body);

    const ntFixture = fixtures.find((f) => f.id === fixture.id);
    expect(ntFixture).toBeDefined();
  });

  it("hides an upcoming chipless club fixture even when scope=all is used (Fixtures page path)", async () => {
    // The Fixtures page calls scope=all so it can render both upcoming and recent
    // finished games. The filter must still suppress chipless upcoming fixtures
    // on this path — scope=all is NOT a bypass.
    const club = await insertClub("__CFF ScopeAll Club__");
    const fixture = await insertFixture({
      homeTeam: "__CFF ScopeAll Home FC__",
      awayTeam: "__CFF ScopeAll Away FC__",
    });
    // No fixture_players link.

    const res = await request(app).get("/api/fixtures?scope=all").expect(200);
    const fixtures = parseUpcoming(res.body);

    const scopeAllFixture = fixtures.find((f) => f.id === fixture.id);
    expect(scopeAllFixture).toBeUndefined();

    void club;
  });

  it("always shows a PAST chipless club fixture — historical records are preserved", async () => {
    // A fixture whose kickoff has already passed is a historical record even if
    // its player links were later removed (e.g. the player transferred). It must
    // remain visible so past match history is not lost.
    const club = await insertClub("__CFF Past Club__");
    const fixture = await insertFixture({
      homeTeam: "__CFF Past Home FC__",
      awayTeam: "__CFF Past Away FC__",
      kickoffOffsetHours: -48, // 2 days in the past
    });
    // No fixture_players link — simulates a post-transfer purge.

    const res = await request(app).get("/api/fixtures").expect(200);
    const fixtures = parseUpcoming(res.body);

    const pastFixture = fixtures.find((f) => f.id === fixture.id);
    expect(pastFixture).toBeDefined();

    void club;
  });

  it(
    "fixture card reappears after player transfers back to the original club and runRepairPass runs",
    async () => {
      // This test covers the full round-trip:
      //
      //   1. Player at Club A, linked to Club A's upcoming fixture  → fixture visible
      //   2. Player transfers to Club B (players.club_id updated)
      //   3. purgeStaleTransferredPlayerLinks removes the stale Club A link
      //      → fixture disappears (chipless)
      //   4. Player transfers back to Club A (players.club_id restored)
      //   5. runRepairPass(Club A) recreates the fixture_players link
      //      → fixture reappears in GET /fixtures?scope=upcoming
      //
      // The apiFootballFixtureId on the fixture is required so runRepairPass
      // can match the DB row via its freshById map.

      // ── 1a. Insert Club A (home of the fixture) and Club B (temporary club) ─
      const clubA = await insertClub("__CFF Return Club A__");
      const clubB = await insertClub("__CFF Return Club B__");

      // ── 1b. Insert the player — initially at Club A ───────────────────────
      const player = await insertPlayer("__CFF Return Player__", clubA.id);

      // ── 1c. Insert an upcoming fixture belonging to Club A ─────────────────
      //    A stable fake API-Football fixture id is required by runRepairPass.
      const FAKE_API_ID = 9_740_001; // large, collision-free with other suites
      const FAKE_TEAM_ID = 974_001;

      const [fixtureRow] = await db
        .insert(fixturesTable)
        .values({
          isNationalTeam: false,
          competition: "__CFF Return League__",
          kickoff: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
          venue: "__CFF Return Stadium__",
          homeTeam: "__CFF Return Club A__",
          awayTeam: "__CFF Return Opponent__",
          status: "scheduled",
          apiFootballFixtureId: FAKE_API_ID,
        })
        .returning({ id: fixturesTable.id });
      if (!fixtureRow) throw new Error("Return fixture insert failed");
      insertedFixtureIds.push(fixtureRow.id);

      // Link the player to the fixture (club_id = Club A, as a fresh sync would).
      await linkPlayer(fixtureRow.id, player.id, clubA.id);

      // Confirm the fixture is visible at this point.
      const res1 = await request(app).get("/api/fixtures?scope=upcoming").expect(200);
      expect(
        parseUpcoming(res1.body).find((f) => f.id === fixtureRow.id),
        "fixture must be visible before the transfer",
      ).toBeDefined();

      // ── 2. Simulate a transfer away: move the player to Club B ────────────
      await db
        .update(playersTable)
        .set({ clubId: clubB.id })
        .where(eq(playersTable.id, player.id));

      // ── 3. Purge: removes the stale Club A link ───────────────────────────
      //    Scope the purge to only the players inserted by this test.
      const { purged } = await purgeStaleTransferredPlayerLinks({
        scopeToPlayerIds: [player.id],
      });
      expect(purged, "purge should remove at least the stale Club A link").toBeGreaterThanOrEqual(1);

      // The fixture must now be hidden (chipless).
      const res2 = await request(app).get("/api/fixtures?scope=upcoming").expect(200);
      expect(
        parseUpcoming(res2.body).find((f) => f.id === fixtureRow.id),
        "fixture must be hidden after the player transfers away (chipless)",
      ).toBeUndefined();

      // ── 4. Simulate the return transfer: move the player back to Club A ───
      await db
        .update(playersTable)
        .set({ clubId: clubA.id })
        .where(eq(playersTable.id, player.id));

      // ── 5. Repair pass: recreates the Club A link ─────────────────────────
      //    Build a minimal AfFixture stub so runRepairPass can match the
      //    DB fixture via its apiFootballFixtureId.
      const freshById = new Map<number, AfFixture>([
        [
          FAKE_API_ID,
          {
            fixture: {
              id: FAKE_API_ID,
              date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
              status: { short: "NS", elapsed: null },
              venue: { name: "__CFF Return Stadium__" },
            },
            league: { name: "__CFF Return League__" },
            teams: {
              home: { id: FAKE_TEAM_ID, name: "__CFF Return Club A__", logo: null },
              away: { id: FAKE_TEAM_ID + 1, name: "__CFF Return Opponent__", logo: null },
            },
            goals: { home: null, away: null },
          },
        ],
      ]);

      await runRepairPass({
        club: { id: clubA.id, name: "__CFF Return Club A__" },
        teamId: FAKE_TEAM_ID,
        freshById,
        clubPlayerIds: [player.id],
      });

      // ── 6. Fixture must reappear in the route response ────────────────────
      const res3 = await request(app).get("/api/fixtures?scope=upcoming").expect(200);
      const reappeared = parseUpcoming(res3.body).find((f) => f.id === fixtureRow.id);
      expect(
        reappeared,
        "fixture must reappear after the player returns to Club A and runRepairPass runs",
      ).toBeDefined();

      // The player chip must be present in featuredPlayers.
      const featuredIds = (reappeared!.featuredPlayers ?? []).map((p: { id: number }) => p.id);
      expect(
        featuredIds,
        `player id=${player.id} must appear in featuredPlayers after the return transfer + repair pass`,
      ).toContain(player.id);

      // Keep TS happy for unused-variable lint; cleanup is handled by afterAll.
      void clubB;
    },
    60_000,
  );
});
