/**
 * Regression guard: confirms that when a player has exactly 1–5 match logs at
 * their current club (partial sync — e.g. just transferred and played 3 games),
 * the sync path correctly handles the asymmetric state:
 *   - last5 is non-null (3 logs exist) → upsertStatsRow fires: delete("last5") + insert("last5")
 *   - previous5 is null (no logs[5..9]) → deleteStatsRow fires: delete("previous5") only, NO insert
 *
 * ## Why this matters
 * The complementary risk to Task #80 (full wipe when zero logs) is the partial
 * case: a player with 1–5 new-club logs should have their stale "previous5" row
 * from the old club cleared, without touching the freshly-computed "last5" row.
 * If the delete/upsert logic were ever inverted or scoped wrong, the UI could
 * show a stale "prior 5" trend alongside an otherwise correct "last 5" panel.
 *
 * ## What is tested
 * - A player with 3 new-club match logs (last5 non-null, previous5 null)
 * - db.delete(playerStatsTable) fires for "previous5"
 * - db.insert(playerStatsTable) fires for "last5" (via upsertStatsRow)
 * - db.insert(playerStatsTable) does NOT fire for "previous5"
 * - db.delete(playerStatsTable) fires for "last5" as part of the upsert
 *   (stale prior row cleared before the fresh insert)
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared mock state — created with vi.hoisted so the factories below can
// reference these before vi.mock calls are executed.
// ---------------------------------------------------------------------------

const {
  mockDb,
  tClubs,
  tPlayers,
  tPlayerStats,
  tMatchLogs,
  tInjuries,
  mockResolveTeamId,
  mockAfFetch,
  mockEnsurePlayerApiFootballIds,
  capturedSetCalls,
  capturedWhereCallsForStatsDelete,
  capturedInsertValueCalls,
} = vi.hoisted(() => {
  const tClubs = { _table: "clubs" };
  const tPlayers = { _table: "players" };
  const tPlayerStats = { _table: "playerStats" };
  const tMatchLogs = { _table: "matchLogs" };
  const tInjuries = { _table: "injuries" };

  // Track arguments passed to .set() on every db.update() call
  const capturedSetCalls: unknown[] = [];

  // Track arguments passed to .where() on every db.delete(playerStatsTable) call
  const capturedWhereCallsForStatsDelete: unknown[] = [];

  // Track arguments passed to .values() on every db.insert(playerStatsTable) call
  const capturedInsertValueCalls: unknown[] = [];

  const mockDb = {
    select: vi.fn(),
    delete: vi.fn().mockImplementation((table: unknown) => ({
      where: vi.fn().mockImplementation((condition: unknown) => {
        if (table === tPlayerStats) {
          capturedWhereCallsForStatsDelete.push(condition);
        }
        return Promise.resolve(undefined);
      }),
    })),
    insert: vi.fn().mockImplementation((table: unknown) => ({
      values: vi.fn().mockImplementation((data: unknown) => {
        if (table === tPlayerStats) {
          capturedInsertValueCalls.push(data);
        }
        return Promise.resolve(undefined);
      }),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((data: unknown) => {
        capturedSetCalls.push(data);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
  };

  return {
    mockDb,
    tClubs,
    tPlayers,
    tPlayerStats,
    tMatchLogs,
    tInjuries,
    mockResolveTeamId: vi.fn(),
    mockAfFetch: vi.fn(),
    mockEnsurePlayerApiFootballIds: vi.fn(),
    capturedSetCalls,
    capturedWhereCallsForStatsDelete,
    capturedInsertValueCalls,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: mockDb,
  clubsTable: tClubs,
  playersTable: tPlayers,
  playerStatsTable: tPlayerStats,
  matchLogsTable: tMatchLogs,
  injuriesTable: tInjuries,
}));

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, val: unknown) => ({ _eq: [_col, val] }),
  and: (...args: unknown[]) => ({ _and: args }),
  inArray: (_col: unknown, vals: unknown) => ({ _inArray: [_col, vals] }),
}));

vi.mock("../apiFootballSync.js", () => ({
  afFetch: mockAfFetch,
  resolveTeamId: mockResolveTeamId,
  FINISHED_STATUSES: new Set(["FT", "AET", "PEN"]),
}));

vi.mock("../playerClubSync.js", () => ({
  ensurePlayerApiFootballIds: mockEnsurePlayerApiFootballIds,
  ageFromBirthDate: () => null,
}));

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Import AFTER mocks are registered
import { syncPlayerStatsAndInjuries } from "../playerStatsSync.js";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const NEW_CLUB_TEAM_ID = 303;

/** Club with a resolvable API team ID */
const CLUB = { id: 1, name: "Partial FC", apiFootballTeamId: NEW_CLUB_TEAM_ID };

/**
 * Player with a valid apiFootballPlayerId — has played exactly 3 games at the
 * new club (last5 window: non-null, previous5 window: null/empty).
 */
const PLAYER = {
  id: 20,
  name: "Partial Player",
  clubId: 1,
  apiFootballPlayerId: 77,
  age: 25,
  category: "prospect",
  nationalTeamCaps: 5,
  marketValueUsd: 4_000_000,
};

// Three finished fixtures at the new club
const FIXTURES = [
  {
    fixture: { id: 2001, date: "2026-03-10T20:00:00", status: { short: "FT" } },
    league: { name: "Liga MX" },
    teams: { home: { id: NEW_CLUB_TEAM_ID, name: "Partial FC" }, away: { id: 888, name: "Rival SC" } },
    goals: { home: 2, away: 0 },
  },
  {
    fixture: { id: 2002, date: "2026-03-17T20:00:00", status: { short: "FT" } },
    league: { name: "Liga MX" },
    teams: { home: { id: 777, name: "Road Team" }, away: { id: NEW_CLUB_TEAM_ID, name: "Partial FC" } },
    goals: { home: 1, away: 1 },
  },
  {
    fixture: { id: 2003, date: "2026-03-24T20:00:00", status: { short: "FT" } },
    league: { name: "Liga MX" },
    teams: { home: { id: NEW_CLUB_TEAM_ID, name: "Partial FC" }, away: { id: 666, name: "Another Club" } },
    goals: { home: 3, away: 1 },
  },
];

/** Player stats block — player appeared (90 min) in this fixture */
function makePlayerTeamBlock(fixtureTeamId: number) {
  return [
    {
      team: { id: fixtureTeamId, name: "Partial FC" },
      players: [
        {
          player: { id: PLAYER.apiFootballPlayerId, name: PLAYER.name },
          statistics: [
            {
              games: { minutes: 90, rating: "7.2", position: "M" },
              goals: { total: 0, assists: 1 },
            },
          ],
        },
      ],
    },
  ];
}

/**
 * Returns a PromiseLike that also exposes a `.where()` method so it can be
 * used both as `await db.select().from(t)` and as
 * `await db.select().from(t).where(...)`.
 */
function makeFromResult(data: unknown[]) {
  const p = Promise.resolve(data) as Promise<unknown[]> & { where: ReturnType<typeof vi.fn> };
  p.where = vi.fn().mockResolvedValue(data);
  return p;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Walks a mock where-condition object looking for a specific string value in any _eq leaf. */
function includesValue(condition: unknown, target: unknown): boolean {
  if (condition == null || typeof condition !== "object") return false;
  const c = condition as Record<string, unknown>;
  if ("_eq" in c) return (c._eq as unknown[]).includes(target);
  if ("_and" in c) return (c._and as unknown[]).some((sub) => includesValue(sub, target));
  return false;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("partial sync — 3 match logs: last5 non-null, previous5 null", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedSetCalls.length = 0;
    capturedWhereCallsForStatsDelete.length = 0;
    capturedInsertValueCalls.length = 0;

    // Club IS resolvable
    mockResolveTeamId.mockResolvedValue(NEW_CLUB_TEAM_ID);
    // Player already has an API id — no resolution needed
    mockEnsurePlayerApiFootballIds.mockResolvedValue(undefined);

    // afFetch: route by URL
    mockAfFetch.mockImplementation((url: string) => {
      // National-team injuries
      if (url.includes(`/injuries?team=2384`)) return Promise.resolve([]);
      // Club fixtures — return 3 finished matches
      if (url.includes(`/fixtures?team=${NEW_CLUB_TEAM_ID}`)) return Promise.resolve(FIXTURES);
      // Fixture-players — player appeared in all 3
      if (url === `/fixtures/players?fixture=2001`)
        return Promise.resolve(makePlayerTeamBlock(NEW_CLUB_TEAM_ID));
      if (url === `/fixtures/players?fixture=2002`)
        // away match — team id is still NEW_CLUB_TEAM_ID for our block
        return Promise.resolve(makePlayerTeamBlock(NEW_CLUB_TEAM_ID));
      if (url === `/fixtures/players?fixture=2003`)
        return Promise.resolve(makePlayerTeamBlock(NEW_CLUB_TEAM_ID));
      // Season stats — return empty so we don't have to wire up upsertStatsRow for season
      if (url.includes("/players?id=")) return Promise.resolve([]);
      // Club injuries
      if (url.includes("/injuries?team=")) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    // db.select sequencing:
    //  call 1 → clubs
    //  call 2 → players
    //  calls 3–6 → post-loop aggregate queries (last5, season, active injuries, freshPlayers)
    mockDb.select
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([CLUB])) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([PLAYER])) })
      .mockReturnValue({ from: vi.fn().mockReturnValue(makeFromResult([])) });

    // Restore delete/insert/update implementations after clearAllMocks
    mockDb.delete.mockImplementation((table: unknown) => ({
      where: vi.fn().mockImplementation((condition: unknown) => {
        if (table === tPlayerStats) capturedWhereCallsForStatsDelete.push(condition);
        return Promise.resolve(undefined);
      }),
    }));
    mockDb.insert.mockImplementation((table: unknown) => ({
      values: vi.fn().mockImplementation((data: unknown) => {
        if (table === tPlayerStats) capturedInsertValueCalls.push(data);
        return Promise.resolve(undefined);
      }),
    }));
    mockDb.update.mockImplementation(() => ({
      set: vi.fn().mockImplementation((data: unknown) => {
        capturedSetCalls.push(data);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    }));
  });

  it("deletes the stale previous5 stats row (no logs in that window)", async () => {
    await syncPlayerStatsAndInjuries(3);

    const prev5Deleted = capturedWhereCallsForStatsDelete.some((cond) =>
      includesValue(cond, "previous5"),
    );
    expect(
      prev5Deleted,
      "expected db.delete(playerStatsTable).where(…) to target periodType='previous5'",
    ).toBe(true);
  });

  it("does NOT insert a new previous5 row (no logs[5..9] to aggregate from)", async () => {
    await syncPlayerStatsAndInjuries(3);

    // Any insert to playerStatsTable with periodType = "previous5" is wrong
    const prev5Inserts = capturedInsertValueCalls.filter((v) => {
      const row = v as Record<string, unknown>;
      return row.periodType === "previous5";
    });
    expect(prev5Inserts, "previous5 insert must not fire when there are fewer than 6 match logs").toHaveLength(0);
  });

  it("inserts a last5 row (3 logs exist → aggregateFromMatchLogs returns non-null)", async () => {
    await syncPlayerStatsAndInjuries(3);

    const last5Inserts = capturedInsertValueCalls.filter((v) => {
      const row = v as Record<string, unknown>;
      return row.periodType === "last5";
    });
    expect(
      last5Inserts.length,
      "expected exactly one db.insert(playerStatsTable) for periodType='last5'",
    ).toBe(1);
  });

  it("also deletes the old last5 row before re-inserting (upsertStatsRow clears then writes)", async () => {
    await syncPlayerStatsAndInjuries(3);

    // upsertStatsRow calls db.delete(playerStatsTable).where(and(eq(playerId,…), eq(periodType,'last5')))
    // before inserting — this ensures the prior club's row is replaced, not accumulated.
    const last5Deleted = capturedWhereCallsForStatsDelete.some((cond) =>
      includesValue(cond, "last5"),
    );
    expect(
      last5Deleted,
      "upsertStatsRow must delete the old last5 row before inserting the fresh one",
    ).toBe(true);
  });

  it("completes without throwing and reports zero failures", async () => {
    const result = await syncPlayerStatsAndInjuries(3);
    expect(result).toMatchObject({ failures: 0 });
  });
});
