/**
 * Unit/integration test: season-stats fallback picks the highest-minutes club
 * when a player split time across two clubs mid-season.
 *
 * ## Scenario
 * A tracked player is stored at "Old Club" in our DB.  During an international
 * window, `/players/squads` returns only national-team entries (USA).  The sync
 * falls through to `fetchPlayerCurrentTeamFromStats`, which calls
 * `/players?id=&season=` and receives stats from TWO non-national clubs:
 *   - Club A ("__SSMC Club A__"): 600 minutes
 *   - Club B ("__SSMC Club B__"): 900 minutes
 *
 * The fallback must pick Club B (most total minutes), not Club A (first entry).
 *
 * ## What is asserted
 * 1. `players.club_id` is updated to Club B (900-min club).
 * 2. `players.club_id` is NOT updated to Club A (600-min club).
 * 3. A club row with apiFootballTeamId equal to FAKE_CLUB_B_TEAM_ID is created.
 *
 * ## How `afFetch` is intercepted
 * `afFetch` delegates to `globalThis.fetch`.  `vi.stubGlobal("fetch", ...)`
 * replaces it for the duration of the test so no real network calls are made.
 *
 * ## Timing note
 * The real throttle in `afFetch` spaces calls 2 s apart.  With ~7 sequential
 * API calls in this scenario, the sync takes up to ~14 s.  A 60 s timeout is
 * ample headroom.
 */

import { vi, describe, it, expect, afterAll, afterEach } from "vitest";
import {
  db,
  clubsTable,
  playersTable,
  fixturesTable,
  fixturePlayersTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { syncApiFootballFixtures } from "../apiFootballSync.js";

// ─── Fake API-Football identifiers ───────────────────────────────────────────
// Use large, unusual numbers that won't collide with real dev-DB rows or other
// test files.

const FAKE_PLAYER_API_ID     = 9_874_001;
const FAKE_USA_TEAM_ID       = 9_874_100; // Senior USMNT national team
const FAKE_CLUB_A_TEAM_ID    = 9_874_200; // Club A — 600 min (the wrong pick)
const FAKE_CLUB_B_TEAM_ID    = 9_874_201; // Club B — 900 min (the correct pick)
const FAKE_FIXTURE_API_ID    = 9_874_500;

const FAKE_KICKOFF = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days out

// ─── Minimal Response builder ─────────────────────────────────────────────────

function fakeResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ response: data, errors: {} }),
    text: async () => JSON.stringify({ response: data, errors: {} }),
  } as unknown as Response;
}

// ─── Mock routing ─────────────────────────────────────────────────────────────

/**
 * Intercepts all `fetch()` calls made by `afFetch`.  Routes by URL substring
 * to simulate an international window where the player split minutes across
 * two clubs (600 min at Club A, 900 min at Club B):
 *
 *   /players/squads  → USA national team only (triggers fallback)
 *   /teams?id=<USA>  → national: true
 *   /teams?id=<A>    → national: false (real club, 600 min)
 *   /teams?id=<B>    → national: false (real club, 900 min)
 *   /players?id=…&season=…  → two stat entries: Club A 600 min, Club B 900 min
 *   /fixtures?team=…  → one upcoming fixture for Club B
 */
function mockFetch(url: string | URL | Request): Promise<Response> {
  const urlStr =
    typeof url === "string" ? url : url instanceof URL ? url.href : url.url;

  // 1. Squad lookup: only USA national team — simulates international window.
  if (urlStr.includes("/players/squads")) {
    return Promise.resolve(
      fakeResponse([
        {
          team: {
            id: FAKE_USA_TEAM_ID,
            name: "USA",
            logo: null,
            national: true,
          },
          players: [{ id: FAKE_PLAYER_API_ID, name: "Test SSMC Player" }],
        },
      ]),
    );
  }

  // 2. Team nationality lookup — national team vs real clubs.
  if (urlStr.includes("/teams?id=")) {
    const idMatch = urlStr.match(/\/teams\?id=(\d+)/);
    const teamId = idMatch ? parseInt(idMatch[1], 10) : 0;

    if (teamId === FAKE_USA_TEAM_ID) {
      return Promise.resolve(
        fakeResponse([
          {
            team: {
              id: FAKE_USA_TEAM_ID,
              name: "USA",
              logo: null,
              national: true,
              country: "USA",
            },
          },
        ]),
      );
    }

    if (teamId === FAKE_CLUB_A_TEAM_ID) {
      return Promise.resolve(
        fakeResponse([
          {
            team: {
              id: FAKE_CLUB_A_TEAM_ID,
              name: "__SSMC Club A__",
              logo: null,
              national: false,
              country: "England",
            },
          },
        ]),
      );
    }

    if (teamId === FAKE_CLUB_B_TEAM_ID) {
      return Promise.resolve(
        fakeResponse([
          {
            team: {
              id: FAKE_CLUB_B_TEAM_ID,
              name: "__SSMC Club B__",
              logo: null,
              national: false,
              country: "England",
            },
          },
        ]),
      );
    }

    // Default: non-national.
    return Promise.resolve(fakeResponse([{ team: { id: teamId, name: "Unknown", logo: null, national: false, country: "Unknown" } }]));
  }

  // 3. Season-stats fallback: two non-national clubs, Club A 600 min, Club B 900 min.
  //    The fallback MUST pick Club B (most minutes).
  if (urlStr.includes("/players?id=") && urlStr.includes("&season=")) {
    return Promise.resolve(
      fakeResponse([
        {
          player: { id: FAKE_PLAYER_API_ID, name: "Test SSMC Player" },
          statistics: [
            {
              team: {
                id: FAKE_CLUB_A_TEAM_ID,
                name: "__SSMC Club A__",
                logo: null,
              },
              league: {
                id: 39,
                name: "Premier League",
                country: "England",
                season: new Date().getUTCFullYear(),
              },
              games: { minutes: 600, appearences: 7 },
            },
            {
              team: {
                id: FAKE_CLUB_B_TEAM_ID,
                name: "__SSMC Club B__",
                logo: null,
              },
              league: {
                id: 39,
                name: "Premier League",
                country: "England",
                season: new Date().getUTCFullYear(),
              },
              games: { minutes: 900, appearences: 10 },
            },
          ],
        },
      ]),
    );
  }

  // 4. Fixtures for Club B — one upcoming Premier League match.
  if (urlStr.includes("/fixtures?team=")) {
    return Promise.resolve(
      fakeResponse([
        {
          fixture: {
            id: FAKE_FIXTURE_API_ID,
            date: FAKE_KICKOFF.toISOString(),
            status: { short: "NS", elapsed: null },
            venue: { name: "SSMC Stadium" },
          },
          league: { name: "Premier League" },
          teams: {
            home: {
              id: FAKE_CLUB_B_TEAM_ID,
              name: "__SSMC Club B__",
              logo: null,
            },
            away: {
              id: 9_874_901,
              name: "__SSMC Opponent__",
              logo: null,
            },
          },
          goals: { home: null, away: null },
        },
      ]),
    );
  }

  // Fallback: return empty response so afFetch doesn't throw.
  return Promise.resolve(fakeResponse([]));
}

// ─── Cleanup tracking ─────────────────────────────────────────────────────────

const insertedClubIds: number[] = [];
const insertedPlayerIds: number[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  // Clean up fixture_players and fixtures created by the sync.
  const [syncedFixture] = await db
    .select({ id: fixturesTable.id })
    .from(fixturesTable)
    .where(eq(fixturesTable.apiFootballFixtureId, FAKE_FIXTURE_API_ID));
  if (syncedFixture) {
    await db
      .delete(fixturePlayersTable)
      .where(eq(fixturePlayersTable.fixtureId, syncedFixture.id));
    await db
      .delete(fixturesTable)
      .where(eq(fixturesTable.id, syncedFixture.id));
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
  // Also remove club rows auto-created by ensureClubForTeam.
  await db
    .delete(clubsTable)
    .where(eq(clubsTable.apiFootballTeamId, FAKE_CLUB_A_TEAM_ID))
    .catch(() => { /* ignore */ });
  await db
    .delete(clubsTable)
    .where(eq(clubsTable.apiFootballTeamId, FAKE_CLUB_B_TEAM_ID))
    .catch(() => { /* ignore */ });
});

// ─── Suite ────────────────────────────────────────────────────────────────────

describe(
  "fetchPlayerCurrentTeamFromStats — multi-club minutes aggregation",
  () => {
    it(
      "picks the 900-min club over the 600-min club when a player split minutes across two clubs",
      async () => {
        // ── 0. Stub globalThis.fetch before any DB inserts ───────────────────
        vi.stubGlobal("fetch", mockFetch);

        // ── 1. Seed: old club (stale stored club_id before the window) ────────
        const [oldClub] = await db
          .insert(clubsTable)
          .values({
            name: "__SSMC Old Club__",
            league: "Test Old League",
            country: "USA",
          })
          .returning({ id: clubsTable.id });
        if (!oldClub) throw new Error("Old club insert failed");
        insertedClubIds.push(oldClub.id);

        // ── 2. Seed: tracked player at the old club ──────────────────────────
        const [player] = await db
          .insert(playersTable)
          .values({
            name: "__SSMC Test Player__",
            slug: `__ssmc-test-player-${Date.now()}__`,
            position: "MF",
            category: "current",
            clubId: oldClub.id,
            age: 25,
            nationalTeamCaps: 8,
            nationalTeamGoals: 1,
            bio: "",
            worldCupRoster: false,
            apiFootballPlayerId: FAKE_PLAYER_API_ID,
          })
          .returning({ id: playersTable.id });
        if (!player) throw new Error("Player insert failed");
        insertedPlayerIds.push(player.id);

        // ── 3. Run the full player-centric sync scoped to just this player ────
        const result = await syncApiFootballFixtures([player.id]);

        // The sync must have processed at least one club (Club B from stats).
        expect(
          result.clubsSynced,
          `Expected at least 1 club synced; got ${result.clubsSynced}. ` +
            "The season-stats fallback may not have returned a club, or ensureClubForTeam failed.",
        ).toBeGreaterThanOrEqual(1);

        // ── Outcome 1: a club row was created for Club B (900-min club) ───────
        const [resolvedClubB] = await db
          .select({ id: clubsTable.id, name: clubsTable.name })
          .from(clubsTable)
          .where(eq(clubsTable.apiFootballTeamId, FAKE_CLUB_B_TEAM_ID));

        expect(
          resolvedClubB,
          `No clubs row with apiFootballTeamId=${FAKE_CLUB_B_TEAM_ID} (Club B, 900 min) was created. ` +
            "The season-stats fallback did not pick the highest-minutes club.",
        ).toBeDefined();

        if (resolvedClubB) insertedClubIds.push(resolvedClubB.id);

        // ── Outcome 2: players.club_id updated to Club B (900-min) ───────────
        const [updatedPlayer] = await db
          .select({ clubId: playersTable.clubId })
          .from(playersTable)
          .where(eq(playersTable.id, player.id));

        expect(
          updatedPlayer?.clubId,
          `players.club_id was not updated to Club B (900-min). ` +
            `Expected ${resolvedClubB?.id}, got ${updatedPlayer?.clubId}. ` +
            "The fallback may have picked the first entry (Club A) instead of the highest-minutes club (Club B).",
        ).toBe(resolvedClubB?.id);

        // ── Outcome 3: players.club_id is NOT the 600-min club (Club A) ──────
        const [resolvedClubA] = await db
          .select({ id: clubsTable.id })
          .from(clubsTable)
          .where(eq(clubsTable.apiFootballTeamId, FAKE_CLUB_A_TEAM_ID));

        // Club A may or may not have a row — what matters is the player is NOT
        // assigned to it.
        if (resolvedClubA) {
          insertedClubIds.push(resolvedClubA.id);
          expect(
            updatedPlayer?.clubId,
            `players.club_id points at Club A (600-min, id=${resolvedClubA.id}). ` +
              "The fallback picked the first entry instead of the highest-minutes club.",
          ).not.toBe(resolvedClubA.id);
        }

        // Belt-and-suspenders: player must not still be at the old club.
        expect(
          updatedPlayer?.clubId,
          `players.club_id still points at the old club (id=${oldClub.id}). ` +
            "The season-stats fallback did not run or did not update the player's club.",
        ).not.toBe(oldClub.id);
      },
      60_000,
    );
  },
);
