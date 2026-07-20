/**
 * End-to-end integration guard: confirms that `syncApiFootballFixtures` handles
 * a mid-season transfer correctly within a single sweep — without hitting the
 * real API.
 *
 * ## Scenario
 * A tracked player (Weah stand-in) is stored at an old club in our DB but
 * has since moved to Marseille.  The test stubs `globalThis.fetch` so every
 * `afFetch` call inside the sync returns controlled data instead of hitting
 * v3.football.api-sports.io.
 *
 * ## Five outcomes asserted
 * 1. `ensureClubForTeam` creates (or finds) the Marseille club row in `clubs`.
 * 2. `players.club_id` is updated to the Marseille club id.
 * 3. A `fixtures` row is inserted for the Marseille upcoming fixture.
 * 4. A `fixture_players` link connects the player to that fixture.
 * 5. `GET /fixtures?scope=upcoming` returns the fixture with the player in
 *    `featuredPlayers`.
 *
 * ## How `afFetch` is intercepted
 * `afFetch` (in apiFootballSync.ts) delegates to the global `fetch`.  Vitest's
 * `vi.stubGlobal("fetch", ...)` replaces that binding process-wide for the
 * duration of the test so no real network calls are made.  The mock routes by
 * URL path to return minimal but structurally-correct API-Football JSON payloads.
 *
 * ## Timing note
 * The real `throttle()` inside `afFetch` spaces calls 2 s apart to respect the
 * API-Football rate limit.  The test runs against the real throttle (safe
 * because no actual I/O is waiting) and is therefore given a 90 s timeout to
 * accommodate ≤ 3 sequential throttle sleeps (≤ 6 s in total).
 */

import { vi, describe, it, expect, afterAll, afterEach } from "vitest";
import request from "supertest";
import app from "../../app.js";
import {
  db,
  clubsTable,
  playersTable,
  fixturesTable,
  fixturePlayersTable,
} from "@workspace/db";
import { eq, inArray, and } from "drizzle-orm";
import { ListFixturesResponse } from "@workspace/api-zod";
import { syncApiFootballFixtures } from "../apiFootballSync.js";

// ─── Fake API-Football identifiers ───────────────────────────────────────────
// Use large, unusual numbers that won't collide with real dev-DB rows.

const FAKE_PLAYER_API_ID = 9_880_001;
const FAKE_MARSEILLE_TEAM_ID = 9_880_081; // Marseille's real id is 81; use a fake
const FAKE_FIXTURE_API_ID = 9_880_500;
const FAKE_KICKOFF = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // 10 days out

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Safe pretty-printer for Zod issues — keeps assertion messages readable. */
function fmtIssues(err: {
  issues: Array<{ path: unknown[]; message: string; code: string }>;
}): string {
  return err.issues
    .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message} [${i.code}]`)
    .join("\n");
}

/**
 * Build a minimal `Response`-like object whose `.json()` returns
 * `{ response: data, errors: {} }`, matching what `afFetch` expects.
 */
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
 * and returns minimal, structurally-correct API-Football JSON payloads.
 */
function mockFetch(url: string | URL | Request): Promise<Response> {
  const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;

  // 1. Squad lookup: which team is this player currently registered with?
  if (urlStr.includes("/players/squads")) {
    return Promise.resolve(
      fakeResponse([
        {
          team: {
            id: FAKE_MARSEILLE_TEAM_ID,
            name: "Marseille",
            logo: "https://example.com/marseille.png",
            national: false,
          },
          players: [{ id: FAKE_PLAYER_API_ID, name: "Test Weah" }],
        },
      ]),
    );
  }

  // 2. Team nationality lookup: confirm Marseille is not a national team.
  if (urlStr.includes("/teams?id=")) {
    return Promise.resolve(
      fakeResponse([
        {
          team: {
            id: FAKE_MARSEILLE_TEAM_ID,
            name: "Marseille",
            logo: null,
            national: false,
          },
        },
      ]),
    );
  }

  // 3. Fixtures fetch: return one upcoming Ligue 1 fixture.
  if (urlStr.includes("/fixtures?team=")) {
    return Promise.resolve(
      fakeResponse([
        {
          fixture: {
            id: FAKE_FIXTURE_API_ID,
            date: FAKE_KICKOFF.toISOString(),
            status: { short: "NS", elapsed: null },
            venue: { name: "Orange Vélodrome" },
          },
          league: { name: "Ligue 1" },
          teams: {
            home: {
              id: FAKE_MARSEILLE_TEAM_ID,
              name: "Marseille",
              logo: "https://example.com/marseille.png",
            },
            away: {
              id: 99_001,
              name: "__PCSync Opponent__",
              logo: null,
            },
          },
          goals: { home: null, away: null },
        },
      ]),
    );
  }

  // Anything else: return an empty response so afFetch doesn't throw.
  return Promise.resolve(fakeResponse([]));
}

// ─── Cleanup state ────────────────────────────────────────────────────────────

const insertedClubIds: number[] = [];
const insertedPlayerIds: number[] = [];
const insertedFixtureIds: number[] = [];

afterEach(() => {
  // Restore globalThis.fetch after each test so other tests are unaffected.
  vi.unstubAllGlobals();
});

afterAll(async () => {
  // Fixtures before players/clubs (FK order).
  if (insertedFixtureIds.length > 0) {
    await db
      .delete(fixturePlayersTable)
      .where(inArray(fixturePlayersTable.fixtureId, insertedFixtureIds));
    await db
      .delete(fixturesTable)
      .where(inArray(fixturesTable.id, insertedFixtureIds));
  }
  // Also delete any fixture rows the sync inserted via apiFootballFixtureId,
  // in case the test left them behind (e.g. if an assertion failed early).
  await db
    .delete(fixturePlayersTable)
    .where(
      and(
        eq(fixturesTable.apiFootballFixtureId, FAKE_FIXTURE_API_ID),
      ),
    )
    .catch(() => {
      /* ignore — belt-and-suspenders only */
    });
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
  // Also clean up any club row ensureClubForTeam auto-created for Marseille.
  await db
    .delete(clubsTable)
    .where(eq(clubsTable.apiFootballTeamId, FAKE_MARSEILLE_TEAM_ID))
    .catch(() => {
      /* ignore */
    });
});

// ─── Suite ───────────────────────────────────────────────────────────────────

describe(
  "syncApiFootballFixtures — mid-season transfer resolved within one sweep (no real API)",
  () => {
    it(
      "creates the Marseille club, updates club_id, inserts the fixture, links the player, and serves it via /fixtures?scope=upcoming",
      async () => {
        // ── 0. Stub globalThis.fetch ─────────────────────────────────────────
        vi.stubGlobal("fetch", mockFetch);

        // ── 1. Seed: old club (the one stored in players.club_id before the transfer)
        const [oldClub] = await db
          .insert(clubsTable)
          .values({
            name: "__PCSync Old Club__",
            league: "Test Old League",
            country: "USA",
          })
          .returning({ id: clubsTable.id });
        if (!oldClub) throw new Error("Old club insert failed");
        insertedClubIds.push(oldClub.id);

        // ── 2. Seed: tracked player at the old club with a real API player id
        const [player] = await db
          .insert(playersTable)
          .values({
            name: "__PCSync Test Weah__",
            slug: "__pcsync-test-weah__",
            position: "FW",
            category: "current",
            clubId: oldClub.id, // stale — player is actually at Marseille now
            age: 24,
            nationalTeamCaps: 10,
            nationalTeamGoals: 1,
            performanceTrend: "steady",
            trending: false,
            bio: "",
            worldCupRoster: false,
            apiFootballPlayerId: FAKE_PLAYER_API_ID,
          })
          .returning({ id: playersTable.id });
        if (!player) throw new Error("Player insert failed");
        insertedPlayerIds.push(player.id);

        // ── 3. Run the full player-centric sync, scoped to just this player ──
        //    afFetch is intercepted via the stubbed globalThis.fetch above.
        const result = await syncApiFootballFixtures([player.id]);

        // The sync should have processed at least one club (Marseille).
        expect(
          result.clubsSynced,
          `Expected at least 1 club synced, got ${result.clubsSynced} — sync may have failed early`,
        ).toBeGreaterThanOrEqual(1);

        // ── Outcome 1: ensureClubForTeam created a Marseille club row ─────────
        const [marseilleClub] = await db
          .select({ id: clubsTable.id, name: clubsTable.name })
          .from(clubsTable)
          .where(eq(clubsTable.apiFootballTeamId, FAKE_MARSEILLE_TEAM_ID));
        expect(
          marseilleClub,
          `No clubs row with apiFootballTeamId=${FAKE_MARSEILLE_TEAM_ID} was created — ensureClubForTeam may not have run`,
        ).toBeDefined();
        insertedClubIds.push(marseilleClub!.id);

        // ── Outcome 2: players.club_id updated to the Marseille club id ───────
        const [updatedPlayer] = await db
          .select({ clubId: playersTable.clubId })
          .from(playersTable)
          .where(eq(playersTable.id, player.id));
        expect(
          updatedPlayer?.clubId,
          `players.club_id was not updated to marseilleClub.id=${marseilleClub!.id} — ` +
            `still shows ${updatedPlayer?.clubId} (old club id ${oldClub.id})`,
        ).toBe(marseilleClub!.id);

        // ── Outcome 3: a fixtures row was inserted for the Marseille fixture ──
        const [syncedFixture] = await db
          .select({ id: fixturesTable.id, competition: fixturesTable.competition })
          .from(fixturesTable)
          .where(eq(fixturesTable.apiFootballFixtureId, FAKE_FIXTURE_API_ID));
        expect(
          syncedFixture,
          `No fixtures row found with apiFootballFixtureId=${FAKE_FIXTURE_API_ID} — ` +
            `the Marseille fixture was not inserted by the sync`,
        ).toBeDefined();
        insertedFixtureIds.push(syncedFixture!.id);

        // ── Outcome 4: fixture_players link connects the player to that fixture
        const links = await db
          .select({ playerId: fixturePlayersTable.playerId, clubId: fixturePlayersTable.clubId })
          .from(fixturePlayersTable)
          .where(eq(fixturePlayersTable.fixtureId, syncedFixture!.id));
        const playerLink = links.find((l) => l.playerId === player.id);
        expect(
          playerLink,
          `No fixture_players link found for player id=${player.id} on fixture id=${syncedFixture!.id} — ` +
            `the sync did not tag the player to the Marseille fixture`,
        ).toBeDefined();
        expect(
          playerLink?.clubId,
          `fixture_players.club_id should be Marseille's club id (${marseilleClub!.id}) but got ${playerLink?.clubId}`,
        ).toBe(marseilleClub!.id);

        // ── Outcome 5: GET /fixtures?scope=upcoming serves the Marseille fixture
        //    with the player in featuredPlayers ──────────────────────────────
        const res = await request(app).get("/api/fixtures?scope=upcoming").expect(200);
        const parsed = ListFixturesResponse.safeParse(res.body);
        expect(
          parsed.success,
          `/fixtures?scope=upcoming response did not parse:\n${parsed.success ? "" : fmtIssues(parsed.error)}`,
        ).toBe(true);

        const found = parsed.data!.find((f) => f.id === syncedFixture!.id);
        expect(
          found,
          `Marseille fixture id=${syncedFixture!.id} is missing from /fixtures?scope=upcoming — ` +
            `the sync wrote it to the DB but the route is not serving it`,
        ).toBeDefined();

        const featuredIds = (found!.featuredPlayers ?? []).map((p: { id: number }) => p.id);
        expect(
          featuredIds,
          `Player id=${player.id} is not in featuredPlayers on fixture id=${syncedFixture!.id} — ` +
            `the fixture_players link exists but the route query is not joining it`,
        ).toContain(player.id);
      },
      90_000, // real throttle sleeps: ≤ 3 calls × 2 s = ≤ 6 s; 90 s is ample headroom
    );
  },
);
