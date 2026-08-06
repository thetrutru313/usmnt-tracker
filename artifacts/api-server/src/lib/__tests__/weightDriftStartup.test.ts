/**
 * Regression guard: confirms that `checkAndApplyWeightDrift` triggers a
 * rescore when the stored weight fingerprint differs from the current one,
 * and skips the rescore when the fingerprint is unchanged.
 *
 * Also confirms that `rescoreCandidatesFromStoredSignals` correctly:
 *   - demotes a pending candidate whose new score drops below the threshold
 *   - surfaces a dismissed candidate whose new score rises above the threshold
 *   - leaves a promoted candidate's status untouched
 *   - skips manually-overridden candidates
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared mock state — vi.hoisted so factories run before vi.mock calls
// ---------------------------------------------------------------------------

const {
  mockDb,
  tCandidates,
  tEligibilitySignals,
  tServerConfig,
  capturedUpdates,
  capturedInserts,
} = vi.hoisted(() => {
  const tCandidates = { _table: "player_candidates" };
  const tEligibilitySignals = { _table: "eligibility_signals" };
  const tServerConfig = { _table: "server_config", key: "key_col" };

  const capturedUpdates: Array<{ set: unknown; where: unknown }> = [];
  const capturedInserts: Array<{ values: unknown }> = [];

  const mockDb = {
    select: vi.fn(),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((setArg: unknown) => ({
        where: vi.fn().mockImplementation((whereArg: unknown) => {
          capturedUpdates.push({ set: setArg, where: whereArg });
          return Promise.resolve(undefined);
        }),
      })),
    })),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((vals: unknown) => {
        capturedInserts.push({ values: vals });
        return {
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        };
      }),
    })),
  };

  return { mockDb, tCandidates, tEligibilitySignals, tServerConfig, capturedUpdates, capturedInserts };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: mockDb,
  playerCandidatesTable: tCandidates,
  eligibilitySignalsTable: tEligibilitySignals,
  serverConfigTable: tServerConfig,
  clubsTable: { _table: "clubs" },
  playersTable: { _table: "players" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, val: unknown) => ({ _eq: val }),
  and: (...args: unknown[]) => ({ _and: args }),
  or: (...args: unknown[]) => ({ _or: args }),
  asc: (_col: unknown) => ({ _asc: _col }),
  isNull: (_col: unknown) => ({ _isNull: _col }),
  isNotNull: (_col: unknown) => ({ _isNotNull: _col }),
  ne: (_col: unknown, val: unknown) => ({ _ne: val }),
  inArray: (_col: unknown, vals: unknown) => ({ _inArray: vals }),
  sql: Object.assign(
    (_strings: TemplateStringsArray, ..._values: unknown[]) => ({ _sql: true }),
    { raw: (_val: string) => ({ _sqlRaw: _val }) },
  ),
}));

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../apiFootballSync.js", () => ({
  afFetch: vi.fn().mockResolvedValue([]),
  apiKey: vi.fn().mockReturnValue("test-key"),
  syncApiFootballFixtures: vi.fn().mockResolvedValue(undefined),
  syncNationalTeamFixtures: vi.fn().mockResolvedValue(undefined),
  syncYouthNtFixtures: vi.fn().mockResolvedValue(undefined),
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

// We keep eligibilitySignalsConfig mostly real so getWeightFingerprint() works,
// but we stub getMinEligibilityScore so tests control the threshold.
vi.mock("../eligibilitySignalsConfig.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../eligibilitySignalsConfig.js")>();
  return {
    ...actual,
    getMinEligibilityScore: vi.fn().mockReturnValue(30),
    getMaxCandidateAge: vi.fn().mockReturnValue(23),
  };
});

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------

import { checkAndApplyWeightDrift, rescoreCandidatesFromStoredSignals } from "../playerDiscovery.js";


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wire mockDb.select to return different values on successive calls.
 * Each element of `returnValues` is what one .select() chain resolves to.
 */
function _setupSelectSequence(returnValues: unknown[]) {
  let callIndex = 0;
  mockDb.select.mockImplementation(() => {
    const value = returnValues[callIndex++] ?? [];
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue(value),
          // Some select chains don't have orderBy
          then: (resolve: (v: unknown) => unknown) => Promise.resolve(value).then(resolve),
        }),
        // For select().from() without a where() — used by the signals fetch
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(value).then(resolve),
      }),
    };
  });
}

/**
 * Wire mockDb.select so that each call returns its value directly regardless
 * of whether the chain ends in .where(), .orderBy(), or nothing.
 */
function setupFlexibleSelectSequence(returnValues: unknown[]) {
  let callIndex = 0;
  mockDb.select.mockImplementation(() => {
    const value = returnValues[callIndex++] ?? [];
    const terminal = vi.fn().mockResolvedValue(value);
    const withOrderBy = { orderBy: terminal };
    const withWhere = { where: vi.fn().mockReturnValue({ ...withOrderBy, ...makeTerminal(value) }) };
    const withFrom = {
      from: vi.fn().mockReturnValue({
        ...withWhere,
        ...makeTerminal(value),
      }),
    };
    return withFrom;
  });
}

function makeTerminal(value: unknown) {
  // Make the object thenable so Drizzle's select().from() (without where) also resolves.
  return {
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(value).then(resolve, reject),
  };
}

// ---------------------------------------------------------------------------
// Per-test reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  capturedUpdates.length = 0;
  capturedInserts.length = 0;

  // Re-wire update/insert after clearAllMocks
  mockDb.update.mockImplementation(() => ({
    set: vi.fn().mockImplementation((setArg: unknown) => ({
      where: vi.fn().mockImplementation((whereArg: unknown) => {
        capturedUpdates.push({ set: setArg, where: whereArg });
        return Promise.resolve(undefined);
      }),
    })),
  }));

  mockDb.insert.mockImplementation(() => ({
    values: vi.fn().mockImplementation((vals: unknown) => {
      capturedInserts.push({ values: vals });
      return { onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) };
    }),
  }));
});

// ---------------------------------------------------------------------------
// rescoreCandidatesFromStoredSignals — unit tests
// ---------------------------------------------------------------------------

describe("rescoreCandidatesFromStoredSignals", () => {
  it("demotes a pending candidate when new score drops below the min threshold", async () => {
    // Candidate has signal us_nationality (weight=35) but minScore is 30.
    // If we lower the weight to 0 the score becomes 0 → should be dismissed.
    // We simulate that by having a candidate with no fired signals → score = 0.
    const candidates = [
      { id: 1, name: "Player A", status: "pending", isManualOverride: false },
    ];
    // No signals fired → computed score = 0, which is below minScore (30)
    const signals: Array<{ candidateId: number; signalType: string }> = [];

    setupFlexibleSelectSequence([candidates, signals]);

    const result = await rescoreCandidatesFromStoredSignals();

    expect(result.demoted).toBe(1);
    expect(result.surfaced).toBe(0);
    expect(result.processed).toBe(1);

    // Verify the update set status to "dismissed"
    const update = capturedUpdates.find(
      (u) => (u.set as Record<string, unknown>).status === "dismissed",
    );
    expect(update).toBeDefined();
  });

  it("surfaces a dismissed candidate when new score rises above the min threshold", async () => {
    const candidates = [
      { id: 2, name: "Player B", status: "dismissed", isManualOverride: false },
    ];
    // Signal us_nationality fires with weight 35 (default) → score = 35 ≥ 30
    const signals = [{ candidateId: 2, signalType: "us_nationality" }];

    setupFlexibleSelectSequence([candidates, signals]);

    const result = await rescoreCandidatesFromStoredSignals();

    expect(result.surfaced).toBe(1);
    expect(result.demoted).toBe(0);

    // Verify the update sets status to "pending" and needsReview to true
    const update = capturedUpdates.find(
      (u) =>
        (u.set as Record<string, unknown>).status === "pending" &&
        (u.set as Record<string, unknown>).needsReview === true,
    );
    expect(update).toBeDefined();
  });

  it("does not change status of a promoted candidate even when score drops", async () => {
    const candidates = [
      { id: 3, name: "Player C", status: "promoted", isManualOverride: false },
    ];
    const signals: Array<{ candidateId: number; signalType: string }> = [];
    // No signals → score = 0 (below threshold)

    setupFlexibleSelectSequence([candidates, signals]);

    const result = await rescoreCandidatesFromStoredSignals();

    expect(result.demoted).toBe(0);
    expect(result.surfaced).toBe(0);

    // Status must NOT appear in any update
    for (const u of capturedUpdates) {
      const s = u.set as Record<string, unknown>;
      expect(s.status).toBeUndefined();
    }
  });

  it("skips manually-overridden candidates", async () => {
    // isManualOverride = true candidates are excluded by the WHERE clause;
    // the mock just returns an empty array to simulate that.
    setupFlexibleSelectSequence([[], []]);

    const result = await rescoreCandidatesFromStoredSignals();

    expect(result.processed).toBe(0);
    expect(capturedUpdates).toHaveLength(0);
  });

  it("accumulates score correctly across multiple fired signals", async () => {
    // us_nationality (35) + us_birth_country (25) = 60 ≥ 30 — should stay pending
    const candidates = [
      { id: 4, name: "Player D", status: "pending", isManualOverride: false },
    ];
    const signals = [
      { candidateId: 4, signalType: "us_nationality" },
      { candidateId: 4, signalType: "us_birth_country" },
    ];

    setupFlexibleSelectSequence([candidates, signals]);

    const result = await rescoreCandidatesFromStoredSignals();

    expect(result.demoted).toBe(0);

    // Score should be 35 + 25 = 60
    const update = capturedUpdates[0];
    expect((update?.set as Record<string, unknown>).eligibilityConfidence).toBe(60);
  });

  it("clamps score at 100 when signals would sum higher", async () => {
    const candidates = [
      { id: 5, name: "Player E", status: "pending", isManualOverride: false },
    ];
    // All six signals fire; default weights sum to 120 but should be clamped to 100
    const signals = [
      { candidateId: 5, signalType: "us_nationality" },       // 35
      { candidateId: 5, signalType: "us_birth_country" },     // 25
      { candidateId: 5, signalType: "us_state_birthplace" },  // 15
      { candidateId: 5, signalType: "us_youth_nt" },          // 15
      { candidateId: 5, signalType: "us_senior_nt_cap" },     // 20
      { candidateId: 5, signalType: "mls_usl_league" },       // 10
    ];

    setupFlexibleSelectSequence([candidates, signals]);

    await rescoreCandidatesFromStoredSignals();

    const update = capturedUpdates[0];
    expect((update?.set as Record<string, unknown>).eligibilityConfidence).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// checkAndApplyWeightDrift — unit tests
// ---------------------------------------------------------------------------

describe("checkAndApplyWeightDrift", () => {
  it("saves a baseline fingerprint on first run (no stored fingerprint) and does not rescore", async () => {
    // Simulate: no row in server_config, candidates exist but should NOT be rescored
    const candidates = [
      { id: 10, name: "Player X", status: "pending", isManualOverride: false },
    ];
    const signals: Array<{ candidateId: number; signalType: string }> = [
      { candidateId: 10, signalType: "us_nationality" },
    ];

    // First select() = server_config lookup → empty (no stored fingerprint)
    // Subsequent selects = candidates + signals (for rescoreCandidatesFromStoredSignals)
    setupFlexibleSelectSequence([[], candidates, signals]);

    await checkAndApplyWeightDrift();

    // No status-changing updates expected (no rescore on first run)
    const statusUpdates = capturedUpdates.filter(
      (u) => (u.set as Record<string, unknown>).status !== undefined,
    );
    expect(statusUpdates).toHaveLength(0);

    // A fingerprint should have been inserted/upserted
    expect(capturedInserts.length).toBeGreaterThanOrEqual(1);
  });

  it("skips rescore when stored fingerprint matches current weights", async () => {
    const { getWeightFingerprint } = await import("../eligibilitySignalsConfig.js");
    const currentFp = getWeightFingerprint();

    // server_config returns the current fingerprint
    setupFlexibleSelectSequence([[{ value: currentFp }]]);

    await checkAndApplyWeightDrift();

    // No updates or inserts — fingerprints match
    expect(capturedUpdates).toHaveLength(0);
    expect(capturedInserts).toHaveLength(0);
  });

  it("triggers rescore and saves new fingerprint when stored fingerprint differs", async () => {
    const staleFingerprint = JSON.stringify({ weights: { us_nationality: 99 }, minScore: 30 });

    // Calls in order:
    // 1. server_config lookup → stale fingerprint
    // 2. rescoreCandidatesFromStoredSignals: candidates select
    // 3. rescoreCandidatesFromStoredSignals: signals select
    const candidates = [
      { id: 20, name: "Player Y", status: "pending", isManualOverride: false },
    ];
    const signals: Array<{ candidateId: number; signalType: string }> = [];

    setupFlexibleSelectSequence([[{ value: staleFingerprint }], candidates, signals]);

    await checkAndApplyWeightDrift();

    // A rescore must have run — db.update called for candidate 20
    expect(capturedUpdates.length).toBeGreaterThanOrEqual(1);

    // New fingerprint must be persisted
    expect(capturedInserts.length).toBeGreaterThanOrEqual(1);
  });
});
