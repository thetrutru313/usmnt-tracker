/**
 * Integration test: international-window fallback fires and resolves the
 * correct club during a simulated Gold Cup window.
 *
 * ## Scenario
 * A tracked player is stored at "Old Club" in our DB.  During a Gold Cup
 * window, API-Football's `/players/squads` returns only national-team entries
 * (USA and US U20).  The sync must detect that all entries are national teams,
 * fall through to `fetchPlayerCurrentTeamFromStats`, and correctly resolve the
 * player's real club from their season-statistics data (900 minutes at
 * "__IWF Fake Fulham__").
 *
 * ## What is asserted
 * 1. `players.club_id` is updated to the real club resolved from stats, NOT
 *    left pointing at a national-team entry.
 * 2. The resolved club is NOT the player's old club (so we know the fallback
 *    ran, not just the stored-club fall-through).
 * 3. The resolved club row has `apiFootballTeamId` matching the club team id
 *    returned by the stats endpoint (confirms `ensureClubForTeam` ran).
 *
 * ## How `afFetch` is intercepted
 * `afFetch` delegates to `globalThis.fetch`.  `vi.stubGlobal("fetch", ...)``
 * replaces it for the duration of the test so no real network calls are made.
 * The mock routes by URL substring and returns minimal API-Football payloads.
 *
 * ## Timing note
 * The real throttle in `afFetch` spaces calls 2 s apart.  With ~7 sequential
 * API calls in this scenario, the sync takes up to ~14 s.  A 60 s timeout is
 * ample headroom.
 */

import { vi, describe, it, expect, afterAll, afterEach, beforeAll } from "vitest";
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

const FAKE_PLAYER_API_ID    = 9_873_001;
const FAKE_USA_TEAM_ID      = 9_873_100; // Senior USMNT national team
const FAKE_USU20_TEAM_ID    = 9_873_101; // US U20 national team
const FAKE_CLUB_TEAM_ID     = 9_873_200; // Real club — "__IWF Fake Fulham__"
const FAKE_FIXTURE_API_ID   = 9_873_500;

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
 * to simulate a Gold Cup international window:
 *
 *   /players/squads  → USA + US U20 entries only (no club)
 *   /teams?id=<USA|U20>  → national: true
 *   /teams?id=<club>     → national: false (real club)
 *   /players?id=…&season=…  → 900 min at FakeFC (season-stats fallback)
 *   /fixtures?team=…     → one upcoming Premier League fixture
 */
function mockFetch(url: string | URL | Request): Promise<Response> {
  const urlStr =
    typeof url === "string" ? url : url instanceof URL ? url.href : url.url;

  // 1. Squad lookup: only national-team entries — simulates Gold Cup window.
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
          players: [{ id: FAKE_PLAYER_API_ID, name: "Test IWF Player" }],
        },
        {
          team: {
            id: FAKE_USU20_TEAM_ID,
            name: "US U20",
            logo: null,
            national: false, // API-Football bug: US U20 sometimes returns false
          },
          players: [{ id: FAKE_PLAYER_API_ID, name: "Test IWF Player" }],
        },
      ]),
    );
  }

  // 2. Team nationality lookup — distinguish national teams from the real club.
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

    if (teamId === FAKE_USU20_TEAM_ID) {
      return Promise.resolve(
        fakeResponse([
          {
            team: {
              id: FAKE_USU20_TEAM_ID,
              name: "US U20",
              logo: null,
              national: true, // isNationalTeamId should mark this true via name heuristic anyway
              country: "USA",
            },
          },
        ]),
      );
    }

    // The real club — not a national team.
    return Promise.resolve(
      fakeResponse([
        {
          team: {
            id: FAKE_CLUB_TEAM_ID,
            name: "__IWF Fake Fulham__",
            logo: null,
            national: false,
            country: "England",
          },
        },
      ]),
    );
  }

  // 3. Season-stats fallback: 900 minutes at the real club, no national-team
  //    entries so minutesByTeam has exactly one entry to pick.
  if (urlStr.includes("/players?id=") && urlStr.includes("&season=")) {
    return Promise.resolve(
      fakeResponse([
        {
          player: { id: FAKE_PLAYER_API_ID, name: "Test IWF Player" },
          statistics: [
            {
              team: {
                id: FAKE_CLUB_TEAM_ID,
                name: "__IWF Fake Fulham__",
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

  // 4. Fixtures for the real club — one upcoming Premier League match.
  if (urlStr.includes("/fixtures?team=")) {
    return Promise.resolve(
      fakeResponse([
        {
          fixture: {
            id: FAKE_FIXTURE_API_ID,
            date: FAKE_KICKOFF.toISOString(),
            status: { short: "NS", elapsed: null },
            venue: { name: "Craven Cottage" },
          },
          league: { name: "Premier League" },
          teams: {
            home: {
              id: FAKE_CLUB_TEAM_ID,
              name: "__IWF Fake Fulham__",
              logo: null,
            },
            away: {
              id: 9_873_901,
              name: "__IWF Opponent__",
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

beforeAll(async () => {
  // Guard against stale rows left by a previously crashed run.
  // Delete in FK order: fixture_players → fixtures → players → clubs.
  const staleFixture = await db
    .select({ id: fixturesTable.id })
    .from(fixturesTable)
    .where(eq(fixturesTable.apiFootballFixtureId, FAKE_FIXTURE_API_ID))
    .then((rows) => rows[0]);
  if (staleFixture) {
    await db.delete(fixturePlayersTable).where(eq(fixturePlayersTable.fixtureId, staleFixture.id)).catch(() => {});
    await db.delete(fixturesTable).where(eq(fixturesTable.id, staleFixture.id)).catch(() => {});
  }
  await db.delete(playersTable).where(eq(playersTable.slug, "__iwf-test-player__")).catch(() => {});
  await db.delete(clubsTable).where(eq(clubsTable.apiFootballTeamId, FAKE_CLUB_TEAM_ID)).catch(() => {});
});

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
  // Also remove any club row auto-created by ensureClubForTeam for the fake club.
  await db
    .delete(clubsTable)
    .where(eq(clubsTable.apiFootballTeamId, FAKE_CLUB_TEAM_ID))
    .catch(() => { /* ignore — may already be deleted above */ });
});

// ─── Suite ────────────────────────────────────────────────────────────────────

describe(
  "syncApiFootballFixtures — international-window fallback (Gold Cup simulation)",
  () => {
    it(
      "resolves the correct club via season-stats when /players/squads returns only national-team entries",
      async () => {
        // ── 0. Stub globalThis.fetch before any DB inserts ───────────────────
        vi.stubGlobal("fetch", mockFetch);

        // ── 1. Seed: old club (stale stored club_id before the window) ────────
        const [oldClub] = await db
          .insert(clubsTable)
          .values({
            name: "__IWF Old Club__",
            league: "Test Old League",
            country: "USA",
          })
          .returning({ id: clubsTable.id });
        if (!oldClub) throw new Error("Old club insert failed");
        insertedClubIds.push(oldClub.id);

        // ── 2. Seed: tracked player at the old club with a fake API player id ─
        const [player] = await db
          .insert(playersTable)
          .values({
            name: "__IWF Test Player__",
            slug: "__iwf-test-player__",
            position: "MF",
            category: "current",
            clubId: oldClub.id,
            age: 23,
            nationalTeamCaps: 5,
            nationalTeamGoals: 0,
            bio: "",
            worldCupRoster: false,
            apiFootballPlayerId: FAKE_PLAYER_API_ID,
          })
          .returning({ id: playersTable.id });
        if (!player) throw new Error("Player insert failed");
        insertedPlayerIds.push(player.id);

        // ── 3. Run the full player-centric sync scoped to just this player ────
        //    afFetch is intercepted via stubbed globalThis.fetch.
        const result = await syncApiFootballFixtures([player.id]);

        // The sync must have processed at least one club (the real club from stats).
        expect(
          result.clubsSynced,
          `Expected at least 1 club synced; got ${result.clubsSynced}. ` +
            "The season-stats fallback may not have returned a club, or ensureClubForTeam failed.",
        ).toBeGreaterThanOrEqual(1);

        // ── Outcome 1: ensureClubForTeam created a club row for the real club ─
        const [resolvedClub] = await db
          .select({ id: clubsTable.id, name: clubsTable.name })
          .from(clubsTable)
          .where(eq(clubsTable.apiFootballTeamId, FAKE_CLUB_TEAM_ID));

        expect(
          resolvedClub,
          `No clubs row with apiFootballTeamId=${FAKE_CLUB_TEAM_ID} was created. ` +
            "The season-stats fallback did not reach ensureClubForTeam.",
        ).toBeDefined();

        // Track so afterAll cleans it up (may already be in insertedClubIds if
        // a previous assertion added it — safe to push regardless, the WHERE
        // clause is idempotent).
        if (resolvedClub) insertedClubIds.push(resolvedClub.id);

        // ── Outcome 2: players.club_id updated to the real club, not old club ─
        const [updatedPlayer] = await db
          .select({ clubId: playersTable.clubId })
          .from(playersTable)
          .where(eq(playersTable.id, player.id));

        expect(
          updatedPlayer?.clubId,
          `players.club_id was not updated. ` +
            `Expected the real club id (${resolvedClub?.id}), ` +
            `got ${updatedPlayer?.clubId} (old club id was ${oldClub.id}). ` +
            "The international-window fallback did not update the player's club.",
        ).toBe(resolvedClub?.id);

        // Belt-and-suspenders: confirm the player was NOT left at the old club.
        expect(
          updatedPlayer?.clubId,
          `players.club_id still points at the old club (id=${oldClub.id}). ` +
            "The fallback ran but did not override the stored club_id.",
        ).not.toBe(oldClub.id);

        // ── Outcome 3: players.club_id is NOT a national-team entry ──────────
        // The sync must never assign the player to USA or US U20.  We verify by
        // checking that the resolved club has a non-null apiFootballTeamId equal
        // to FAKE_CLUB_TEAM_ID (the real club), not one of the national-team ids.
        expect(
          resolvedClub?.id,
          `players.club_id resolved to the wrong club. ` +
            "The international-window guard did not filter the national-team entries.",
        ).toBe(updatedPlayer?.clubId);
      },
      60_000,
    );
  },
);
