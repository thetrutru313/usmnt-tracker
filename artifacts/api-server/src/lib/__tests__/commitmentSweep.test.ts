/**
 * Sweep-level tests for the commitment tracking pipeline.
 *
 * Tests the two logic bugs caught in code review:
 *
 * 1. Players with null usmnt_status must be included in the sweep.
 *    SQL `NULL <> 'CAP_TIED_OTHER'` evaluates to NULL (not TRUE), so a plain
 *    `ne()` filter silently excludes the entire un-evaluated population.
 *    The fix uses `or(isNull(usmntStatus), ne(usmntStatus, 'CAP_TIED_OTHER'))`.
 *
 * 2. HIGH-confidence detections must persist needs_review=true in the DB.
 *    The original code passed `needsReview: true` into evaluateFlagConditions
 *    for HIGH detections, which bypassed the DB update path because the
 *    function short-circuits when needsReview is already truthy.
 *    The fix always passes `player.needsReview` (the persisted value).
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------

const {
  mockDb,
  tPlayers,
  tCandidates,
  tHistory,
  mockAfFetch,
  mockOrFn,
  mockIsNullFn,
  mockNeFn,
  mockIsNotNullFn,
  mockAndFn,
  mockEqFn,
} = vi.hoisted(() => {
  // Minimal chainable DB mock
  const whereResult = { then: undefined as unknown };
  const updateWhereMock = vi.fn().mockResolvedValue(undefined);
  const updateSetMock = vi.fn().mockReturnValue({ where: updateWhereMock });
  const insertValuesMock = vi.fn().mockResolvedValue([{ id: 1 }]);

  const mockDb = {
    select: vi.fn(),
    insert: vi.fn().mockReturnValue({ values: insertValuesMock }),
    update: vi.fn().mockReturnValue({ set: updateSetMock }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    _updateSetMock: updateSetMock,
    _updateWhereMock: updateWhereMock,
    _insertValuesMock: insertValuesMock,
  };

  return {
    mockDb,
    tPlayers: { _t: "players" },
    tCandidates: { _t: "player_candidates" },
    tHistory: { _t: "player_status_history" },
    mockAfFetch: vi.fn(),
    mockOrFn: vi.fn((...args) => ({ _or: args })),
    mockIsNullFn: vi.fn((col) => ({ _isNull: col })),
    mockNeFn: vi.fn((col, val) => ({ _ne: [col, val] })),
    mockIsNotNullFn: vi.fn((col) => ({ _isNotNull: col })),
    mockAndFn: vi.fn((...args) => ({ _and: args })),
    mockEqFn: vi.fn((col, val) => ({ _eq: [col, val] })),
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: mockDb,
  playersTable: tPlayers,
  playerCandidatesTable: tCandidates,
  playerStatusHistoryTable: tHistory,
}));

vi.mock("drizzle-orm", () => ({
  eq: mockEqFn,
  ne: mockNeFn,
  and: mockAndFn,
  or: mockOrFn,
  isNull: mockIsNullFn,
  isNotNull: mockIsNotNullFn,
}));

vi.mock("../apiFootballSync.js", () => ({
  afFetch: mockAfFetch,
}));

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../playerStatsSync.js", () => ({
  isFriendlyLeague: (name: string) => /friendl/i.test(name),
}));

// Import AFTER mocks
import { runCommitmentSweep, evaluateFlagConditions } from "../commitmentTracker.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSelectChain(returnValue: unknown[]) {
  const fromMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(returnValue) });
  return { from: fromMock };
}

// ---------------------------------------------------------------------------
// Sweep — null usmnt_status players are processed, not skipped
// ---------------------------------------------------------------------------

describe("runCommitmentSweep — SQL filter includes null usmnt_status players", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses or(isNull, ne) for the usmnt_status filter so null-status players are included", async () => {
    // Players query returns one player with null usmntStatus
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([
        { id: 1, name: "Test Player", apiFootballPlayerId: 111, usmntStatus: null, needsReview: false },
      ]))
      // Candidates query returns empty
      .mockReturnValueOnce(makeSelectChain([]));

    // /players/teams — no national teams → NONE confidence, no stat fetch
    mockAfFetch.mockResolvedValue([]);

    await runCommitmentSweep();

    // Verify the OR condition was constructed — or() called with results of
    // isNull() and ne(), not a bare ne() that would exclude null statuses.
    // We check both helper functions were invoked rather than inspecting the
    // opaque argument values (which are mocked drizzle tokens, not real columns).
    expect(mockOrFn).toHaveBeenCalled();
    expect(mockIsNullFn).toHaveBeenCalled(); // isNull(usmntStatus) was part of the condition
    // ne() is called with "CAP_TIED_OTHER" as the second arg (value to exclude).
    // The column token is undefined in this mock since tPlayers has no real columns.
    const neCalls = mockNeFn.mock.calls as unknown[][];
    expect(neCalls.some((args) => args[1] === "CAP_TIED_OTHER")).toBe(true);
  });

  it("does not use a bare ne() that would exclude null statuses", async () => {
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([]));
    mockAfFetch.mockResolvedValue([]);

    await runCommitmentSweep();

    // or() must have been called — a bare ne() without or() would be the bug
    expect(mockOrFn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// evaluateFlagConditions — HIGH detection persists needs_review in DB
// ---------------------------------------------------------------------------

describe("evaluateFlagConditions — persists needs_review=true when currently false", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the update chain mock for each test
    const updateWhereMock = vi.fn().mockResolvedValue(undefined);
    const updateSetMock = vi.fn().mockReturnValue({ where: updateWhereMock });
    mockDb.update.mockReturnValue({ set: updateSetMock });
    mockDb._updateSetMock = updateSetMock;
    mockDb._updateWhereMock = updateWhereMock;
  });

  it("calls db.update to set needs_review=true when needsReview=false and detection=true", async () => {
    const player = {
      id: 42,
      name: "Dual National",
      needsReview: false,
      eligibilityConfidence: null,
    };

    const result = await evaluateFlagConditions(player, /* newInternationalDetection */ true);

    expect(result).toBe(true);
    expect(mockDb.update).toHaveBeenCalledWith(tPlayers);
    expect(mockDb._updateSetMock).toHaveBeenCalledWith({ needsReview: true });
  });

  it("does NOT call db.update when needsReview is already true (avoid redundant writes)", async () => {
    const player = {
      id: 42,
      name: "Already Flagged",
      needsReview: true,
      eligibilityConfidence: null,
    };

    await evaluateFlagConditions(player, /* newInternationalDetection */ true);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("calls db.update when confidence is below threshold even without a new detection", async () => {
    const player = {
      id: 55,
      name: "Low Confidence",
      needsReview: false,
      eligibilityConfidence: 30, // below MIN_CONFIDENCE_THRESHOLD of 40
    };

    const result = await evaluateFlagConditions(player, /* newInternationalDetection */ false);

    expect(result).toBe(true);
    expect(mockDb.update).toHaveBeenCalledWith(tPlayers);
  });

  it("returns false and does not update when no flag conditions fire", async () => {
    const player = {
      id: 55,
      name: "Clean Player",
      needsReview: false,
      eligibilityConfidence: 80, // above threshold
    };

    const result = await evaluateFlagConditions(player, /* newInternationalDetection */ false);

    expect(result).toBe(false);
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Sweep — HIGH detection writes needs_review to DB (integration of the two fixes)
// ---------------------------------------------------------------------------

describe("runCommitmentSweep — HIGH detection persists needs_review=true", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const updateWhereMock = vi.fn().mockResolvedValue(undefined);
    const updateSetMock = vi.fn().mockReturnValue({ where: updateWhereMock });
    mockDb.update.mockReturnValue({ set: updateSetMock });
    mockDb._updateSetMock = updateSetMock;
    mockDb._updateWhereMock = updateWhereMock;
    // insert chain for player_status_history
    mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue([{ id: 99 }]) });
  });

  it("sets needs_review=true in DB for a player with needsReview=false and HIGH detection", async () => {
    // Player with null usmntStatus and needsReview=false
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([
        { id: 7, name: "Switching Player", apiFootballPlayerId: 777, usmntStatus: null, needsReview: false },
      ]))
      .mockReturnValueOnce(makeSelectChain([])); // candidates

    // /players/teams: Mexico is national=true
    mockAfFetch
      .mockResolvedValueOnce([
        { team: { id: 45, name: "Mexico", national: true } },
      ])
      // /players?id&season — competitive Mexico appearance
      .mockResolvedValueOnce([
        {
          player: { id: 777 },
          statistics: [
            {
              team: { id: 45, name: "Mexico" },
              league: { name: "CONCACAF Nations League", season: 2025 },
              games: { lineups: 2, minutes: 180 },
            },
          ],
        },
      ])
      // remaining season fetches
      .mockResolvedValue([]);

    await runCommitmentSweep();

    // Verify db.update was called with { needsReview: true }
    const updateSetCalls = mockDb._updateSetMock.mock.calls as unknown[][];
    const flagCall = updateSetCalls.find(
      (args) =>
        args[0] != null &&
        typeof args[0] === "object" &&
        (args[0] as Record<string, unknown>)["needsReview"] === true,
    );
    expect(flagCall).toBeDefined();
  });
});
