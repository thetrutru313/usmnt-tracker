/**
 * Ordering guard: confirms that `performanceTrend` is persisted to the
 * players table **before** `potentialCallUpScore` is computed and written
 * in the post-loop recompute section of `syncPlayerStatsAndInjuries`.
 *
 * ## Why this matters
 * `computeCallUpScore` takes `performanceTrend` as an input.  The post-loop
 * batch re-read fetches `performanceTrend` from the DB — meaning the in-loop
 * write must have committed first, or the score silently reflects the stale
 * badge from a prior sync cycle for a full day.
 *
 * ## What is tested
 * 1. **Ordering** — every `db.update(playersTable).set({ performanceTrend })`
 *    call is recorded; every `db.update(playersTable).set({ potentialCallUpScore })`
 *    call is recorded.  The test asserts the first trend write comes strictly
 *    before the first score write.  Swapping the two call sites in the source
 *    flips the indices and the assertion fails.
 *
 * 2. **Value propagation** — the freshPlayers mock returns a player whose
 *    `performanceTrend` is "on_fire".  The test asserts the written
 *    `potentialCallUpScore` matches what `computeCallUpScore` would produce
 *    for that trend (67), not the "steady" baseline (47) that would result
 *    if the score were computed before reading the fresh trend from the DB.
 *
 * ## Test setup
 * - One club, one player without an `apiFootballPlayerId`.
 * - afFetch returns [] for all calls (national-team injuries, fixtures).
 * - In-loop form tier → "steady" (no logs, no API id) → written to DB.
 * - Post-loop freshPlayers mock returns `performanceTrend: "on_fire"` —
 *   simulating a player whose in-loop write produced a non-default badge.
 * - allLast5 and allSeason post-loop reads return [] (null ratings / minutes).
 * - activeInjuries returns [] (no injury penalty).
 *
 * Expected potentialCallUpScore = 40 (base) + 20 (on_fire) + 0 (null mins)
 *   + 2 (age 25 < 26) + 5 (3 caps ≤ 10) + 0 (null rating) + 0 (null MV) = 67.
 * A stale "steady" badge would produce 40 + 0 + 0 + 2 + 5 = 47.
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
  capturedUpdateCalls,
} = vi.hoisted(() => {
  const tClubs = { _table: "clubs" };
  const tPlayers = { _table: "players" };
  const tPlayerStats = { _table: "playerStats" };
  const tMatchLogs = { _table: "matchLogs" };
  const tInjuries = { _table: "injuries" };

  // All db.update(playersTable).set(data) payloads captured in call order.
  // This lets the tests inspect both what was written and when.
  const capturedUpdateCalls: unknown[] = [];

  const mockDb = {
    select: vi.fn(),
    delete: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockResolvedValue(undefined),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((data: unknown) => {
        capturedUpdateCalls.push(data);
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
    capturedUpdateCalls,
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

// Import AFTER mocks are registered.
import { syncPlayerStatsAndInjuries } from "../playerStatsSync.js";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const CLUB_TEAM_ID = 301;

/** Club with a known API team id — resolveTeamId is mocked to return it. */
const CLUB = { id: 1, name: "Test FC", apiFootballTeamId: CLUB_TEAM_ID };

/**
 * Player WITHOUT an apiFootballPlayerId — takes the short-circuit branch that
 * still writes `performanceTrend` (line ~801 of playerStatsSync.ts) without
 * requiring any season-stats API calls.  This keeps the mock setup minimal.
 */
const PLAYER = {
  id: 10,
  name: "Test Player",
  clubId: 1,
  apiFootballPlayerId: null,
  age: 25,
  category: "fringe",
  nationalTeamCaps: 3,
  marketValueUsd: null,
};

/**
 * Row returned by the post-loop freshPlayers query.  We deliberately set
 * `performanceTrend: "on_fire"` here — simulating a player whose in-loop
 * write produced a non-default badge (the in-loop write itself will be
 * "steady" since there are no logs, but the freshPlayers mock overrides
 * what the DB "returns" to the post-loop reader).
 *
 * This isolates the ordering concern: the test verifies the post-loop reads
 * whatever the DB holds (the freshly written value) rather than a cached
 * pre-write value.
 */
const FRESH_PLAYER = {
  id: 10,
  category: "fringe",
  nationalTeamCaps: 3,
  marketValueUsd: null,
  age: 25,
  performanceTrend: "on_fire",
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
// Per-test reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  capturedUpdateCalls.length = 0;

  mockResolveTeamId.mockResolvedValue(CLUB_TEAM_ID);
  mockEnsurePlayerApiFootballIds.mockResolvedValue(undefined);
  // afFetch returns [] for national-team injuries (3 season candidates) and
  // for any fixture calls — the player has no apiFootballPlayerId so no
  // fixture API calls are made, but national-team injury calls still fire.
  mockAfFetch.mockResolvedValue([]);

  // db.select call sequence:
  //   1 → clubs
  //   2 → players
  //   3 → post-loop allLast5   (periodType="last5", uses .where())
  //   4 → post-loop allSeason  (periodType="season", uses .where())
  //   5 → post-loop activeInjuries (status="active", uses .where())
  //   6 → post-loop freshPlayers   (no .where(), direct await)
  mockDb.select
    .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([CLUB])) })
    .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([PLAYER])) })
    .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([])) }) // allLast5
    .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([])) }) // allSeason
    .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([])) }) // activeInjuries
    .mockReturnValue({ from: vi.fn().mockReturnValue(makeFromResult([FRESH_PLAYER])) }); // freshPlayers

  // Restore implementations cleared by vi.clearAllMocks().
  mockDb.delete.mockImplementation(() => ({
    where: vi.fn().mockResolvedValue(undefined),
  }));
  mockDb.insert.mockImplementation(() => ({
    values: vi.fn().mockResolvedValue(undefined),
  }));
  mockDb.update.mockImplementation(() => ({
    set: vi.fn().mockImplementation((data: unknown) => {
      capturedUpdateCalls.push(data);
      return { where: vi.fn().mockResolvedValue(undefined) };
    }),
  }));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sync pipeline write ordering — performanceTrend before potentialCallUpScore", () => {
  it("writes performanceTrend to the DB before computing and writing potentialCallUpScore", async () => {
    await syncPlayerStatsAndInjuries(/* fixturesPerClub */ 1);

    const updates = capturedUpdateCalls as Array<Record<string, unknown>>;

    const trendIdx = updates.findIndex((d) => "performanceTrend" in d);
    const scoreIdx = updates.findIndex((d) => "potentialCallUpScore" in d);

    expect(
      trendIdx,
      "expected at least one db.update(playersTable).set({ performanceTrend, … }) call — none found",
    ).toBeGreaterThanOrEqual(0);

    expect(
      scoreIdx,
      "expected at least one db.update(playersTable).set({ potentialCallUpScore }) call — none found",
    ).toBeGreaterThanOrEqual(0);

    // Core ordering assertion: trend write must precede score write.
    // Swapping the two call sites in syncPlayerStatsAndInjuries causes
    // trendIdx > scoreIdx, which fails this assertion.
    expect(
      trendIdx,
      `performanceTrend write (index ${trendIdx}) must come before ` +
        `potentialCallUpScore write (index ${scoreIdx}) — ` +
        "if these are swapped, the score is computed from a stale trend for a full sync cycle",
    ).toBeLessThan(scoreIdx);
  });

  it("potentialCallUpScore reflects the trend read from DB, not a stale pre-write value", async () => {
    // freshPlayers returns performanceTrend = "on_fire".
    // Expected score:
    //   base=40, on_fire=+20, null minutes=+0, age=25(<26)=+2,
    //   caps=3(≤10)=+5, null rating=+0, null MV=+0, no injury=+0 → 67.
    // If the score were computed before reading the DB-written trend and fell
    // back to "steady" (the in-loop write for this no-logs player), the result
    // would be 40+0+0+2+5 = 47 — a clear, detectable mismatch.
    await syncPlayerStatsAndInjuries(1);

    const scoreWrites = (capturedUpdateCalls as Array<Record<string, unknown>>).filter(
      (d) => "potentialCallUpScore" in d,
    );

    expect(
      scoreWrites.length,
      "expected potentialCallUpScore to be written for the player",
    ).toBeGreaterThanOrEqual(1);

    // The score for FRESH_PLAYER (on_fire, age 25, 3 caps, null mins/rating/MV, no injury):
    const EXPECTED_ON_FIRE_SCORE = 67;
    const STALE_STEADY_SCORE = 47; // what would be written if trend were read before the DB write
    const writtenScore = scoreWrites[0].potentialCallUpScore;

    expect(
      writtenScore,
      `potentialCallUpScore ${writtenScore} matches the stale "steady" score (${STALE_STEADY_SCORE}) — ` +
        `the post-loop may be reading performanceTrend before it is written to the DB`,
    ).not.toBe(STALE_STEADY_SCORE);

    expect(
      writtenScore,
      `potentialCallUpScore should be ${EXPECTED_ON_FIRE_SCORE} (reflecting "on_fire" from DB), ` +
        `got ${writtenScore}`,
    ).toBe(EXPECTED_ON_FIRE_SCORE);
  });

  it("completes without throwing and reports zero failures", async () => {
    const result = await syncPlayerStatsAndInjuries(1);
    expect(result).toMatchObject({ failures: 0 });
  });
});
