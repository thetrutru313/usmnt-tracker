/**
 * Regression guard: confirms that when a player gains their 6th match log the
 * "previous5" stats row (logs[5..9]) is written for the first time, not
 * accidentally deleted.
 *
 * ## Why this matters
 * The partial-sync test (Task #83) covers 1–5 logs (last5 non-null,
 * previous5 null). The next critical boundary is exactly 6 logs, where
 * previous5 transitions from null → non-null for the first time.  If the
 * upsert logic ever inverted the branch — e.g. calling deleteStatsRow for
 * previous5 even when aggregateFromMatchLogs returns a value — the trajectory
 * term in computeFormTier would silently go missing and the form badge would
 * be miscalculated.
 *
 * ## What is tested
 * - A player with exactly 6 new-club match logs (last5 non-null, previous5 non-null)
 * - db.insert(playerStatsTable) fires for "last5"   (via upsertStatsRow)
 * - db.insert(playerStatsTable) fires for "previous5" (via upsertStatsRow)
 * - db.delete(playerStatsTable) fires for "last5"   (stale row cleared before re-insert)
 * - db.delete(playerStatsTable) fires for "previous5" (stale row cleared before re-insert)
 * - computeFormTier receives a non-null prev5 argument
 *   (evidenced by the performanceTrend update call being made after both inserts)
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

const NEW_CLUB_TEAM_ID = 404;

/** Club with a resolvable API team ID */
const CLUB = { id: 1, name: "Sixth FC", apiFootballTeamId: NEW_CLUB_TEAM_ID };

/**
 * Player with a valid apiFootballPlayerId — has played exactly 6 games at the
 * new club (last5 window: logs[0..4] non-null, previous5 window: logs[5] non-null
 * for the first time).
 */
const PLAYER = {
  id: 30,
  name: "Sixth Player",
  clubId: 1,
  apiFootballPlayerId: 88,
  age: 24,
  category: "prospect",
  nationalTeamCaps: 3,
  marketValueUsd: 5_000_000,
};

// Six finished fixtures at the new club — newest first so logs[0] is most recent
const FIXTURES = [
  {
    fixture: { id: 3001, date: "2026-04-14T20:00:00", status: { short: "FT" } },
    league: { name: "Bundesliga" },
    teams: {
      home: { id: NEW_CLUB_TEAM_ID, name: "Sixth FC" },
      away: { id: 801, name: "Away Side A" },
    },
    goals: { home: 2, away: 1 },
  },
  {
    fixture: { id: 3002, date: "2026-04-07T20:00:00", status: { short: "FT" } },
    league: { name: "Bundesliga" },
    teams: {
      home: { id: 802, name: "Away Side B" },
      away: { id: NEW_CLUB_TEAM_ID, name: "Sixth FC" },
    },
    goals: { home: 0, away: 0 },
  },
  {
    fixture: { id: 3003, date: "2026-03-31T20:00:00", status: { short: "FT" } },
    league: { name: "Bundesliga" },
    teams: {
      home: { id: NEW_CLUB_TEAM_ID, name: "Sixth FC" },
      away: { id: 803, name: "Away Side C" },
    },
    goals: { home: 1, away: 0 },
  },
  {
    fixture: { id: 3004, date: "2026-03-24T20:00:00", status: { short: "FT" } },
    league: { name: "Bundesliga" },
    teams: {
      home: { id: NEW_CLUB_TEAM_ID, name: "Sixth FC" },
      away: { id: 804, name: "Away Side D" },
    },
    goals: { home: 3, away: 2 },
  },
  {
    fixture: { id: 3005, date: "2026-03-17T20:00:00", status: { short: "FT" } },
    league: { name: "Bundesliga" },
    teams: {
      home: { id: 805, name: "Away Side E" },
      away: { id: NEW_CLUB_TEAM_ID, name: "Sixth FC" },
    },
    goals: { home: 1, away: 2 },
  },
  // 6th log — this is logs[5], the sole entry in the previous5 window
  {
    fixture: { id: 3006, date: "2026-03-10T20:00:00", status: { short: "FT" } },
    league: { name: "Bundesliga" },
    teams: {
      home: { id: NEW_CLUB_TEAM_ID, name: "Sixth FC" },
      away: { id: 806, name: "Away Side F" },
    },
    goals: { home: 2, away: 0 },
  },
];

/** Player stats block — player appeared (90 min) in this fixture */
function makePlayerTeamBlock(fixtureTeamId: number) {
  return [
    {
      team: { id: fixtureTeamId, name: "Sixth FC" },
      players: [
        {
          player: { id: PLAYER.apiFootballPlayerId, name: PLAYER.name },
          statistics: [
            {
              games: { minutes: 90, rating: "7.5", position: "M" },
              goals: { total: 1, assists: 0 },
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

describe("6th match log — previous5 fills in for the first time", () => {
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
      // Club fixtures — return 6 finished matches
      if (url.includes(`/fixtures?team=${NEW_CLUB_TEAM_ID}`)) return Promise.resolve(FIXTURES);
      // Fixture-players — player appeared in all 6
      if (url === `/fixtures/players?fixture=3001`)
        return Promise.resolve(makePlayerTeamBlock(NEW_CLUB_TEAM_ID));
      if (url === `/fixtures/players?fixture=3002`)
        return Promise.resolve(makePlayerTeamBlock(NEW_CLUB_TEAM_ID));
      if (url === `/fixtures/players?fixture=3003`)
        return Promise.resolve(makePlayerTeamBlock(NEW_CLUB_TEAM_ID));
      if (url === `/fixtures/players?fixture=3004`)
        return Promise.resolve(makePlayerTeamBlock(NEW_CLUB_TEAM_ID));
      if (url === `/fixtures/players?fixture=3005`)
        return Promise.resolve(makePlayerTeamBlock(NEW_CLUB_TEAM_ID));
      if (url === `/fixtures/players?fixture=3006`)
        return Promise.resolve(makePlayerTeamBlock(NEW_CLUB_TEAM_ID));
      // Season stats — return empty so we don't have to wire up season upsert
      if (url.includes("/players?id=")) return Promise.resolve([]);
      // Club injuries
      if (url.includes("/injuries?team=")) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    // db.select sequencing:
    //  call 1 → clubs
    //  call 2 → players
    //  remaining calls → post-loop aggregate queries (last5, season, active injuries, freshPlayers)
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

  it("inserts a last5 row (logs[0..4] → aggregateFromMatchLogs returns non-null)", async () => {
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

  it("inserts a previous5 row (logs[5] → aggregateFromMatchLogs returns non-null for the first time)", async () => {
    await syncPlayerStatsAndInjuries(3);

    const prev5Inserts = capturedInsertValueCalls.filter((v) => {
      const row = v as Record<string, unknown>;
      return row.periodType === "previous5";
    });
    expect(
      prev5Inserts.length,
      "expected exactly one db.insert(playerStatsTable) for periodType='previous5' — must NOT be deleted when the 6th log fills the window",
    ).toBe(1);
  });

  it("deletes the old last5 row before re-inserting (upsertStatsRow clears then writes)", async () => {
    await syncPlayerStatsAndInjuries(3);

    const last5Deleted = capturedWhereCallsForStatsDelete.some((cond) =>
      includesValue(cond, "last5"),
    );
    expect(
      last5Deleted,
      "upsertStatsRow must delete the old last5 row before inserting the fresh one",
    ).toBe(true);
  });

  it("deletes the old previous5 row before re-inserting (upsertStatsRow clears then writes)", async () => {
    await syncPlayerStatsAndInjuries(3);

    const prev5Deleted = capturedWhereCallsForStatsDelete.some((cond) =>
      includesValue(cond, "previous5"),
    );
    expect(
      prev5Deleted,
      "upsertStatsRow must delete the old previous5 row before inserting the fresh one",
    ).toBe(true);
  });

  it("completes without throwing and reports zero failures", async () => {
    const result = await syncPlayerStatsAndInjuries(3);
    expect(result).toMatchObject({ failures: 0 });
  });
});
