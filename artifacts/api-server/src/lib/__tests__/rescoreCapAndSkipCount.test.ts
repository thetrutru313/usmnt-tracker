/**
 * Regression guard: confirms that `rescoreAllCandidates` respects the
 * candidate cap, processes oldest-discovered candidates first, and returns
 * an accurate `skipped` count.
 *
 * ## What is tested
 * 1. Pool exactly at cap → skipped = 0, every candidate is processed.
 * 2. Pool below cap      → skipped = 0, every candidate is processed.
 * 3. Pool over cap       → skipped = total − cap, only the oldest `cap`
 *    candidates have db.update called; the newer (deferred) ones do not.
 * 4. `RESCORE_MAX_CANDIDATES` env var sets the cap when no options arg is given.
 * 5. `options.maxCandidates` overrides the env var.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

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
  capturedUpdateIds,
} = vi.hoisted(() => {
  const tCandidates = { _table: "player_candidates" };
  const tClubs = { _table: "clubs" };
  const tPlayers = { _table: "players" };
  const tEligibilitySignals = { _table: "eligibility_signals" };

  /**
   * Collect the `{ _eq: candidateId }` arg passed to each
   * db.update(...).set(...).where(...) call so tests can inspect which
   * candidates were actually written to.
   */
  const capturedUpdateIds: unknown[] = [];

  const mockDb = {
    select: vi.fn(),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation((whereArg: unknown) => {
          capturedUpdateIds.push(whereArg);
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
    capturedUpdateIds,
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
    score: 60,
    status: "US_ELIGIBLE_PROSPECT",
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
// Helpers
// ---------------------------------------------------------------------------

/** Minimal stats payload that satisfies the re-fetch check inside rescoreAllCandidates. */
const MOCK_STATS_RESPONSE = [
  {
    player: {
      nationality: "USA",
      birth: { country: "USA", date: "1999-05-01", place: "Denver, CO" },
    },
    statistics: [
      {
        team: { id: 1, name: "Club FC" },
        league: { name: "MLS", season: 2025 },
        games: { lineups: 20, minutes: 1800, position: "CM", rating: "7.40" },
      },
    ],
  },
];

/**
 * Build a minimal candidate record.  `discoveredAt` is used by the
 * ORDER BY asc(discoveredAt) in production; the mock just returns the array
 * in the order provided, so we rely on that ordering in tests.
 */
function makeCandidate(id: number, apiId: number, discoveredAt: Date) {
  return {
    id,
    name: `Player ${id}`,
    apiFootballPlayerId: apiId,
    isManualOverride: false,
    status: "pending" as const,
    discoveredAt,
  };
}

/**
 * Wire `mockDb.select` so that a single call to
 * `db.select(...).from(...).where(...).orderBy(...)` resolves with `rows`.
 */
function setupSelectMock(rows: ReturnType<typeof makeCandidate>[]) {
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(rows),
      }),
    }),
  });
}

// ---------------------------------------------------------------------------
// Per-test reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  capturedUpdateIds.length = 0;

  // Re-wire update mock (clearAllMocks resets implementations)
  mockDb.update.mockImplementation(() => ({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation((whereArg: unknown) => {
        capturedUpdateIds.push(whereArg);
        return Promise.resolve(undefined);
      }),
    }),
  }));

  mockDb.insert.mockImplementation(() => ({
    values: vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    }),
  }));

  mockAfFetch.mockResolvedValue(MOCK_STATS_RESPONSE);
});

afterEach(() => {
  delete process.env["RESCORE_MAX_CANDIDATES"];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("rescoreAllCandidates — cap and skipped count", () => {
  // -------------------------------------------------------------------------
  // Scenario 1: pool exactly at cap
  // -------------------------------------------------------------------------
  it("processes all candidates and returns skipped = 0 when pool equals cap", async () => {
    const candidates = [
      makeCandidate(1, 101, new Date("2026-01-01")),
      makeCandidate(2, 102, new Date("2026-01-02")),
      makeCandidate(3, 103, new Date("2026-01-03")),
    ];
    setupSelectMock(candidates);

    const result = await rescoreAllCandidates({ maxCandidates: 3 });

    expect(result.skipped).toBe(0);
    expect(result.processed).toBe(3);
    expect(capturedUpdateIds).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // Scenario 2: pool below cap
  // -------------------------------------------------------------------------
  it("processes all candidates and returns skipped = 0 when pool is smaller than cap", async () => {
    const candidates = [
      makeCandidate(10, 201, new Date("2026-02-01")),
      makeCandidate(11, 202, new Date("2026-02-02")),
    ];
    setupSelectMock(candidates);

    const result = await rescoreAllCandidates({ maxCandidates: 100 });

    expect(result.skipped).toBe(0);
    expect(result.processed).toBe(2);
    expect(capturedUpdateIds).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // Scenario 3: pool over cap — correct skipped count
  // -------------------------------------------------------------------------
  it("returns skipped = total − cap when pool exceeds cap", async () => {
    const candidates = [
      makeCandidate(20, 301, new Date("2026-03-01")),
      makeCandidate(21, 302, new Date("2026-03-02")),
      makeCandidate(22, 303, new Date("2026-03-03")),
      makeCandidate(23, 304, new Date("2026-03-04")),
      makeCandidate(24, 305, new Date("2026-03-05")),
    ];
    setupSelectMock(candidates);

    const result = await rescoreAllCandidates({ maxCandidates: 3 });

    expect(result.skipped).toBe(2); // 5 − 3 = 2
    expect(result.processed).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Scenario 4: oldest candidates are processed, newer ones deferred
  // -------------------------------------------------------------------------
  it("processes the oldest candidates first and defers the newer ones when capped", async () => {
    // The mock returns rows in discoveredAt order (oldest first), matching
    // the ORDER BY asc(discoveredAt) in production.
    const oldest = makeCandidate(30, 401, new Date("2026-01-01"));
    const middle = makeCandidate(31, 402, new Date("2026-02-01"));
    const newest = makeCandidate(32, 403, new Date("2026-03-01"));
    setupSelectMock([oldest, middle, newest]);

    await rescoreAllCandidates({ maxCandidates: 2 });

    // db.update is called with eq(id, candidateId) — our mock captures
    // the { _eq: id } sentinel; verify the two oldest were updated.
    const updatedIds = capturedUpdateIds.map((arg) => (arg as { _eq: number })._eq);
    expect(updatedIds).toContain(30);
    expect(updatedIds).toContain(31);
    expect(updatedIds).not.toContain(32); // newest deferred
    expect(capturedUpdateIds).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // Scenario 5: RESCORE_MAX_CANDIDATES env var is respected
  // -------------------------------------------------------------------------
  it("respects RESCORE_MAX_CANDIDATES env var when no options arg is provided", async () => {
    process.env["RESCORE_MAX_CANDIDATES"] = "2";

    const candidates = [
      makeCandidate(40, 501, new Date("2026-04-01")),
      makeCandidate(41, 502, new Date("2026-04-02")),
      makeCandidate(42, 503, new Date("2026-04-03")),
    ];
    setupSelectMock(candidates);

    // Call with NO options arg so the env var drives the cap
    const result = await rescoreAllCandidates();

    expect(result.skipped).toBe(1); // 3 − 2 = 1
    expect(result.processed).toBe(2);
    expect(capturedUpdateIds).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // Scenario 6: options.maxCandidates overrides the env var
  // -------------------------------------------------------------------------
  it("options.maxCandidates overrides RESCORE_MAX_CANDIDATES env var", async () => {
    process.env["RESCORE_MAX_CANDIDATES"] = "1"; // would allow only 1 if respected

    const candidates = [
      makeCandidate(50, 601, new Date("2026-05-01")),
      makeCandidate(51, 602, new Date("2026-05-02")),
      makeCandidate(52, 603, new Date("2026-05-03")),
      makeCandidate(53, 604, new Date("2026-05-04")),
    ];
    setupSelectMock(candidates);

    // Explicit options override should allow 3
    const result = await rescoreAllCandidates({ maxCandidates: 3 });

    expect(result.skipped).toBe(1); // 4 − 3 = 1, not 4 − 1 = 3
    expect(result.processed).toBe(3);
    expect(capturedUpdateIds).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // Scenario 7: DB update is NOT called for deferred candidates
  // -------------------------------------------------------------------------
  it("does not call db.update for deferred (over-cap) candidates", async () => {
    const processed1 = makeCandidate(60, 701, new Date("2026-06-01"));
    const deferred1  = makeCandidate(61, 702, new Date("2026-06-02"));
    const deferred2  = makeCandidate(62, 703, new Date("2026-06-03"));
    setupSelectMock([processed1, deferred1, deferred2]);

    await rescoreAllCandidates({ maxCandidates: 1 });

    const updatedIds = capturedUpdateIds.map((arg) => (arg as { _eq: number })._eq);
    expect(updatedIds).not.toContain(61);
    expect(updatedIds).not.toContain(62);
    expect(capturedUpdateIds).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Scenario 8: empty pool — skipped = 0, processed = 0
  // -------------------------------------------------------------------------
  it("returns all zeros when the candidate pool is empty", async () => {
    setupSelectMock([]);

    const result = await rescoreAllCandidates({ maxCandidates: 10 });

    expect(result.skipped).toBe(0);
    expect(result.processed).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.failed).toBe(0);
    expect(capturedUpdateIds).toHaveLength(0);
  });
});
