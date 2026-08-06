/**
 * Integration guard: confirms that syncYouthNtFixtures inserts a newly-
 * discovered knockout-round fixture into the DB and that it surfaces on
 * GET /api/fixtures with is_national_team=true and correct field values —
 * without a code change or server redeploy.
 *
 * ## What is tested
 * Suite A — existing sync-path coverage:
 * 1. A fixture returned by API-Football that does NOT yet exist in the DB
 *    (new knockout round, not in the startup seed) is inserted by
 *    syncYouthNtFixtures and immediately appears in GET /api/fixtures.
 *    - is_national_team is true
 *    - homeTeam, awayTeam, competition, status, streamingService are correct
 *    - The response parses against the Zod schema
 * 2. Edge case: a fixture already present in the DB (seeded by startup or a
 *    prior sync run) is NOT duplicated when the sync re-encounters it —
 *    ON CONFLICT by api_football_fixture_id is safe.
 *
 * Suite B — fresh-DB / startup-seed + first-sync integration:
 * 3. After a blank fixture table is populated only by the startup seed
 *    (group-stage rows) and syncYouthNtFixtures is then run, every fixture
 *    the API returns (group-stage + knockout) appears on GET /api/fixtures.
 * 4. The startup-seeded group-stage rows survive the sync — the phantom purge
 *    must not delete them when the API still returns their ids.
 *
 * ## How it works
 * - vi.stubGlobal("fetch", mockFetch) intercepts the afFetch calls made by
 *   syncYouthNtFixtures so no real network traffic is needed.
 * - The mock returns one "new" fixture (FAKE_NEW_AF_ID) and one "pre-seeded"
 *   fixture (FAKE_PRESEEDED_AF_ID) for each of the four team/season requests.
 * - syncYouthNtFixtures is called directly; no separate HTTP server is needed
 *   for the sync itself.
 * - The Fixtures endpoint is exercised via supertest(app) to confirm DB changes
 *   are immediately visible without a restart.
 * - afterAll removes only the rows this test inserted, keyed by the fake IDs.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { db, fixturesTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { ListFixturesResponse } from "@workspace/api-zod";
import { syncYouthNtFixtures } from "../apiFootballSync.js";

// ─── constants ───────────────────────────────────────────────────────────────

/** Fake api_football_fixture_id for the brand-new fixture the sync should insert. */
const FAKE_NEW_AF_ID = 9_999_200;

/** Fake api_football_fixture_id for the fixture pre-seeded before sync runs. */
const FAKE_PRESEEDED_AF_ID = 9_999_201;

/** Kickoff 30 days from now — well into the "upcoming" window. */
const FAKE_KICKOFF_NEW = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const FAKE_KICKOFF_PRESEEDED = new Date(Date.now() + 35 * 24 * 60 * 60 * 1000).toISOString();

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtIssues(err: { issues: Array<{ path: unknown[]; message: string; code: string }> }): string {
  return err.issues.map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message} [${i.code}]`).join("\n");
}

/** Wraps data in the `{ response, errors }` envelope that afFetch expects. */
function fakeResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ response: data, errors: {} }),
    text: async () => JSON.stringify({ response: data, errors: {} }),
  } as unknown as Response;
}

/**
 * Returns two fixtures for every /fixtures?team=...&season=... call:
 * - FAKE_NEW_AF_ID: a brand-new knockout-round fixture (United States U20 vs
 *   Brazil U20) that represents a dynamically-scheduled round not in the seed.
 * - FAKE_PRESEEDED_AF_ID: a fixture that will be pre-inserted before the sync
 *   runs, used to verify ON CONFLICT idempotency.
 *
 * Both fixtures include "United States U20" as a participant so they pass
 * the isUsMensNationalTeamName filter inside syncYouthNtFixtures.
 *
 * All other URL patterns (team search, squad lookup, etc.) receive an empty
 * array response so afFetch doesn't throw.
 */
function mockFetch(url: string | URL | Request): Promise<Response> {
  const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;

  if (urlStr.includes("/fixtures?team=")) {
    return Promise.resolve(
      fakeResponse([
        {
          fixture: {
            id: FAKE_NEW_AF_ID,
            date: FAKE_KICKOFF_NEW,
            status: { short: "NS", elapsed: null },
            venue: { name: "Estadio Universitario BUAP" },
          },
          league: { name: "CONCACAF U20" },
          teams: {
            home: {
              id: 10306,
              name: "United States U20",
              logo: "https://media.api-sports.io/football/teams/10306.png",
            },
            away: {
              id: 19_000,
              name: "Brazil U20",
              logo: "https://media.api-sports.io/football/teams/9.png",
            },
          },
          goals: { home: null, away: null },
        },
        {
          fixture: {
            id: FAKE_PRESEEDED_AF_ID,
            date: FAKE_KICKOFF_PRESEEDED,
            status: { short: "NS", elapsed: null },
            venue: { name: "Estadio Test" },
          },
          league: { name: "CONCACAF U20" },
          teams: {
            home: {
              id: 10306,
              name: "United States U20",
              logo: "https://media.api-sports.io/football/teams/10306.png",
            },
            away: {
              id: 19_001,
              name: "Colombia U20",
              logo: "https://media.api-sports.io/football/teams/111.png",
            },
          },
          goals: { home: null, away: null },
        },
      ]),
    );
  }

  // Anything else: return empty so afFetch doesn't throw.
  return Promise.resolve(fakeResponse([]));
}

// ─── cleanup state ────────────────────────────────────────────────────────────

const fakeAfIds = [FAKE_NEW_AF_ID, FAKE_PRESEEDED_AF_ID];

afterAll(async () => {
  vi.unstubAllGlobals();
  // Remove only the rows this test suite inserted, identified by fake IDs.
  await db
    .delete(fixturesTable)
    .where(inArray(fixturesTable.apiFootballFixtureId, fakeAfIds));
});

// ─── test suite ───────────────────────────────────────────────────────────────

describe("syncYouthNtFixtures — newly-scheduled knockout fixture appears without a redeploy", () => {
  /**
   * Pre-insert the "already seeded" fixture so it exists before syncYouthNtFixtures
   * runs. This lets Test 2 verify the ON CONFLICT path is safe.
   */
  beforeAll(async () => {
    // Ensure no leftover rows from a previous run.
    await db
      .delete(fixturesTable)
      .where(inArray(fixturesTable.apiFootballFixtureId, fakeAfIds));

    // Insert the pre-seeded row (simulates what the startup seed does).
    await db.insert(fixturesTable).values({
      apiFootballFixtureId: FAKE_PRESEEDED_AF_ID,
      isNationalTeam: true,
      competition: "CONCACAF U20",
      kickoff: new Date(FAKE_KICKOFF_PRESEEDED),
      venue: "Estadio Test",
      homeTeam: "United States U20",
      awayTeam: "Colombia U20",
      homeLogoUrl: "https://media.api-sports.io/football/teams/10306.png",
      awayLogoUrl: "https://media.api-sports.io/football/teams/111.png",
      status: "scheduled",
      tvNetwork: "FOX Sports",
      streamingService: "Fox One",
    });

    // Run the sync with the mocked fetch.
    vi.stubGlobal("fetch", mockFetch);
    await syncYouthNtFixtures();
    vi.unstubAllGlobals();
  }, 60_000);

  it(
    "1. newly-inserted fixture appears in GET /api/fixtures with is_national_team=true and correct fields",
    async () => {
      // Confirm the row exists in the DB first — isolates a DB miss from a route miss.
      const dbRows = await db
        .select()
        .from(fixturesTable)
        .where(eq(fixturesTable.apiFootballFixtureId, FAKE_NEW_AF_ID));

      expect(
        dbRows,
        `syncYouthNtFixtures should have inserted a row with api_football_fixture_id=${FAKE_NEW_AF_ID} ` +
          `but no such row exists in the fixtures table — the upsert may have silently failed`,
      ).toHaveLength(1);

      const dbRow = dbRows[0]!;
      expect(dbRow.isNationalTeam).toBe(true);
      expect(dbRow.homeTeam).toBe("United States U20");
      expect(dbRow.awayTeam).toBe("Brazil U20");
      expect(dbRow.competition).toBe("CONCACAF U20");
      expect(dbRow.status).toBe("scheduled");
      // BROADCAST_BY_LEAGUE maps "CONCACAF U20" to Fox One
      expect(dbRow.streamingService).toBe("Fox One");
      expect(dbRow.tvNetwork).toBe("FOX Sports");

      // Now confirm the route immediately reflects the new row — no restart.
      const res = await request(app).get("/api/fixtures").expect(200);

      const parsed = ListFixturesResponse.safeParse(res.body);
      expect(
        parsed.success,
        `GET /api/fixtures response did not parse:\n${parsed.success ? "" : fmtIssues(parsed.error)}`,
      ).toBe(true);

      const found = parsed.data!.find((f) => f.id === dbRow.id);
      expect(
        found,
        `Fixture id=${dbRow.id} (api_football_fixture_id=${FAKE_NEW_AF_ID}, ` +
          `newly inserted by syncYouthNtFixtures) is missing from GET /api/fixtures — ` +
          `the route may be filtering national-team fixtures or caching stale data`,
      ).toBeDefined();

      expect(found!.isNationalTeam).toBe(true);
      expect(found!.homeTeam).toBe("United States U20");
      expect(found!.awayTeam).toBe("Brazil U20");
      expect(found!.competition).toBe("CONCACAF U20");
      expect(found!.status).toBe("scheduled");
    },
    30_000,
  );

  it(
    "2. fixture already in the DB is not duplicated when sync re-encounters it (ON CONFLICT is safe)",
    async () => {
      // syncYouthNtFixtures returned FAKE_PRESEEDED_AF_ID which was already in the DB.
      // The function should have updated the existing row (not inserted a second one).
      const countResult = await db.execute(
        sql`SELECT COUNT(*)::int AS cnt FROM fixtures WHERE api_football_fixture_id = ${FAKE_PRESEEDED_AF_ID}`,
      ) as unknown as { rows: Array<{ cnt: number }> };

      const count = countResult.rows[0]?.cnt ?? 0;
      expect(
        count,
        `Expected exactly 1 fixture row with api_football_fixture_id=${FAKE_PRESEEDED_AF_ID} ` +
          `after syncYouthNtFixtures re-encountered the pre-seeded fixture, but found ${count} rows — ` +
          `the ON CONFLICT / upsert path may be inserting duplicates instead of updating`,
      ).toBe(1);
    },
    30_000,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite B: fresh DB + startup seed + first sync cycle
// ─────────────────────────────────────────────────────────────────────────────
//
// Fake api_football_fixture_ids used exclusively by this suite — chosen to
// avoid colliding with Suite A's IDs (9_999_200 / 9_999_201) or any real data.
const FAKE_SEED_GS_ID_1  = 9_998_100; // group-stage fixture 1, pre-seeded before sync
const FAKE_SEED_GS_ID_2  = 9_998_101; // group-stage fixture 2, pre-seeded before sync
const FAKE_KNOCKOUT_ID   = 9_998_102; // knockout fixture, NOT pre-seeded — sync inserts it

const seedFakeAfIds = [FAKE_SEED_GS_ID_1, FAKE_SEED_GS_ID_2, FAKE_KNOCKOUT_ID];

// Kickoffs sufficiently far in the future so the phantom-purge's "kickoff already
// passed" guard does not skip the seeded group-stage rows.
const FAKE_GS_KICKOFF_1  = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString();
const FAKE_GS_KICKOFF_2  = new Date(Date.now() + 43 * 24 * 60 * 60 * 1000).toISOString();
const FAKE_KO_KICKOFF    = new Date(Date.now() + 50 * 24 * 60 * 60 * 1000).toISOString();

/**
 * Mock for Suite B: returns all three fixtures (both group-stage seeds AND the
 * knockout round) for every /fixtures?team=... call.  This simulates the real
 * API-Football behaviour where both group-stage and knockout fixtures appear
 * together in the team's fixture list once the knockout is scheduled.
 *
 * Returning the group-stage ids is critical: it keeps them out of the "phantom"
 * set so purgePhantomYouthNtFixtures does not delete them after the sync.
 *
 * Both fixtures use "United States U20" as a participant so they pass the
 * isUsMensNationalTeamName filter inside syncYouthNtFixtures.
 */
function mockFetchB(url: string | URL | Request): Promise<Response> {
  const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;

  if (urlStr.includes("/fixtures?team=")) {
    return Promise.resolve(
      fakeResponse([
        // Group-stage fixture 1 — matches what the startup seed inserted.
        {
          fixture: {
            id: FAKE_SEED_GS_ID_1,
            date: FAKE_GS_KICKOFF_1,
            status: { short: "NS", elapsed: null },
            venue: { name: "Estadio Universitario BUAP" },
          },
          league: { name: "CONCACAF U20" },
          teams: {
            home: {
              id: 10306,
              name: "United States U20",
              logo: "https://media.api-sports.io/football/teams/10306.png",
            },
            away: {
              id: 11003,
              name: "Haiti U20",
              logo: "https://media.api-sports.io/football/teams/11003.png",
            },
          },
          goals: { home: null, away: null },
        },
        // Group-stage fixture 2 — matches what the startup seed inserted.
        {
          fixture: {
            id: FAKE_SEED_GS_ID_2,
            date: FAKE_GS_KICKOFF_2,
            status: { short: "NS", elapsed: null },
            venue: { name: "Estadio Universitario BUAP" },
          },
          league: { name: "CONCACAF U20" },
          teams: {
            home: {
              id: 10998,
              name: "El Salvador U20",
              logo: "https://media.api-sports.io/football/teams/10998.png",
            },
            away: {
              id: 10306,
              name: "United States U20",
              logo: "https://media.api-sports.io/football/teams/10306.png",
            },
          },
          goals: { home: null, away: null },
        },
        // Knockout fixture — brand-new, NOT in the startup seed.
        {
          fixture: {
            id: FAKE_KNOCKOUT_ID,
            date: FAKE_KO_KICKOFF,
            status: { short: "NS", elapsed: null },
            venue: { name: "Estadio Knockout" },
          },
          league: { name: "CONCACAF U20" },
          teams: {
            home: {
              id: 10306,
              name: "United States U20",
              logo: "https://media.api-sports.io/football/teams/10306.png",
            },
            away: {
              id: 9,
              name: "Brazil U20",
              logo: "https://media.api-sports.io/football/teams/9.png",
            },
          },
          goals: { home: null, away: null },
        },
      ]),
    );
  }

  return Promise.resolve(fakeResponse([]));
}

afterAll(async () => {
  await db
    .delete(fixturesTable)
    .where(inArray(fixturesTable.apiFootballFixtureId, seedFakeAfIds));
});

describe("syncYouthNtFixtures — fresh-DB startup seed + first sync cycle produces complete fixture list", () => {
  /**
   * Simulate what happens on a fresh deploy:
   * 1. Wipe any leftover rows from a previous test run.
   * 2. Insert only the group-stage fixtures (what index.ts startup seed does).
   * 3. Run syncYouthNtFixtures — the sync should insert the knockout fixture
   *    AND leave the group-stage rows untouched.
   */
  beforeAll(async () => {
    // Ensure a clean slate for this suite's fake ids.
    await db
      .delete(fixturesTable)
      .where(inArray(fixturesTable.apiFootballFixtureId, seedFakeAfIds));

    // Simulate the startup seed: insert only the group-stage fixtures.
    await db.insert(fixturesTable).values([
      {
        apiFootballFixtureId: FAKE_SEED_GS_ID_1,
        isNationalTeam: true,
        competition: "CONCACAF U20",
        kickoff: new Date(FAKE_GS_KICKOFF_1),
        venue: "Estadio Universitario BUAP",
        homeTeam: "United States U20",
        awayTeam: "Haiti U20",
        homeLogoUrl: "https://media.api-sports.io/football/teams/10306.png",
        awayLogoUrl: "https://media.api-sports.io/football/teams/11003.png",
        status: "scheduled",
        tvNetwork: "FOX Sports",
        streamingService: "Fox One",
      },
      {
        apiFootballFixtureId: FAKE_SEED_GS_ID_2,
        isNationalTeam: true,
        competition: "CONCACAF U20",
        kickoff: new Date(FAKE_GS_KICKOFF_2),
        venue: "Estadio Universitario BUAP",
        homeTeam: "El Salvador U20",
        awayTeam: "United States U20",
        homeLogoUrl: "https://media.api-sports.io/football/teams/10998.png",
        awayLogoUrl: "https://media.api-sports.io/football/teams/10306.png",
        status: "scheduled",
        tvNetwork: "FOX Sports",
        streamingService: "Fox One",
      },
    ]);

    // First sync run — the API now also returns the knockout fixture.
    vi.stubGlobal("fetch", mockFetchB);
    await syncYouthNtFixtures();
    vi.unstubAllGlobals();
  }, 60_000);

  it(
    "3. knockout fixture returned by the API appears in GET /api/fixtures after the first sync",
    async () => {
      // Confirm the knockout row exists in the DB.
      const dbRows = await db
        .select()
        .from(fixturesTable)
        .where(eq(fixturesTable.apiFootballFixtureId, FAKE_KNOCKOUT_ID));

      expect(
        dbRows,
        `syncYouthNtFixtures should have inserted a knockout fixture with ` +
          `api_football_fixture_id=${FAKE_KNOCKOUT_ID}, but no such row was found — ` +
          `the insert path may be broken or the mock is not reaching the upsert`,
      ).toHaveLength(1);

      const dbRow = dbRows[0]!;
      expect(dbRow.isNationalTeam).toBe(true);
      expect(dbRow.homeTeam).toBe("United States U20");
      expect(dbRow.awayTeam).toBe("Brazil U20");
      expect(dbRow.competition).toBe("CONCACAF U20");
      expect(dbRow.status).toBe("scheduled");
      expect(dbRow.streamingService).toBe("Fox One"); // BROADCAST_BY_LEAGUE["CONCACAF U20"]

      // Confirm it surfaces on the route.
      const res = await request(app).get("/api/fixtures").expect(200);
      const parsed = ListFixturesResponse.safeParse(res.body);
      expect(
        parsed.success,
        `GET /api/fixtures response did not parse:\n${parsed.success ? "" : fmtIssues(parsed.error)}`,
      ).toBe(true);

      const found = parsed.data!.find((f) => f.id === dbRow.id);
      expect(
        found,
        `Knockout fixture id=${dbRow.id} (api_football_fixture_id=${FAKE_KNOCKOUT_ID}) ` +
          `is missing from GET /api/fixtures — the route may be filtering national-team fixtures`,
      ).toBeDefined();
      expect(found!.isNationalTeam).toBe(true);
    },
    30_000,
  );

  it(
    "4. startup-seeded group-stage fixtures survive the sync — phantom purge must not remove them",
    async () => {
      // Both group-stage rows must still exist with count = 1 each.
      for (const afId of [FAKE_SEED_GS_ID_1, FAKE_SEED_GS_ID_2]) {
        const countResult = await db.execute(
          sql`SELECT COUNT(*)::int AS cnt FROM fixtures WHERE api_football_fixture_id = ${afId}`,
        ) as unknown as { rows: Array<{ cnt: number }> };

        const count = countResult.rows[0]?.cnt ?? 0;
        expect(
          count,
          `Group-stage fixture with api_football_fixture_id=${afId} was seeded before the sync ` +
            `but has ${count} rows afterwards — expected exactly 1. ` +
            `If 0, purgePhantomYouthNtFixtures removed it despite the API returning its id; ` +
            `if >1, the upsert path inserted a duplicate instead of no-oping`,
        ).toBe(1);
      }

      // Also confirm both appear on the route using their DB ids.
      const gsRows = await db
        .select({ id: fixturesTable.id })
        .from(fixturesTable)
        .where(inArray(fixturesTable.apiFootballFixtureId, [FAKE_SEED_GS_ID_1, FAKE_SEED_GS_ID_2]));

      const res = await request(app).get("/api/fixtures").expect(200);
      const parsed = ListFixturesResponse.safeParse(res.body);
      expect(
        parsed.success,
        `GET /api/fixtures response did not parse:\n${parsed.success ? "" : fmtIssues(parsed.error)}`,
      ).toBe(true);

      for (const { id: dbId } of gsRows) {
        const found = parsed.data!.find((f) => f.id === dbId);
        expect(
          found,
          `Startup-seeded group-stage fixture with db id=${dbId} ` +
            `is missing from GET /api/fixtures after the sync ran — ` +
            `the phantom purge may have deleted it, or the route is filtering it out`,
        ).toBeDefined();
        expect(found!.isNationalTeam).toBe(true);
      }
    },
    30_000,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite C: live-update path — scheduled → live → finished transitions
// ─────────────────────────────────────────────────────────────────────────────
//
// Verifies that the UPDATE branch of syncYouthNtFixtures correctly transitions
// a youth NT fixture from "scheduled" → "live" (with elapsedMinute and scores)
// → "finished" (with final scores and null elapsedMinute), and that each change
// is immediately visible on GET /api/fixtures without a server restart.
//
// The kickoff is set 1 hour in the past so the phantom-purge's "kickoff already
// passed" guard skips this row — only future fixtures are eligible for phantom
// deletion, and a match that is live/finished has necessarily already kicked off.

/** Fake api_football_fixture_id used exclusively by Suite C. */
const FAKE_LIVE_AF_ID = 9_996_001;

/**
 * Fixed wall-clock instant used as "now" for Suite C.  Only the Date clock is
 * faked (toFake: ["Date"]) so setTimeout/setInterval in afFetch remain real
 * and the throttle resolves without manual timer advancement.
 */
const SUITE_C_NOW = new Date("2026-06-01T12:00:00.000Z");

/**
 * Kickoff pinned to exactly 1 h before SUITE_C_NOW.  Using a fixed ISO string
 * rather than Date.now() arithmetic prevents drift: the phantom-purge guard
 * ("kickoff must be future to be a phantom") always sees this as a past kickoff
 * regardless of how long earlier tests take to run.
 */
const FAKE_LIVE_KICKOFF = "2026-06-01T11:00:00.000Z";

afterAll(async () => {
  await db
    .delete(fixturesTable)
    .where(eq(fixturesTable.apiFootballFixtureId, FAKE_LIVE_AF_ID));
});

/**
 * Builds a fetch mock that returns a single youth NT fixture with the given
 * live state for every /fixtures?team=… call.  All other URLs receive an empty
 * array so afFetch does not throw.
 */
function makeLiveSyncMock(
  statusShort: string,
  elapsed: number | null,
  homeGoals: number | null,
  awayGoals: number | null,
) {
  return function mockFetchC(url: string | URL | Request): Promise<Response> {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (urlStr.includes("/fixtures?team=")) {
      return Promise.resolve(
        fakeResponse([
          {
            fixture: {
              id: FAKE_LIVE_AF_ID,
              date: FAKE_LIVE_KICKOFF,
              status: { short: statusShort, elapsed },
              venue: { name: "Estadio Live Test" },
            },
            league: { name: "CONCACAF U20" },
            teams: {
              home: {
                id: 10306,
                name: "United States U20",
                logo: "https://media.api-sports.io/football/teams/10306.png",
              },
              away: {
                id: 19_003,
                name: "Mexico U20",
                logo: "https://media.api-sports.io/football/teams/503.png",
              },
            },
            goals: { home: homeGoals, away: awayGoals },
          },
        ]),
      );
    }
    return Promise.resolve(fakeResponse([]));
  };
}

describe("syncYouthNtFixtures — live-update path: scheduled → live → finished", () => {
  // Freeze the Date clock for every test in this suite so syncYouthNtFixtures
  // sees SUITE_C_NOW as "now".  setTimeout/setInterval are left real (toFake:
  // ["Date"]) so the afFetch throttle resolves without manual advancement.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SUITE_C_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Pre-seed the fixture with status="scheduled" before both tests run.
   * Each test then drives a single sync pass and asserts the new state.
   */
  beforeAll(async () => {
    // Clean up any leftover row from a previous run.
    await db
      .delete(fixturesTable)
      .where(eq(fixturesTable.apiFootballFixtureId, FAKE_LIVE_AF_ID));

    // Insert as "scheduled" — the state it would be in before the match starts.
    await db.insert(fixturesTable).values({
      apiFootballFixtureId: FAKE_LIVE_AF_ID,
      isNationalTeam: true,
      competition: "CONCACAF U20",
      kickoff: new Date(FAKE_LIVE_KICKOFF),
      venue: "Estadio Live Test",
      homeTeam: "United States U20",
      awayTeam: "Mexico U20",
      homeLogoUrl: "https://media.api-sports.io/football/teams/10306.png",
      awayLogoUrl: "https://media.api-sports.io/football/teams/503.png",
      status: "scheduled",
      tvNetwork: "FOX Sports",
      streamingService: "Fox One",
    });
  }, 30_000);

  it(
    "5. sync returning status=1H updates the fixture to live with elapsedMinute=42 and scores in DB and GET /api/fixtures",
    async () => {
      // First live sync pass: API-Football returns the match as "1H" (first half),
      // 42 minutes elapsed, score 1–0 to the US.
      vi.stubGlobal("fetch", makeLiveSyncMock("1H", 42, 1, 0));
      await syncYouthNtFixtures();
      vi.unstubAllGlobals();

      // ── DB assertions ────────────────────────────────────────────────────
      const dbRows = await db
        .select()
        .from(fixturesTable)
        .where(eq(fixturesTable.apiFootballFixtureId, FAKE_LIVE_AF_ID));

      expect(
        dbRows,
        `Expected exactly 1 row with api_football_fixture_id=${FAKE_LIVE_AF_ID} after the live-sync pass`,
      ).toHaveLength(1);

      const dbRow = dbRows[0]!;
      expect(
        dbRow.status,
        "DB status should be 'live' after API-Football returns short='1H'",
      ).toBe("live");
      expect(
        dbRow.elapsedMinute,
        "DB elapsedMinute should be 42 for an in-progress first-half fixture",
      ).toBe(42);
      expect(dbRow.homeScore, "DB homeScore should be 1").toBe(1);
      expect(dbRow.awayScore, "DB awayScore should be 0").toBe(0);

      // ── Route assertions ─────────────────────────────────────────────────
      const res = await request(app).get("/api/fixtures").expect(200);
      const parsed = ListFixturesResponse.safeParse(res.body);
      expect(
        parsed.success,
        `GET /api/fixtures did not parse:\n${parsed.success ? "" : fmtIssues(parsed.error)}`,
      ).toBe(true);

      const found = parsed.data!.find((f) => f.id === dbRow.id);
      expect(
        found,
        `Live fixture id=${dbRow.id} (api_football_fixture_id=${FAKE_LIVE_AF_ID}) ` +
          `is missing from GET /api/fixtures immediately after the live-sync pass — ` +
          `the route may be filtering it out or caching stale data`,
      ).toBeDefined();
      expect(found!.status, "Route status should be 'live'").toBe("live");
      expect(
        found!.elapsedMinute,
        "Route elapsedMinute should be 42",
      ).toBe(42);
      expect(found!.homeScore, "Route homeScore should be 1").toBe(1);
      expect(found!.awayScore, "Route awayScore should be 0").toBe(0);
    },
    30_000,
  );

  it(
    "6. sync returning status=FT updates the fixture to finished with final scores and null elapsedMinute in DB and GET /api/fixtures",
    async () => {
      // Second sync pass: match has finished — API-Football returns "FT",
      // no elapsed time, final score 2–1 to the US.
      vi.stubGlobal("fetch", makeLiveSyncMock("FT", null, 2, 1));
      await syncYouthNtFixtures();
      vi.unstubAllGlobals();

      // ── DB assertions ────────────────────────────────────────────────────
      const dbRows = await db
        .select()
        .from(fixturesTable)
        .where(eq(fixturesTable.apiFootballFixtureId, FAKE_LIVE_AF_ID));

      expect(
        dbRows,
        `Expected exactly 1 row with api_football_fixture_id=${FAKE_LIVE_AF_ID} after the FT-sync pass`,
      ).toHaveLength(1);

      const dbRow = dbRows[0]!;
      expect(
        dbRow.status,
        "DB status should be 'finished' after API-Football returns short='FT'",
      ).toBe("finished");
      expect(
        dbRow.elapsedMinute,
        "DB elapsedMinute should be null for a finished fixture (no longer ticking)",
      ).toBeNull();
      expect(dbRow.homeScore, "DB homeScore should be 2 (final score)").toBe(2);
      expect(dbRow.awayScore, "DB awayScore should be 1 (final score)").toBe(1);

      // ── Route assertions ─────────────────────────────────────────────────
      const res = await request(app).get("/api/fixtures").expect(200);
      const parsed = ListFixturesResponse.safeParse(res.body);
      expect(
        parsed.success,
        `GET /api/fixtures did not parse:\n${parsed.success ? "" : fmtIssues(parsed.error)}`,
      ).toBe(true);

      const found = parsed.data!.find((f) => f.id === dbRow.id);
      expect(
        found,
        `Finished fixture id=${dbRow.id} (api_football_fixture_id=${FAKE_LIVE_AF_ID}) ` +
          `is missing from GET /api/fixtures immediately after the FT-sync pass`,
      ).toBeDefined();
      expect(found!.status, "Route status should be 'finished'").toBe("finished");
      expect(found!.elapsedMinute ?? null, "Route elapsedMinute should be null for a finished fixture").toBeNull();
      expect(found!.homeScore, "Route homeScore should be 2").toBe(2);
      expect(found!.awayScore, "Route awayScore should be 1").toBe(1);
    },
    30_000,
  );
});
