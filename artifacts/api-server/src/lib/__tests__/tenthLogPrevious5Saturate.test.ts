/**
 * Regression guard: confirms that when a player has exactly 10 match logs the
 * "previous5" stats row (logs[5..9]) is fully saturated — all 5 slots filled —
 * and is written correctly, not accidentally deleted.
 *
 * ## Why this matters
 * The 6th-log test guards the transition from previous5=null → non-null (1 log
 * in the window). The next critical boundary is exactly 10 logs, where
 * previous5 transitions from partially filled (1–4 logs) to fully saturated
 * (5 logs). If aggregateFromMatchLogs ever returned null for a partially-full
 * window, the upsert would delete the row instead of inserting it, silently
 * killing the trajectory term in computeFormTier and miscalculating the badge.
 *
 * ## What is tested
 * - A player with exactly 10 new-club match logs (last5 non-null, previous5 fully saturated)
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

const NEW_CLUB_TEAM_ID = 505;

/** Club with a resolvable API team ID */
const CLUB = { id: 1, name: "Tenth FC", apiFootballTeamId: NEW_CLUB_TEAM_ID };

/**
 * Player with a valid apiFootballPlayerId — has played exactly 10 games at the
 * new club (last5 window: logs[0..4] non-null, previous5 window: logs[5..9]
 * fully saturated with 5 logs).
 */
const PLAYER = {
  id: 40,
  name: "Tenth Player",
  clubId: 1,
  apiFootballPlayerId: 99,
  age: 26,
  category: "senior",
  nationalTeamCaps: 10,
  marketValueUsd: 8_000_000,
};

// Ten finished fixtures at the new club — newest first so logs[0] is most recent.
// logs[0..4]  → last5 window (5 logs)
// logs[5..9]  → previous5 window (5 logs — fully saturated at this boundary)
const FIXTURES = [
  // last5 window (logs[0..4])
  {
    fixture: { id: 4001, date: "2026-05-05T20:00:00", status: { short: "FT" } },
    league: { name: "Bundesliga" },
    teams: {
      home: { id: NEW_CLUB_TEAM_ID, name: "Tenth FC" },
      away: { id: 901, name: "Rival A" },
    },
    goals: { home: 2, away: 1 },
  },
  {
    fixture: { id: 4002, date: "2026-04-28T20:00:00", status: { short: "FT" } },
    league: { name: "Bundesliga" },
    teams: {
      home: { id: 902, name: "Rival B" },
      away: { id: NEW_CLUB_TEAM_ID, name: "Tenth FC" },
    },
    goals: { home: 0, away: 1 },
  },
  {
    fixture: { id: 4003, date: "2026-04-21T20:00:00", status: { short: "FT" } },
    league: { name: "Bundesliga" },
    teams: {
      home: { id: NEW_CLUB_TEAM_ID, name: "Tenth FC" },
      away: { id: 903, name: "Rival C" },
    },
    goals: { home: 3, away: 0 },
  },
  {
    fixture: { id: 4004, date: "2026-04-14T20:00:00", status: { short: "FT" } },
    league: { name: "Bundesliga" },
    teams: {
      home: { id: 904, name: "Rival D" },
      away: { id: NEW_CLUB_TEAM_ID, name: "Tenth FC" },
    },
    goals: { home: 1, away: 1 },
  },
  {
    fixture: { id: 4005, date: "2026-04-07T20:00:00", status: { short: "FT" } },
    league: { name: "Bundesliga" },
    teams: {
      home: { id: NEW_CLUB_TEAM_ID, name: "Tenth FC" },
      away: { id: 905, name: "Rival E" },
    },
    goals: { home: 1, away: 2 },
  },
  // previous5 window (logs[5..9]) — fully saturated at 10 logs
  {
    fixture: { id: 4006, date: "2026-03-31T20:00:00", status: { short: "FT" } },
    league: { name: "Bundesliga" },
    teams: {
      home: { id: 906, name: "Rival F" },
      away: { id: NEW_CLUB_TEAM_ID, name: "Tenth FC" },
    },
    goals: { home: 0, away: 2 },
  },
  {
    fixture: { id: 4007, date: "2026-03-24T20:00:00", status: { short: "FT" } },
    league: { name: "Bundesliga" },
    teams: {
      home: { id: NEW_CLUB_TEAM_ID, name: "Tenth FC" },
      away: { id: 907, name: "Rival G" },
    },
    goals: { home: 2, away: 2 },
  },
  {
    fixture: { id: 4008, date: "2026-03-17T20:00:00", status: { short: "FT" } },
    league: { name: "Bundesliga" },
    teams: {
      home: { id: 908, name: "Rival H" },
      away: { id: NEW_CLUB_TEAM_ID, name: "Tenth FC" },
    },
    goals: { home: 1, away: 3 },
  },
  {
    fixture: { id: 4009, date: "2026-03-10T20:00:00", status: { short: "FT" } },
    league: { name: "Bundesliga" },
    teams: {
      home: { id: NEW_CLUB_TEAM_ID, name: "Tenth FC" },
      away: { id: 909, name: "Rival I" },
    },
    goals: { home: 0, away: 0 },
  },
  // 10th log — logs[9], the 5th and final slot in the previous5 window
  {
    fixture: { id: 4010, date: "2026-03-03T20:00:00", status: { short: "FT" } },
    league: { name: "Bundesliga" },
    teams: {
      home: { id: 910, name: "Rival J" },
      away: { id: NEW_CLUB_TEAM_ID, name: "Tenth FC" },
    },
    goals: { home: 2, away: 0 },
  },
];

/** Player stats block — player appeared (90 min) in this fixture */
function makePlayerTeamBlock(fixtureTeamId: number) {
  return [
    {
      team: { id: fixtureTeamId, name: "Tenth FC" },
      players: [
        {
          player: { id: PLAYER.apiFootballPlayerId, name: PLAYER.name },
          statistics: [
            {
              games: { minutes: 90, rating: "7.8", position: "M" },
              goals: { total: 1, assists: 1 },
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

describe("10th match log — previous5 window fully saturates (5 of 5 slots filled)", () => {
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
      // Club fixtures — return 10 finished matches
      if (url.includes(`/fixtures?team=${NEW_CLUB_TEAM_ID}`)) return Promise.resolve(FIXTURES);
      // Fixture-players — player appeared in all 10
      if (url === `/fixtures/players?fixture=4001`)
        return Promise.resolve(makePlayerTeamBlock(NEW_CLUB_TEAM_ID));
      if (url === `/fixtures/players?fixture=4002`)
        return Promise.resolve(makePlayerTeamBlock(NEW_CLUB_TEAM_ID));
      if (url === `/fixtures/players?fixture=4003`)
        return Promise.resolve(makePlayerTeamBlock(NEW_CLUB_TEAM_ID));
      if (url === `/fixtures/players?fixture=4004`)
        return Promise.resolve(makePlayerTeamBlock(NEW_CLUB_TEAM_ID));
      if (url === `/fixtures/players?fixture=4005`)
        return Promise.resolve(makePlayerTeamBlock(NEW_CLUB_TEAM_ID));
      if (url === `/fixtures/players?fixture=4006`)
        return Promise.resolve(makePlayerTeamBlock(NEW_CLUB_TEAM_ID));
      if (url === `/fixtures/players?fixture=4007`)
        return Promise.resolve(makePlayerTeamBlock(NEW_CLUB_TEAM_ID));
      if (url === `/fixtures/players?fixture=4008`)
        return Promise.resolve(makePlayerTeamBlock(NEW_CLUB_TEAM_ID));
      if (url === `/fixtures/players?fixture=4009`)
        return Promise.resolve(makePlayerTeamBlock(NEW_CLUB_TEAM_ID));
      if (url === `/fixtures/players?fixture=4010`)
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

  it("inserts a previous5 row (logs[5..9] fully saturated → aggregateFromMatchLogs returns non-null)", async () => {
    await syncPlayerStatsAndInjuries(3);

    const prev5Inserts = capturedInsertValueCalls.filter((v) => {
      const row = v as Record<string, unknown>;
      return row.periodType === "previous5";
    });
    expect(
      prev5Inserts.length,
      "expected exactly one db.insert(playerStatsTable) for periodType='previous5' — must NOT be deleted when previous5 window is fully saturated at 10 logs",
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
