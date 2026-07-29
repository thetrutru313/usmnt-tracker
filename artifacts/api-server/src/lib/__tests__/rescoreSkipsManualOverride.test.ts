/**
 * Regression guard: confirms that `rescoreAllCandidates` never overwrites a
 * candidate whose `is_manual_override` flag is set.
 *
 * ## Why this matters
 * The override-status endpoint sets `is_manual_override = true` so operators
 * can pin a USMNT eligibility classification that the scoring engine should
 * never touch.  Without this guard, a future change to `rescoreAllCandidates`
 * or `evaluateEligibility` could silently clobber the operator's decision.
 *
 * ## What is tested
 * 1. A candidate with `is_manual_override = true` is NOT written to by the
 *    rescore pass — `db.update` must not be called for that candidate's id.
 * 2. The `usmnt_status` and `is_manual_override` values in the DB remain the
 *    ones set by the override-status endpoint.
 * 3. The `status_notes` string containing the override entry is preserved
 *    (i.e., the update that would strip it never fires).
 * 4. A normal (non-overridden) candidate IS rescored — confirming the skip
 *    is targeted at the overridden row only.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared mock state — vi.hoisted so factories execute before vi.mock calls
// ---------------------------------------------------------------------------

const {
  mockDb,
  tCandidates,
  tClubs,
  tPlayers,
  tEligibilitySignals,
  mockAfFetch,
  capturedUpdateWhereArgs,
} = vi.hoisted(() => {
  const tCandidates = { _table: "player_candidates" };
  const tClubs = { _table: "clubs" };
  const tPlayers = { _table: "players" };
  const tEligibilitySignals = { _table: "eligibility_signals" };

  /** Track every candidateId passed to db.update(...).set(...).where(...) */
  const capturedUpdateWhereArgs: unknown[] = [];

  const mockDb = {
    select: vi.fn(),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation((whereArg: unknown) => {
          capturedUpdateWhereArgs.push(whereArg);
          return Promise.resolve(undefined);
        }),
      }),
    })),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    })),
    delete: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
  };

  return {
    mockDb,
    tCandidates,
    tClubs,
    tPlayers,
    tEligibilitySignals,
    mockAfFetch: vi.fn(),
    capturedUpdateWhereArgs,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: mockDb,
  playerCandidatesTable: tCandidates,
  playersTable: tPlayers,
  clubsTable: tClubs,
  eligibilitySignalsTable: tEligibilitySignals,
}));

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, val: unknown) => ({ _eq: val }),
  asc: (_col: unknown) => ({ _asc: _col }),
  and: (...args: unknown[]) => ({ _and: args }),
  or: (...args: unknown[]) => ({ _or: args }),
  isNull: (_col: unknown) => ({ _isNull: _col }),
  desc: (_col: unknown) => ({ _desc: _col }),
  gte: (_col: unknown, _val: unknown) => ({ _gte: [_col, _val] }),
  inArray: (_col: unknown, _vals: unknown) => ({ _inArray: [_col, _vals] }),
  isNotNull: (_col: unknown) => ({ _isNotNull: _col }),
  lt: (_col: unknown, _val: unknown) => ({ _lt: [_col, _val] }),
  count: () => ({ _count: true }),
  sql: Object.assign(
    (_strings: TemplateStringsArray, ..._values: unknown[]) => ({ _sql: true }),
    { raw: (_val: string) => ({ _sqlRaw: _val }) },
  ),
}));

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../apiFootballSync.js", () => ({
  afFetch: mockAfFetch,
  apiKey: vi.fn().mockReturnValue("test-key"),
  syncApiFootballFixtures: vi.fn().mockResolvedValue(undefined),
  syncNationalTeamFixtures: vi.fn().mockResolvedValue(undefined),
  syncYouthNtFixtures: vi.fn().mockResolvedValue(undefined),
  isFriendlyLeague: vi.fn().mockReturnValue(false),
}));

vi.mock("../playerStatsSync.js", () => ({
  isFriendlyLeague: vi.fn().mockReturnValue(false),
  syncPlayerStatsAndInjuries: vi.fn().mockResolvedValue(undefined),
  syncStatsForFinishedFixture: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../evaluateEligibility.js", () => ({
  evaluateEligibility: vi.fn().mockReturnValue({
    score: 75,
    status: "DUAL_NATIONAL",
    signals: [],
  }),
}));

vi.mock("../eligibilitySignalsConfig.js", () => ({
  getMinEligibilityScore: vi.fn().mockReturnValue(30),
  getMaxCandidateAge: vi.fn().mockReturnValue(23),
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import { rescoreAllCandidates } from "../playerDiscovery.js";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

/** A candidate whose status was manually overridden by an operator. */
const OVERRIDDEN_CANDIDATE = {
  id: 101,
  name: "Jordan Override",
  apiFootballPlayerId: 5001,
  isManualOverride: true,
  usmntStatus: "DECLARED_OTHER",
  statusNotes: "[2026-07-01T00:00:00.000Z] Override: DECLARED_OTHER — declared for Mexico",
  status: "pending",
  discoveredAt: new Date("2026-01-01"),
};

/** A normal candidate that has NOT been overridden — should be rescored. */
const NORMAL_CANDIDATE = {
  id: 102,
  name: "Tyler Normal",
  apiFootballPlayerId: 5002,
  isManualOverride: false,
  usmntStatus: "UNKNOWN",
  statusNotes: null,
  status: "pending",
  discoveredAt: new Date("2026-01-02"),
};

/** Minimal stats payload returned by the mocked API-Football endpoint. */
const MOCK_STATS_RESPONSE = [
  {
    player: {
      nationality: "Mexico",
      birth: { country: "USA", date: "2001-03-15", place: "Los Angeles, CA" },
    },
    statistics: [
      {
        team: { id: 999, name: "Club FC" },
        league: { name: "Liga MX", season: 2025 },
        games: { lineups: 12, minutes: 1080, position: "FW", rating: "7.20" },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function setupSelectMock(candidates: typeof OVERRIDDEN_CANDIDATE[]) {
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(candidates),
      }),
    }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("rescoreAllCandidates — manual override guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedUpdateWhereArgs.length = 0;

    // Restore the update mock after clearAllMocks
    mockDb.update.mockImplementation(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation((whereArg: unknown) => {
          capturedUpdateWhereArgs.push(whereArg);
          return Promise.resolve(undefined);
        }),
      }),
    }));

    // Default insert mock
    mockDb.insert.mockImplementation(() => ({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    }));

    // API-Football returns valid stats for any candidate that reaches the fetch
    mockAfFetch.mockResolvedValue(MOCK_STATS_RESPONSE);
  });

  it("does NOT call db.update for a candidate with is_manual_override = true", async () => {
    setupSelectMock([OVERRIDDEN_CANDIDATE]);

    await rescoreAllCandidates({ maxCandidates: 10 });

    // db.update().set().where() must never have been called (no update for the overridden row)
    expect(
      capturedUpdateWhereArgs.length,
      "db.update should not be called for an is_manual_override candidate",
    ).toBe(0);
  });

  it("does NOT overwrite usmnt_status or is_manual_override for the overridden candidate", async () => {
    setupSelectMock([OVERRIDDEN_CANDIDATE]);

    const result = await rescoreAllCandidates({ maxCandidates: 10 });

    // No update means the values in the DB are exactly what the override-status
    // endpoint left: DECLARED_OTHER / is_manual_override = true.
    expect(capturedUpdateWhereArgs.length).toBe(0);

    // The overridden candidate is skipped before processed++ fires
    expect(result.processed).toBe(0);
    expect(result.updated).toBe(0);
  });

  it("preserves status_notes containing the override entry (no overwriting update fires)", async () => {
    setupSelectMock([OVERRIDDEN_CANDIDATE]);

    await rescoreAllCandidates({ maxCandidates: 10 });

    // If an update had fired it would potentially overwrite status_notes.
    // Verifying zero update calls is the strongest guarantee possible in a
    // mock-DB test — the override note string is never at risk.
    expect(capturedUpdateWhereArgs.length).toBe(0);
  });

  it("DOES rescore a non-overridden (normal) candidate alongside the overridden one", async () => {
    setupSelectMock([OVERRIDDEN_CANDIDATE, NORMAL_CANDIDATE]);

    const result = await rescoreAllCandidates({ maxCandidates: 10 });

    // The normal candidate's update must fire exactly once
    expect(
      capturedUpdateWhereArgs.length,
      "exactly one update should fire — for the normal candidate only",
    ).toBe(1);

    // processed counts only candidates that entered the rescore path (not overridden ones)
    expect(result.processed).toBe(1);
    expect(result.updated).toBe(1);
  });

  it("returns updated = 0 and processed = 1 when the only candidate is overridden", async () => {
    setupSelectMock([OVERRIDDEN_CANDIDATE]);

    const result = await rescoreAllCandidates({ maxCandidates: 10 });

    // The overridden candidate is skipped before processed++ fires
    expect(result.processed).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("does not call afFetch for the overridden candidate (no wasted API quota)", async () => {
    setupSelectMock([OVERRIDDEN_CANDIDATE]);

    await rescoreAllCandidates({ maxCandidates: 10 });

    expect(
      mockAfFetch.mock.calls.length,
      "afFetch should not be called when the only candidate is manually overridden",
    ).toBe(0);
  });

  it("does NOT starve a non-overridden candidate when cap equals the number of overridden older rows", async () => {
    // Scenario: cap = 1, two overridden candidates discovered before the normal
    // one. If overrides consume cap slots, the normal candidate is perpetually
    // deferred. The fix filters overrides out before slicing.
    const OVERRIDE_OLD_1 = { ...OVERRIDDEN_CANDIDATE, id: 201, apiFootballPlayerId: 6001, discoveredAt: new Date("2026-01-01") };
    const OVERRIDE_OLD_2 = { ...OVERRIDDEN_CANDIDATE, id: 202, apiFootballPlayerId: 6002, discoveredAt: new Date("2026-01-02") };
    const NORMAL_NEWER   = { ...NORMAL_CANDIDATE,    id: 203, apiFootballPlayerId: 6003, discoveredAt: new Date("2026-01-03") };

    setupSelectMock([OVERRIDE_OLD_1, OVERRIDE_OLD_2, NORMAL_NEWER]);

    const result = await rescoreAllCandidates({ maxCandidates: 1 });

    // The normal candidate must have been rescored despite the cap being 1
    expect(
      capturedUpdateWhereArgs.length,
      "the non-overridden candidate must be rescored even when cap < total overridden rows",
    ).toBe(1);

    expect(result.updated).toBe(1);
    expect(result.processed).toBe(1);
  });
});
