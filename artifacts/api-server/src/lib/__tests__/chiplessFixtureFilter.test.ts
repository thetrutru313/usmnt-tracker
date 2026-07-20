/**
 * Regression guard: confirms that GET /fixtures?scope=upcoming excludes
 * non-national-team fixture cards that have zero fixture_players entries.
 *
 * ## Why this matters
 * When a player transfers away from a club, `purgeStaleTransferredPlayerLinks`
 * removes their `fixture_players` rows but the `fixtures` row itself is kept as
 * a historical record. Without a filter, the fixture card still appears in the
 * UI but shows zero player chips — confusing and misleading.
 *
 * The fix adds an EXISTS filter on `fixture_players` for date-scoped requests
 * (`scope=upcoming`, `scope=today`), so only fixtures with at least one
 * currently-linked tracked player are returned.
 *
 * ## What is tested
 * 1. A future non-national-team fixture with NO fixture_players entry is
 *    NOT returned by GET /fixtures?scope=upcoming.
 * 2. A future non-national-team fixture WITH a fixture_players entry IS
 *    returned by GET /fixtures?scope=upcoming.
 * 3. Adding a fixture_players entry to the formerly-chipless fixture causes it
 *    to appear in the response immediately (no restart needed).
 * 4. A future national-team fixture with NO fixture_players entry IS returned
 *    (national-team fixtures are always shown regardless of player links).
 * 5. The filter does not apply when scope is absent (no scope param) — the
 *    route is used for historical/admin views; chipless old fixtures are fine there.
 *
 * ## Test data isolation
 * Every inserted row uses a name prefix "__CFF_" so cleanup is predictable.
 * afterAll deletes in FK-safe reverse order (fixture_players → fixtures →
 * players → clubs).
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
import { eq, inArray } from "drizzle-orm";
import { ListFixturesResponse } from "@workspace/api-zod";

// ─── Cleanup state ─────────────────────────────────────────────────────────

const insertedClubIds: number[] = [];
const insertedPlayerIds: number[] = [];
const insertedFixtureIds: number[] = [];

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
      performanceTrend: "steady" as const,
      trending: false,
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

  it("does NOT filter chipless club fixtures when no scope param is provided", async () => {
    // The no-scope route is used for historical/admin views; filtering there
    // would hide legitimate past records. Chipless upcoming fixtures should
    // still be visible when no scope is requested.
    const club = await insertClub("__CFF NoScope Club__");
    const fixture = await insertFixture({
      homeTeam: "__CFF NoScope Home FC__",
      awayTeam: "__CFF NoScope Away FC__",
    });
    // No fixture_players link.

    const res = await request(app).get("/api/fixtures").expect(200);
    const fixtures = parseUpcoming(res.body); // schema is same regardless of scope

    const noScopeFixture = fixtures.find((f) => f.id === fixture.id);
    expect(noScopeFixture).toBeDefined();

    void club;
  });
});
