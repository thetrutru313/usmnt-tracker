/**
 * Integration test: confirms that `syncApiFootballFixtures` only writes
 * `squadLastCheckedAt` when `/players/squads` returns a usable club result —
 * not when the API call fails.
 *
 * ## What & Why
 * Previously the timestamp was stamped unconditionally before checking the
 * result. A failed or rate-limited squad call therefore blocked re-resolution
 * for up to 6 hours (SQUAD_CACHE_TTL_MS), locking a transferred player at
 * the wrong club long after the transfer was completed.
 *
 * The fix: the stamp fires only after a successful club resolution. A null
 * result (fetch failure, API error, or international-window-only squad) leaves
 * `squadLastCheckedAt` untouched so the next sync retries immediately.
 *
 * ## How `fetch` is intercepted
 * `afFetch` delegates to `globalThis.fetch`. `vi.stubGlobal("fetch", ...)`
 * replaces it for the duration of the test — no real network calls are made.
 *
 * ## DB rows
 * Real rows are inserted with large collision-safe IDs and cleaned up in
 * `afterAll`, matching the pattern used by internationalWindowFallback.test.ts.
 */

import { vi, describe, it, expect, afterAll, afterEach } from "vitest";
import { db, clubsTable, playersTable, fixturesTable, fixturePlayersTable } from "@workspace/db";
import { eq, inArray, like } from "drizzle-orm";
import { syncApiFootballFixtures } from "../apiFootballSync.js";

// ---------------------------------------------------------------------------
// Base fake identifiers — large values, won't collide with real rows.
// Each inserted club/player gets a unique offset so tests don't conflict.
// ---------------------------------------------------------------------------

const BASE_CLUB_API_ID   = 9_875_000;
const BASE_PLAYER_API_ID = 9_875_100;
let   testCounter        = 0;

// ---------------------------------------------------------------------------
// Response builder
// ---------------------------------------------------------------------------

function fakeResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ response: data, errors: {} }),
    text: async () => JSON.stringify({ response: data, errors: {} }),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Cleanup tracking
// ---------------------------------------------------------------------------

const insertedPlayerIds: number[] = [];
const insertedClubIds:   number[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  // Remove any fixture_players / fixtures the sync may have inserted.
  const linkedFixtures = await db
    .select({ id: fixturesTable.id })
    .from(fixturesTable)
    .where(like(fixturesTable.homeTeam, "__SCSS%"));

  if (linkedFixtures.length > 0) {
    const fids = linkedFixtures.map((f) => f.id);
    await db.delete(fixturePlayersTable).where(inArray(fixturePlayersTable.fixtureId, fids));
    await db.delete(fixturesTable).where(inArray(fixturesTable.id, fids));
  }

  if (insertedPlayerIds.length > 0) {
    await db.delete(playersTable).where(inArray(playersTable.id, insertedPlayerIds));
  }
  if (insertedClubIds.length > 0) {
    await db.delete(clubsTable).where(inArray(clubsTable.id, insertedClubIds));
  }
});

// ---------------------------------------------------------------------------
// Per-test helpers — each call gets a unique API id offset via testCounter
// ---------------------------------------------------------------------------

async function insertTestClub(): Promise<{ id: number; apiId: number }> {
  const n = testCounter++;
  const apiId = BASE_CLUB_API_ID + n;
  const [club] = await db
    .insert(clubsTable)
    .values({
      name: `__SCSS Test Club ${n}__`,
      apiFootballTeamId: apiId,
      league: "Test League",
      country: "USA",
    })
    .returning({ id: clubsTable.id });
  if (!club?.id) throw new Error("Failed to insert test club");
  insertedClubIds.push(club.id);
  return { id: club.id, apiId };
}

async function insertTestPlayer(
  clubId: number,
  clubOverrideId: number | null = null,
): Promise<{ id: number; apiId: number }> {
  const n = testCounter++;
  const apiId = BASE_PLAYER_API_ID + n;
  const [player] = await db
    .insert(playersTable)
    .values({
      name: `__SCSS Test Player ${n}__`,
      slug: `scss-test-player-${n}-${Date.now()}`,
      position: "MF",
      category: "prospect",
      clubId,
      age: 22,
      apiFootballPlayerId: apiId,
      nationalTeamCaps: 0,
      nationalTeamGoals: 0,
      bio: "",
      worldCupRoster: false,
      clubOverrideId,
      squadLastCheckedAt: null, // fresh — always triggers the squad API call
    })
    .returning({ id: playersTable.id });
  if (!player?.id) throw new Error("Failed to insert test player");
  insertedPlayerIds.push(player.id);
  return { id: player.id, apiId };
}

// ---------------------------------------------------------------------------
// Suite 1: Failed squad call → squadLastCheckedAt NOT written
// ---------------------------------------------------------------------------

describe("squad-cache stamp — failed squad call leaves timestamp untouched", () => {
  it("does NOT write squadLastCheckedAt when the API returns an error response", async () => {
    const club   = await insertTestClub();
    const player = await insertTestPlayer(club.id);

    // All API calls return an error envelope — simulates a rate-limit hit.
    vi.stubGlobal("fetch", (_url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ response: [], errors: { requests: "Rate limit exceeded" } }),
        text: async () => "rate limit",
      } as unknown as Response),
    );

    await syncApiFootballFixtures([player.id]);

    const [after] = await db
      .select({ squadLastCheckedAt: playersTable.squadLastCheckedAt })
      .from(playersTable)
      .where(eq(playersTable.id, player.id));

    expect(
      after?.squadLastCheckedAt,
      [
        "squadLastCheckedAt must NOT be written when fetchPlayerCurrentTeam returns null.",
        "Writing it on failure locks the player at the wrong club for 6 hours.",
      ].join("\n"),
    ).toBeNull();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Suite 2: Successful squad call → squadLastCheckedAt IS written
// ---------------------------------------------------------------------------

describe("squad-cache stamp — successful squad call writes timestamp", () => {
  it("DOES write squadLastCheckedAt when a club is resolved successfully", async () => {
    const club   = await insertTestClub();
    const player = await insertTestPlayer(club.id);

    // Route fetch calls by URL pattern using the actual dynamic club API id.
    vi.stubGlobal("fetch", (url: string) => {
      if (url.includes("/players/squads")) {
        return Promise.resolve(
          fakeResponse([
            {
              team: {
                id: club.apiId,
                name: `__SCSS Test Club__`,
                logo: null,
                national: false,
              },
              players: [{ id: player.apiId, name: "__SCSS Test Player__" }],
            },
          ]),
        );
      }
      if (url.includes("/teams?id=")) {
        // Nationality check — confirm it's not a national team.
        return Promise.resolve(
          fakeResponse([
            {
              team: {
                id: club.apiId,
                name: "__SCSS Test Club__",
                national: false,
                country: "USA",
              },
            },
          ]),
        );
      }
      // Fixture fetches — empty to keep state simple.
      return Promise.resolve(fakeResponse([]));
    });

    await syncApiFootballFixtures([player.id]);

    const [after] = await db
      .select({ squadLastCheckedAt: playersTable.squadLastCheckedAt })
      .from(playersTable)
      .where(eq(playersTable.id, player.id));

    expect(
      after?.squadLastCheckedAt,
      [
        "squadLastCheckedAt must be written when fetchPlayerCurrentTeam resolves a club.",
        "This enables the 6-hour cache and reduces API quota usage.",
        `Got: ${JSON.stringify(after?.squadLastCheckedAt)}`,
      ].join("\n"),
    ).not.toBeNull();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Suite 3: Admin club override → squad API call is skipped, no stamp written
// ---------------------------------------------------------------------------

describe("squad-cache stamp — club override skips the squad API call", () => {
  it("does NOT call /players/squads or write squadLastCheckedAt when clubOverrideId is set", async () => {
    const club   = await insertTestClub();
    // Override = same club as clubId — the override path fires regardless of match.
    const player = await insertTestPlayer(club.id, club.id);

    let squadFetchCount = 0;
    vi.stubGlobal("fetch", (url: string) => {
      if (url.includes("/players/squads")) squadFetchCount++;
      return Promise.resolve(fakeResponse([]));
    });

    await syncApiFootballFixtures([player.id]);

    expect(
      squadFetchCount,
      "No /players/squads API call must be made when clubOverrideId is set.",
    ).toBe(0);

    const [after] = await db
      .select({ squadLastCheckedAt: playersTable.squadLastCheckedAt })
      .from(playersTable)
      .where(eq(playersTable.id, player.id));

    expect(
      after?.squadLastCheckedAt,
      "squadLastCheckedAt must NOT be written when the club override path is taken.",
    ).toBeNull();
  }, 30_000);
});
