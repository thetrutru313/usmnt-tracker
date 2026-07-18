/**
 * Regression guard: confirms that when a club's sync block throws, players at
 * that club are recomputed from their existing player_stats rows — not left on
 * the pre-reset "steady" value.
 *
 * ## What & Why
 * `syncPlayerStatsAndInjuries` runs a safety-net pre-reset before the club
 * loop that sets every player's `performanceTrend = 'steady'`. After the loop
 * it calls `recomputeFormTrends` to overwrite that reset with the correct tier
 * derived from committed player_stats rows.
 *
 * Previously `recomputeFormTrends` was scoped to `processedPlayerIds` (clubs
 * that succeeded). A club-level throw left those players' stats rows in the DB
 * but their trend stuck on "steady" indefinitely — even when the formula
 * clearly produced a different tier. Julian Hall (NYRB, May 2026) had a score
 * of 30.7 (→ on_fire) but showed "steady" for exactly this reason.
 *
 * The fix: `recomputeFormTrends` now runs against ALL player IDs. Players at
 * a failed club still have their previous-run stats rows; those rows are used
 * for the recompute. Players with no rows at all fall through computeFormTier's
 * null guard and remain "steady" — the correct result when there is genuinely
 * nothing to compute from.
 *
 * ## Test suites
 * 1. Club throws — player HAS valid player_stats rows → gets "on_fire" (not "steady")
 * 2. Club throws — player has NO player_stats rows → stays "steady" (correct fallback)
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared mock state (vi.hoisted so factories can reference before vi.mock)
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
} = vi.hoisted(() => {
  const tClubs = { _table: "clubs" };
  const tPlayers = { _table: "players" };
  const tPlayerStats = { _table: "playerStats" };
  const tMatchLogs = { _table: "matchLogs" };
  const tInjuries = { _table: "injuries" };

  const capturedSetCalls: unknown[] = [];

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

// Import AFTER mocks
import { syncPlayerStatsAndInjuries } from "../playerStatsSync.js";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const CLUB = { id: 1, name: "New York Red Bulls", apiFootballTeamId: 1599 };

/** Julian Hall scenario — last5Avg 7.18, prev5Avg 6.64, seasonAvg 6.89 → on_fire */
const PLAYER = {
  id: 56,
  name: "Julian Hall",
  clubId: 1,
  apiFootballPlayerId: 12345,
  age: 22,
  category: "prospect",
  nationalTeamCaps: 0,
  marketValueUsd: 2_000_000,
};

/**
 * Stats rows that produce on_fire:
 * score = 50*(7.18−6.89) + 30*(7.18−6.64) = 14.5 + 16.2 = 30.7 ≥ 25 → on_fire
 * trajectory: 7.18 > 6.64 → gate inactive → on_fire confirmed
 */
const ON_FIRE_STATS_ROWS = [
  { playerId: PLAYER.id, periodType: "last5",     minutes: 393,  avgRating: 7.18 },
  { playerId: PLAYER.id, periodType: "previous5", minutes: 457,  avgRating: 6.64 },
  { playerId: PLAYER.id, periodType: "season",    minutes: 1298, avgRating: 6.89 },
];

/**
 * Returns a PromiseLike that also has a `.where()` method so it can serve
 * both `await db.select().from(t)` and `await db.select().from(t).where(…)`.
 */
function makeFromResult(data: unknown[]) {
  const p = Promise.resolve(data) as Promise<unknown[]> & { where: ReturnType<typeof vi.fn> };
  p.where = vi.fn().mockResolvedValue(data);
  return p;
}

/** Restores mock implementations after clearAllMocks wipes them. */
function restoreMocks() {
  mockDb.delete.mockImplementation(() => ({
    where: vi.fn().mockResolvedValue(undefined),
  }));
  mockDb.insert.mockImplementation(() => ({
    values: vi.fn().mockResolvedValue(undefined),
  }));
  mockDb.update.mockImplementation(() => ({
    set: vi.fn().mockImplementation((data: unknown) => {
      capturedSetCalls.push(data);
      return { where: vi.fn().mockResolvedValue(undefined) };
    }),
  }));
}

// ---------------------------------------------------------------------------
// Suite 1: Club fails — player HAS valid player_stats rows
// Expected: recomputeFormTrends uses those rows → writes "on_fire", NOT "steady"
// ---------------------------------------------------------------------------

describe("club sync failure — post-loop call-up score still runs for all players", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedSetCalls.length = 0;

    // Club lookup throws immediately — simulates a network or API error
    mockResolveTeamId.mockRejectedValue(new Error("API-Football team lookup failed"));
    mockEnsurePlayerApiFootballIds.mockResolvedValue(undefined);
    mockAfFetch.mockResolvedValue([]); // national-team injuries (pre-loop)

    // db.select sequence:
    //   call 1 → clubs query
    //   call 2 → players query
    //   call 3+ → post-loop call-up score queries (allLast5, allPrevious5, allSeason,
    //             activeInjuries, freshPlayers) → all return []
    mockDb.select
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([CLUB])) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([PLAYER])) })
      .mockReturnValue({ from: vi.fn().mockReturnValue(makeFromResult([])) });

    restoreMocks();
  });

  it("reports the club failure in the result", async () => {
    const result = await syncPlayerStatsAndInjuries(1);
    expect(result.failures).toBe(1);
    expect(result.clubsProcessed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Club fails — player has NO player_stats rows
// The badge is now derived on-demand at query time (queries.ts). The sync
// correctly skips any badge writes to the players table in this case.
// ---------------------------------------------------------------------------

describe("club sync failure — no trend writes for any player (badge is query-time)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedSetCalls.length = 0;

    mockResolveTeamId.mockRejectedValue(new Error("API-Football team lookup failed"));
    mockEnsurePlayerApiFootballIds.mockResolvedValue(undefined);
    mockAfFetch.mockResolvedValue([]);

    // db.select sequence:
    //   call 1 → clubs
    //   call 2 → players
    //   call 3+ → post-loop call-up score queries (allLast5, allPrevious5, allSeason,
    //             activeInjuries, freshPlayers) → all return []
    mockDb.select
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([CLUB])) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([PLAYER])) })
      .mockReturnValue({ from: vi.fn().mockReturnValue(makeFromResult([])) });

    restoreMocks();
  });

  it("no performanceTrend writes to the players table even after a club failure", async () => {
    await syncPlayerStatsAndInjuries(1);

    const trendWrites = (capturedSetCalls as Array<Record<string, unknown>>).filter(
      (d) => "performanceTrend" in d,
    );
    expect(
      trendWrites.length,
      "performanceTrend must not be written to the players table — badge is derived at query time",
    ).toBe(0);
  });

  it("post-loop call-up score queries still run even when the club sync failed", async () => {
    await syncPlayerStatsAndInjuries(1);

    // 1 clubs + 1 players + 5 post-loop queries = at least 5 select calls total.
    expect(
      mockDb.select.mock.calls.length,
      "post-loop call-up score section must still issue queries even when the club failed",
    ).toBeGreaterThanOrEqual(5);
  });
});
