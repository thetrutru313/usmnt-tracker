/**
 * Regression guard: confirms that when a player transfers to a new club and
 * has no match logs there yet, the sync path:
 *   1. Deletes the stale "last5" row from a previous club (via deleteStatsRow,
 *      referenced at line ~681 of playerStatsSync.ts — the `deleteStatsRow(player.id, "last5")`
 *      call inside the `if (!last5) { ... }` branch).
 *   2. Deletes the stale "previous5" row similarly.
 *   3. Writes `performanceTrend = "steady"` to the players table (the correct
 *      reset value when computeFormTier receives null last5 — no data to judge).
 *
 * ## Why this matters
 * `syncClubMatchLogs` returns an empty map when a player has played no fixtures
 * for their new club. The sync path derives `last5 = aggregateFromMatchLogs([])`,
 * which is null, and must call `deleteStatsRow(player.id, "last5")` to clear any
 * row left by a prior sync at the old club.  If that delete were ever skipped
 * (e.g. due to a regression in the clear-stale-rows logic), the old tier badge
 * would silently persist in the DB and surface through the UI as stale data.
 *
 * ## What is tested
 * - A player with a valid apiFootballPlayerId at a resolvable club (full sync
 *   path, not the short-circuit branches).
 * - afFetch returns empty fixtures → no match logs → last5 = null.
 * - db.delete(playerStatsTable) is called for both "last5" and "previous5" —
 *   i.e. the stale rows are cleared, not silently left.
 * - db.update(playersTable) is called with performanceTrend = "steady" —
 *   the expected reset value from computeFormTier(null, null, null).
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
} = vi.hoisted(() => {
  const tClubs = { _table: "clubs" };
  const tPlayers = { _table: "players" };
  const tPlayerStats = { _table: "playerStats" };
  const tMatchLogs = { _table: "matchLogs" };
  const tInjuries = { _table: "injuries" };

  // Track arguments passed to .set() on every db.update() call so we can
  // assert that performanceTrend = "steady" was written.
  const capturedSetCalls: unknown[] = [];

  // Track arguments passed to .where() on every db.delete(playerStatsTable)
  // call — gives us the and(eq(playerId, …), eq(periodType, …)) shapes so we
  // can confirm both "last5" and "previous5" deletes fired.
  const capturedWhereCallsForStatsDelete: unknown[] = [];

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
    insert: vi.fn().mockImplementation(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
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

const NEW_CLUB_TEAM_ID = 202;

/** Club with a resolvable API team ID — triggers the full match-log + season-stats path. */
const CLUB = { id: 1, name: "New Club FC", apiFootballTeamId: NEW_CLUB_TEAM_ID };

/**
 * Player with a valid apiFootballPlayerId — they take the full sync path
 * (not the !apiFootballPlayerId short-circuit).  They have just transferred
 * and have played no fixtures for their new club yet.
 */
const PLAYER = {
  id: 10,
  name: "Transfer Player",
  clubId: 1,
  apiFootballPlayerId: 55, // resolved — full path
  age: 24,
  category: "prospect",
  nationalTeamCaps: 3,
  marketValueUsd: 3_000_000,
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

describe("stale form badge — no match logs at new club after transfer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear shared capture arrays between tests
    capturedSetCalls.length = 0;
    capturedWhereCallsForStatsDelete.length = 0;

    // Club IS resolvable — takes the full path (not the !clubTeamId short-circuit)
    mockResolveTeamId.mockResolvedValue(NEW_CLUB_TEAM_ID);

    // No API-id resolution needed — PLAYER already has one
    mockEnsurePlayerApiFootballIds.mockResolvedValue(undefined);

    // afFetch: empty fixtures (new club, no played games yet) + empty season stats + empty injuries
    mockAfFetch.mockResolvedValue([]);

    // db.select sequencing:
    //  call 1 → clubs query
    //  call 2 → players query
    //  calls 3–6 → post-loop aggregate queries (last5, season, active injuries, freshPlayers)
    mockDb.select
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([CLUB])) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([PLAYER])) })
      .mockReturnValue({ from: vi.fn().mockReturnValue(makeFromResult([])) });

    // Restore delete/insert/update implementations after clearAllMocks (which
    // resets call history but would also wipe implementations without these).
    mockDb.delete.mockImplementation((table: unknown) => ({
      where: vi.fn().mockImplementation((condition: unknown) => {
        if (table === tPlayerStats) {
          capturedWhereCallsForStatsDelete.push(condition);
        }
        return Promise.resolve(undefined);
      }),
    }));
    mockDb.insert.mockImplementation(() => ({ values: vi.fn().mockResolvedValue(undefined) }));
    mockDb.update.mockImplementation(() => ({
      set: vi.fn().mockImplementation((data: unknown) => {
        capturedSetCalls.push(data);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    }));
  });

  it("deletes the stale last5 stats row when the player has no match logs at new club", async () => {
    await syncPlayerStatsAndInjuries(/* fixturesPerClub */ 1);

    // db.delete(playerStatsTable) must be called at least for "last5" and "previous5"
    // (the stale rows from the prior club).  With no season-stats data either,
    // "season", "previous_season", and "season_all" are also cleared — 5 total.
    const statsTableDeletes = mockDb.delete.mock.calls.filter(([table]) => table === tPlayerStats);
    expect(statsTableDeletes.length).toBeGreaterThanOrEqual(2);

    // Inspect the where-condition shapes captured during the delete calls.
    // eq(column, value) → { _eq: [column, value] }
    // and(…)            → { _and: [ cond1, cond2 ] }
    // We search for a condition that includes "last5" as the value in any _eq leaf.
    function includesValue(condition: unknown, target: unknown): boolean {
      if (condition == null || typeof condition !== "object") return false;
      const c = condition as Record<string, unknown>;
      if ("_eq" in c) return (c._eq as unknown[]).includes(target);
      if ("_and" in c) return (c._and as unknown[]).some((sub) => includesValue(sub, target));
      return false;
    }

    const last5Deleted = capturedWhereCallsForStatsDelete.some((cond) => includesValue(cond, "last5"));
    expect(last5Deleted, "expected a db.delete(playerStatsTable).where(…) call targeting periodType='last5'").toBe(true);

    const prev5Deleted = capturedWhereCallsForStatsDelete.some((cond) => includesValue(cond, "previous5"));
    expect(prev5Deleted, "expected a db.delete(playerStatsTable).where(…) call targeting periodType='previous5'").toBe(true);
  });

  it("writes performanceTrend = 'steady' — not a stale prior-club value", async () => {
    await syncPlayerStatsAndInjuries(1);

    // db.update(playersTable).set({ performanceTrend, trending }) must include
    // performanceTrend = "steady" — the reset value from computeFormTier(null, null, null).
    const trendUpdates = (capturedSetCalls as Array<Record<string, unknown>>).filter(
      (data) => "performanceTrend" in data,
    );

    expect(trendUpdates.length).toBeGreaterThanOrEqual(1);

    // The write for our player must be "steady" (no data → no badge inflation)
    const lastWrite = trendUpdates[trendUpdates.length - 1];
    expect(lastWrite.performanceTrend).toBe("steady");
    expect(lastWrite.trending).toBe(false);
  });

  it("does not insert any new last5 or previous5 rows", async () => {
    await syncPlayerStatsAndInjuries(1);

    // No db.insert(playerStatsTable) with a "last5" or "previous5" periodType should occur
    // when the player has no match logs.  The insert mock records every call to .values().
    // We check that no insert was made at all to playerStatsTable — because:
    //   • last5 / previous5 derive from match logs (none exist)
    //   • season stats derive from API-Football season endpoint (afFetch returns [])
    const statsInserts = mockDb.insert.mock.calls.filter(([table]) => table === tPlayerStats);
    expect(statsInserts).toHaveLength(0);
  });

  it("clears the club match-log rows for the player (not just the stats rows)", async () => {
    await syncPlayerStatsAndInjuries(1);

    // The sync always deletes stale club match logs before re-inserting —
    // this is the guard at line ~681 of playerStatsSync.ts.
    const matchLogDeletes = mockDb.delete.mock.calls.filter(([table]) => table === tMatchLogs);
    expect(matchLogDeletes.length).toBeGreaterThanOrEqual(1);
  });

  it("does not insert any new club match-log rows when the fixture list is empty", async () => {
    await syncPlayerStatsAndInjuries(1);

    const matchLogInserts = mockDb.insert.mock.calls.filter(([table]) => table === tMatchLogs);
    expect(matchLogInserts).toHaveLength(0);
  });

  it("completes without throwing and reports zero failures", async () => {
    const result = await syncPlayerStatsAndInjuries(1);
    expect(result).toMatchObject({
      clubsProcessed: expect.any(Number),
      failures: 0,
    });
  });
});
