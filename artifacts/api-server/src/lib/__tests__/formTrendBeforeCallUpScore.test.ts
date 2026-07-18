/**
 * Regression guard: confirms that `potentialCallUpScore` is computed from
 * live `player_stats` rows (last5, previous5, season) rather than from the
 * stale `performance_trend` column — which is no longer updated by the sync.
 *
 * ## Why this matters
 * `computeCallUpScore` takes a form tier as an input.  The sync now derives
 * that tier inline from `player_stats` DB rows in the same Promise.all that
 * reads season minutes and last5 rating — so the score always reflects
 * whatever stats are committed, with no risk of a stale column value or a
 * missing pre-loop write causing the wrong tier to be used.
 *
 * ## Test scenarios
 * 1. **No stats** — player has no player_stats rows. Trend = "steady"
 *    (computeFormTier null guard). Score = 40 + 0 + 0 + 2 + 5 = 47.
 *
 * 2. **on_fire stats** — last5 / previous5 / season values produce "on_fire".
 *    Score = 40 + 20 (on_fire) + 13 (2500 min) + 2 (age 25) + 5 (3 caps)
 *          + 4 (rating 7.18 > 7.0) = 84.
 *
 * ## Test setup
 * - One club, one player without an `apiFootballPlayerId` (short-circuit
 *   branch — no fixture API calls, minimal mock complexity).
 * - afFetch returns [] for all calls.
 * - Stats mocks vary per suite (see each beforeEach).
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
 * Row returned by the post-loop freshPlayers query.
 * `performanceTrend` is no longer selected from the players table —
 * the form tier is derived inline from player_stats rows.
 */
const FRESH_PLAYER = {
  id: 10,
  category: "fringe",
  nationalTeamCaps: 3,
  marketValueUsd: null,
  age: 25,
};

/** Stats rows that produce the on_fire tier via computeFormTier. */
const ON_FIRE_L5 = [{ playerId: PLAYER.id, minutes: 450, avgRating: 7.18 }];
const ON_FIRE_P5 = [{ playerId: PLAYER.id, minutes: 450, avgRating: 6.64 }];
const ON_FIRE_SEASON = [{ playerId: PLAYER.id, minutes: 2500, avgRating: 6.89 }];

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
// Shared per-test reset (common mock infra; stats mocks set per-describe)
// ---------------------------------------------------------------------------

function restoreUpdateMock() {
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
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Suite 1: player with no stats → trend = "steady" → score = 47
describe("sync pipeline: no player_stats → potentialCallUpScore = steady baseline (47)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedUpdateCalls.length = 0;

    mockResolveTeamId.mockResolvedValue(CLUB_TEAM_ID);
    mockEnsurePlayerApiFootballIds.mockResolvedValue(undefined);
    mockAfFetch.mockResolvedValue([]);

    // db.select sequence:
    //   1 → clubs
    //   2 → players
    //   3 → allLast5      (post-loop, uses .where())
    //   4 → allPrevious5  (post-loop, uses .where())
    //   5 → allSeason     (post-loop, uses .where())
    //   6 → activeInjuries (post-loop, uses .where())
    //   7+ → freshPlayers  (no .where())
    mockDb.select
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([CLUB])) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([PLAYER])) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([])) }) // allLast5
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([])) }) // allPrevious5
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([])) }) // allSeason
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([])) }) // activeInjuries
      .mockReturnValue({ from: vi.fn().mockReturnValue(makeFromResult([FRESH_PLAYER])) }); // freshPlayers

    restoreUpdateMock();
  });

  it("writes potentialCallUpScore = 47 (steady baseline — no stats rows)", async () => {
    // Score = base(40) + steady(0) + nullMins(0) + age<26(+2) + caps≤10(+5)
    //       + nullRating(0) + nullMV(0) + noInjury(0) = 47.
    await syncPlayerStatsAndInjuries(1);

    const scoreWrites = (capturedUpdateCalls as Array<Record<string, unknown>>).filter(
      (d) => "potentialCallUpScore" in d,
    );
    expect(scoreWrites.length, "expected potentialCallUpScore to be written").toBeGreaterThanOrEqual(1);
    expect(scoreWrites[0].potentialCallUpScore).toBe(47);
  });

  it("does NOT write performanceTrend to the players table", async () => {
    await syncPlayerStatsAndInjuries(1);

    const trendWrites = (capturedUpdateCalls as Array<Record<string, unknown>>).filter(
      (d) => "performanceTrend" in d,
    );
    expect(
      trendWrites.length,
      "performanceTrend must not be written to the players table — badge is now derived at query time",
    ).toBe(0);
  });

  it("completes without throwing and reports zero failures", async () => {
    const result = await syncPlayerStatsAndInjuries(1);
    expect(result).toMatchObject({ failures: 0 });
  });
});

// Suite 2: on_fire stats → trend = "on_fire" → score = 84
// Stats: last5.avgRating=7.18, prev5.avgRating=6.64, season.avgRating=6.89
//   score_formula = 50*(7.18-6.89) + 30*(7.18-6.64) = 14.5 + 16.2 = 30.7 ≥ 25 → on_fire
// Call-up score = 40 + 20(on_fire) + 13(2500 min) + 2(age<26) + 5(caps) + 4(rating>7.0) = 84
describe("sync pipeline: on_fire player_stats → potentialCallUpScore = 84", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedUpdateCalls.length = 0;

    mockResolveTeamId.mockResolvedValue(CLUB_TEAM_ID);
    mockEnsurePlayerApiFootballIds.mockResolvedValue(undefined);
    mockAfFetch.mockResolvedValue([]);

    mockDb.select
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([CLUB])) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([PLAYER])) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult(ON_FIRE_L5)) })     // allLast5
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult(ON_FIRE_P5)) })     // allPrevious5
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult(ON_FIRE_SEASON)) }) // allSeason
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([])) })             // activeInjuries
      .mockReturnValue({ from: vi.fn().mockReturnValue(makeFromResult([FRESH_PLAYER])) });    // freshPlayers

    restoreUpdateMock();
  });

  it("writes potentialCallUpScore = 84 (on_fire tier computed from player_stats)", async () => {
    // If the score used "steady" instead of "on_fire", the result would be 47.
    // Getting 84 proves the inline computation reaches the correct tier.
    await syncPlayerStatsAndInjuries(1);

    const scoreWrites = (capturedUpdateCalls as Array<Record<string, unknown>>).filter(
      (d) => "potentialCallUpScore" in d,
    );
    expect(scoreWrites.length, "expected potentialCallUpScore to be written").toBeGreaterThanOrEqual(1);

    const EXPECTED = 84;
    const STALE_STEADY = 47;
    const written = scoreWrites[0].potentialCallUpScore;
    expect(written, `score ${written} matches stale steady (${STALE_STEADY}) — inline trend computation may not be working`).not.toBe(STALE_STEADY);
    expect(written, `expected ${EXPECTED} (on_fire tier), got ${written}`).toBe(EXPECTED);
  });

  it("does NOT write performanceTrend to the players table", async () => {
    await syncPlayerStatsAndInjuries(1);

    const trendWrites = (capturedUpdateCalls as Array<Record<string, unknown>>).filter(
      (d) => "performanceTrend" in d,
    );
    expect(
      trendWrites.length,
      "performanceTrend must not be written to the players table — badge is now derived at query time",
    ).toBe(0);
  });

  it("completes without throwing and reports zero failures", async () => {
    const result = await syncPlayerStatsAndInjuries(1);
    expect(result).toMatchObject({ failures: 0 });
  });
});
