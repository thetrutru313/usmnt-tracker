/**
 * Regression guard: confirms that when a club's API-Football team ID cannot
 * be resolved (resolveTeamId returns null), the player-stats sync loop
 * DELETES — not writes — the season / previous_season / season_all rows for
 * every player at that club.
 *
 * Background (Task #35 fix): without a resolved team ID, the second guard in
 * aggregateSeasonBlocks (team-id equality) is inactive, so only the
 * friendly-league name filter stands between the aggregation and inflated
 * stats that include blocks from unrelated teams. The player loop therefore
 * clears season rows rather than risk writing partial/inflated data; last5 /
 * previous5 (match-log derived) are left to their own paths and are NOT
 * affected by this guard.
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
} = vi.hoisted(() => {
  // Distinct objects used as table tokens — checked by reference in assertions.
  const tClubs = { _table: "clubs" };
  const tPlayers = { _table: "players" };
  const tPlayerStats = { _table: "playerStats" };
  const tMatchLogs = { _table: "matchLogs" };
  const tInjuries = { _table: "injuries" };

  // Chainable drizzle mock: each db.delete(table) / db.insert(table) records
  // its first argument so tests can assert which tables were targeted.
  const mockDb = {
    select: vi.fn(),
    delete: vi.fn().mockImplementation(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    insert: vi.fn().mockImplementation(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
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
  eq: (_col: unknown, _val: unknown) => ({ _eq: [_col, _val] }),
  and: (...args: unknown[]) => ({ _and: args }),
  inArray: (_col: unknown, _vals: unknown) => ({ _inArray: [_col, _vals] }),
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

const CLUB = { id: 1, name: "Unresolvable FC", apiFootballTeamId: null };
const PLAYER = {
  id: 10,
  name: "John Doe",
  clubId: 1,
  apiFootballPlayerId: 99, // has a resolved API id — exercises the !clubTeamId branch
  age: 24,
  category: "prospect",
  nationalTeamCaps: 5,
  marketValueUsd: 2_000_000,
};

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
// Tests
// ---------------------------------------------------------------------------

describe("cleared-stats guard — null clubTeamId in player loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // resolveTeamId always returns null (club is unresolvable)
    mockResolveTeamId.mockResolvedValue(null);

    // ensurePlayerApiFootballIds is a no-op (player already has an API id)
    mockEnsurePlayerApiFootballIds.mockResolvedValue(undefined);

    // afFetch returns no fixtures / no injuries — simplest possible API state
    mockAfFetch.mockResolvedValue([]);

    // db.select sequencing:
    //  call 1 → clubs query
    //  call 2 → players query
    //  calls 3-6 → post-loop aggregate queries (last5, season, active injuries, freshPlayers)
    mockDb.select
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([CLUB])) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([PLAYER])) })
      .mockReturnValue({ from: vi.fn().mockReturnValue(makeFromResult([])) });

    // db.delete / db.insert are configured with mockImplementation in hoisted
    // block; clearAllMocks above resets call history but preserves impl.
    mockDb.delete.mockImplementation(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    mockDb.insert.mockImplementation(() => ({ values: vi.fn().mockResolvedValue(undefined) }));
    mockDb.update.mockImplementation(() => ({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }));
  });

  it("deletes season, previous_season, and season_all rows — does not write them", async () => {
    await syncPlayerStatsAndInjuries(/* fixturesPerClub */ 1);

    // All db.delete calls, filtered to playerStatsTable
    const statsTableDeletes = mockDb.delete.mock.calls.filter(([table]) => table === tPlayerStats);

    // Must delete at least: last5, previous5, season, previous_season, season_all = 5 rows
    // (last5/previous5 are cleared because there are no match logs)
    expect(statsTableDeletes.length).toBeGreaterThanOrEqual(5);

    // No db.insert targeting playerStatsTable — no season data should be written
    const statsTableInserts = mockDb.insert.mock.calls.filter(([table]) => table === tPlayerStats);
    expect(statsTableInserts).toHaveLength(0);
  });

  it("still deletes match logs for the player (the guard only blocks season writes)", async () => {
    await syncPlayerStatsAndInjuries(1);

    const matchLogDeletes = mockDb.delete.mock.calls.filter(([table]) => table === tMatchLogs);
    // One delete per player (clearing stale club match logs before re-inserting)
    expect(matchLogDeletes.length).toBeGreaterThanOrEqual(1);
  });

  it("does not call db.insert(playerStatsTable) even though the player has a valid API id", async () => {
    // This is the critical regression guard: a player WITH an apiFootballPlayerId
    // would proceed to fetchSeasonStats and potentially write season rows if the
    // !clubTeamId branch were removed or broken. Confirm it stays gated.
    await syncPlayerStatsAndInjuries(1);

    const statsInserts = mockDb.insert.mock.calls.filter(([table]) => table === tPlayerStats);
    expect(statsInserts).toHaveLength(0);
  });

  it("returns a result object without throwing", async () => {
    const result = await syncPlayerStatsAndInjuries(1);
    expect(result).toMatchObject({
      clubsProcessed: expect.any(Number),
      playersWithMatchLogs: expect.any(Number),
      playersWithSeasonStats: expect.any(Number),
      failures: 0,
    });
  });

  it("calls resolveTeamId exactly once per club (no duplicate lookups)", async () => {
    await syncPlayerStatsAndInjuries(1);
    // resolveTeamId must fire exactly once for the one club in this test —
    // previously it was called twice (once in syncClubMatchLogs + once in the
    // player loop) and a third time in syncClubInjuries; all three are now
    // driven by a single upfront resolve in the orchestrator.
    expect(mockResolveTeamId).toHaveBeenCalledTimes(1);
    expect(mockResolveTeamId).toHaveBeenCalledWith(CLUB);
  });
});

// ---------------------------------------------------------------------------
// Edge case: player has NO apiFootballPlayerId at a null-team-id club
// The !apiFootballPlayerId branch runs first, which also deletes season/
// previous_season — the !clubTeamId branch is never reached. Either way the
// outcome (no season data written) must be the same.
// ---------------------------------------------------------------------------
describe("cleared-stats guard — no API id + null clubTeamId", () => {
  const PLAYER_NO_API_ID = { ...PLAYER, apiFootballPlayerId: null };

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveTeamId.mockResolvedValue(null);
    mockEnsurePlayerApiFootballIds.mockResolvedValue(undefined);
    mockAfFetch.mockResolvedValue([]);

    mockDb.select
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([CLUB])) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([PLAYER_NO_API_ID])) })
      .mockReturnValue({ from: vi.fn().mockReturnValue(makeFromResult([])) });

    mockDb.delete.mockImplementation(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    mockDb.insert.mockImplementation(() => ({ values: vi.fn().mockResolvedValue(undefined) }));
    mockDb.update.mockImplementation(() => ({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }));
  });

  it("still writes no season stats when the player also has no API id", async () => {
    await syncPlayerStatsAndInjuries(1);
    const statsInserts = mockDb.insert.mock.calls.filter(([table]) => table === tPlayerStats);
    expect(statsInserts).toHaveLength(0);
  });
});
