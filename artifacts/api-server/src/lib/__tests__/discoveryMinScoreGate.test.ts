/**
 * Integration guard: confirms that discoverUSProspects() never writes a
 * candidate to player_candidates when the player's eligibility score is
 * strictly below the resolved min-score threshold (ELIGIBILITY_MIN_SCORE).
 *
 * ## What is tested
 * 1. getMinEligibilityScore() returns the ELIGIBILITY_MIN_SCORE env-var value
 *    when set (real implementation, not mocked — ensures env-var wiring works).
 * 2. A candidate whose score < minScore is silently skipped — no DB insert.
 * 3. A candidate whose score === minScore passes the gate and IS inserted.
 * 4. When ELIGIBILITY_MIN_SCORE is raised above the default (30), a candidate
 *    that would normally pass (score=35) is now rejected.
 * 5. When ELIGIBILITY_MIN_SCORE is lowered, that same candidate is admitted.
 * 6. The env var is always cleaned up after each test.
 *
 * eligibilitySignalsConfig is PARTIALLY mocked: getMaxCandidateAge is stubbed
 * but getMinEligibilityScore and _resetWeightsCacheForTesting use the REAL
 * implementation so that env-var tests genuinely exercise process.env reading.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------

const {
  mockDb,
  tCandidates,
  tPlayers,
  tClubs,
  tEligibilitySignals,
  mockAfFetch,
  mockEvaluateEligibility,
  capturedInsertValues,
} = vi.hoisted(() => {
  const tCandidates = { _table: "player_candidates" };
  const tPlayers = { _table: "players" };
  const tClubs = { _table: "clubs" };
  const tEligibilitySignals = { _table: "eligibility_signals" };

  const capturedInsertValues: unknown[] = [];

  const mockDb = {
    select: vi.fn(),
    insert: vi.fn().mockImplementation((table: unknown) => ({
      values: vi.fn().mockImplementation((vals: unknown) => {
        if (table === tCandidates) capturedInsertValues.push(vals);
        return {
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              { id: 1, isNew: new Date() },
            ]),
          }),
        };
      }),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    })),
    delete: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
  };

  const mockEvaluateEligibility = vi.fn().mockReturnValue({
    score: 60,
    status: "US_ELIGIBLE_PROSPECT",
    signals: [],
  });

  return {
    mockDb,
    tCandidates,
    tPlayers,
    tClubs,
    tEligibilitySignals,
    mockAfFetch: vi.fn(),
    mockEvaluateEligibility,
    capturedInsertValues,
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
  eq: (_col: unknown, _val: unknown) => ({ _eq: [_col, _val] }),
  asc: (_col: unknown) => ({ _asc: _col }),
  and: (...args: unknown[]) => ({ _and: args }),
  or: (...args: unknown[]) => ({ _or: args }),
  isNull: (_col: unknown) => ({ _isNull: _col }),
  isNotNull: (_col: unknown) => ({ _isNotNull: _col }),
  desc: (_col: unknown) => ({ _desc: _col }),
  gte: (_col: unknown, _val: unknown) => ({ _gte: [_col, _val] }),
  inArray: (_col: unknown, _vals: unknown) => ({ _inArray: [_col, _vals] }),
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
  isWomensTeamName: (name: string) => /\sW$/.test(name.trim()),
  isWomensLeagueName: (league: string | null | undefined) =>
    !!league && /women|feminine|femenil|frauen|femminile|damallsvenskan|nwsl/i.test(league),
}));

vi.mock("../playerStatsSync.js", () => ({
  isFriendlyLeague: vi.fn().mockReturnValue(false),
  syncPlayerStatsAndInjuries: vi.fn().mockResolvedValue(undefined),
  syncStatsForFinishedFixture: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../evaluateEligibility.js", () => ({
  evaluateEligibility: mockEvaluateEligibility,
  detectSeniorNonUsCaps: vi.fn().mockReturnValue(false),
  countNationalTeamCaps: vi.fn().mockReturnValue({ seniorCaps: 0, youthCaps: 0 }),
}));

// Partial mock: getMaxCandidateAge is stubbed; getMinEligibilityScore and
// _resetWeightsCacheForTesting use the REAL implementation so that tests
// which set process.env["ELIGIBILITY_MIN_SCORE"] genuinely exercise the
// env-var reading path in the source module.
vi.mock("../eligibilitySignalsConfig.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../eligibilitySignalsConfig.js")>();
  return {
    ...actual,
    getMaxCandidateAge: vi.fn().mockReturnValue(23),
  };
});

// Import AFTER all mocks are registered.
import { discoverUSProspects } from "../playerDiscovery.js";
import { getMinEligibilityScore } from "../eligibilitySignalsConfig.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CLUB = { id: 1, name: "Test Club", apiFootballTeamId: 100 };

/** Stats that pass the quality gate (10 starts, 900 min). */
const PASSING_STATS = [
  {
    team: { id: 1, name: "Test Club" },
    league: { name: "Premier League", season: 2025 },
    games: { lineups: 10, minutes: 900, position: "MF", rating: "7.20" },
  },
];

function makeProfileResponse(apiId: number, name: string) {
  return [
    {
      player: {
        id: apiId,
        name,
        firstname: name.split(" ")[0] ?? null,
        age: 21,
        nationality: "USA",
        birth: { country: "USA", date: "2004-03-01", place: "Dallas, TX" },
      },
      statistics: PASSING_STATS,
    },
  ];
}

/**
 * Wire db.select for a discovery run with no pre-existing candidates.
 * Call order inside discoverUSProspects():
 *   0 → clubs
 *   1 → tracked players  (Promise.all left)
 *   2 → existing candidates (Promise.all right)
 */
function wireSelectMocks() {
  let callCount = 0;
  mockDb.select.mockImplementation(() => {
    const n = callCount++;
    let resolved: unknown;
    if (n === 0) resolved = [TEST_CLUB];
    else if (n === 1) resolved = []; // no tracked players
    else resolved = []; // no existing candidates
    return { from: vi.fn().mockResolvedValue(resolved) };
  });
}

function wireAfFetch(players: Array<{ id: number; name: string }>) {
  mockAfFetch.mockImplementation((path: string) => {
    if (path.includes("/players/squads")) {
      return Promise.resolve([{ team: { id: 100, name: "Test Club" }, players }]);
    }
    const m = path.match(/[?&]id=(\d+)/);
    if (m) {
      const apiId = parseInt(m[1]!, 10);
      const p = players.find((pl) => pl.id === apiId);
      if (p) return Promise.resolve(makeProfileResponse(apiId, p.name));
    }
    return Promise.resolve([]);
  });
}

// ---------------------------------------------------------------------------
// Per-test reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  capturedInsertValues.length = 0;

  // Restore insert mock after clearAllMocks
  mockDb.insert.mockImplementation((table: unknown) => ({
    values: vi.fn().mockImplementation((vals: unknown) => {
      if (table === tCandidates) capturedInsertValues.push(vals);
      return {
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 1, isNew: new Date() }]),
        }),
      };
    }),
  }));

  mockDb.update.mockImplementation(() => ({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  }));
});

afterEach(() => {
  delete process.env["ELIGIBILITY_MIN_SCORE"];
});

// ---------------------------------------------------------------------------
// Unit tests: real getMinEligibilityScore reads ELIGIBILITY_MIN_SCORE env var
// ---------------------------------------------------------------------------

describe("getMinEligibilityScore – env-var override (real implementation)", () => {
  afterEach(() => {
    delete process.env["ELIGIBILITY_MIN_SCORE"];
  });

  it("returns the default 30 when ELIGIBILITY_MIN_SCORE is not set", () => {
    delete process.env["ELIGIBILITY_MIN_SCORE"];
    expect(getMinEligibilityScore()).toBe(30);
  });

  it("returns the env-var value (50) when ELIGIBILITY_MIN_SCORE=50", () => {
    process.env["ELIGIBILITY_MIN_SCORE"] = "50";
    expect(getMinEligibilityScore()).toBe(50);
  });

  it("returns the env-var value (0) when ELIGIBILITY_MIN_SCORE=0", () => {
    process.env["ELIGIBILITY_MIN_SCORE"] = "0";
    expect(getMinEligibilityScore()).toBe(0);
  });

  it("falls back to default 30 when ELIGIBILITY_MIN_SCORE is non-numeric", () => {
    process.env["ELIGIBILITY_MIN_SCORE"] = "notanumber";
    expect(getMinEligibilityScore()).toBe(30);
  });

  it("falls back to default 30 when ELIGIBILITY_MIN_SCORE is negative", () => {
    process.env["ELIGIBILITY_MIN_SCORE"] = "-5";
    expect(getMinEligibilityScore()).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Integration gate: discoverUSProspects() must not write below-threshold rows
// The threshold is read from ELIGIBILITY_MIN_SCORE via the real implementation.
// ---------------------------------------------------------------------------

describe("discoverUSProspects – min-score gate enforced via ELIGIBILITY_MIN_SCORE", () => {
  it("skips DB insert when candidate score (10) is below default min-score (30)", async () => {
    // No env-var set → threshold = 30 (real implementation)
    mockEvaluateEligibility.mockReturnValue({
      score: 10,
      status: "UNKNOWN",
      signals: [{ signalType: "mls_usl_league", signalValue: null, weight: 10, source: "api_football" }],
    });

    wireSelectMocks();
    wireAfFetch([{ id: 1001, name: "Low Score Player" }]);

    const result = await discoverUSProspects();

    expect(result.skippedScore).toBe(1);
    expect(result.inserted).toBe(0);
    expect(capturedInsertValues).toHaveLength(0);
  });

  it("skips DB insert when candidate score is one below the threshold (boundary: 29 < 30)", async () => {
    mockEvaluateEligibility.mockReturnValue({
      score: 29,
      status: "UNKNOWN",
      signals: [],
    });

    wireSelectMocks();
    wireAfFetch([{ id: 2001, name: "Borderline Player" }]);

    const result = await discoverUSProspects();

    expect(result.skippedScore).toBe(1);
    expect(result.inserted).toBe(0);
    expect(capturedInsertValues).toHaveLength(0);
  });

  it("writes to DB when candidate score exactly meets the default threshold (30 === 30)", async () => {
    // score === minScore passes (gate is strict less-than: score < minScore)
    mockEvaluateEligibility.mockReturnValue({
      score: 30,
      status: "UNKNOWN",
      signals: [{ signalType: "us_birth_country", signalValue: null, weight: 25, source: "api_football" }],
    });

    wireSelectMocks();
    wireAfFetch([{ id: 3001, name: "Threshold Player" }]);

    const result = await discoverUSProspects();

    expect(result.skippedScore).toBe(0);
    expect(result.inserted).toBe(1);
    expect(capturedInsertValues).toHaveLength(1);
  });

  it("rejects a score=35 candidate when ELIGIBILITY_MIN_SCORE is raised to 40", async () => {
    // Setting env var here exercises the REAL getMinEligibilityScore path
    // inside discoverUSProspects(), not a mock return value.
    process.env["ELIGIBILITY_MIN_SCORE"] = "40";

    mockEvaluateEligibility.mockReturnValue({
      score: 35,
      status: "UNKNOWN",
      signals: [{ signalType: "us_nationality", signalValue: null, weight: 35, source: "api_football" }],
    });

    wireSelectMocks();
    wireAfFetch([{ id: 5001, name: "Nationality Only Player" }]);

    const result = await discoverUSProspects();

    expect(result.skippedScore).toBe(1);
    expect(result.inserted).toBe(0);
    expect(capturedInsertValues).toHaveLength(0);
  });

  it("admits the same score=35 candidate when ELIGIBILITY_MIN_SCORE is lowered to 30", async () => {
    process.env["ELIGIBILITY_MIN_SCORE"] = "30";

    mockEvaluateEligibility.mockReturnValue({
      score: 35,
      status: "UNKNOWN",
      signals: [{ signalType: "us_nationality", signalValue: null, weight: 35, source: "api_football" }],
    });

    wireSelectMocks();
    wireAfFetch([{ id: 6001, name: "Nationality Only Player" }]);

    const result = await discoverUSProspects();

    expect(result.skippedScore).toBe(0);
    expect(result.inserted).toBe(1);
    expect(capturedInsertValues).toHaveLength(1);
  });

  it("skips all players when every candidate scores below the threshold", async () => {
    mockEvaluateEligibility.mockReturnValue({
      score: 10,
      status: "UNKNOWN",
      signals: [{ signalType: "mls_usl_league", signalValue: null, weight: 10, source: "api_football" }],
    });

    wireSelectMocks();
    wireAfFetch([
      { id: 7001, name: "Low Score A" },
      { id: 7002, name: "Low Score B" },
    ]);

    const result = await discoverUSProspects();

    expect(result.checked).toBe(2);
    expect(result.skippedScore).toBe(2);
    expect(result.inserted).toBe(0);
    expect(capturedInsertValues).toHaveLength(0);
  });

  it("writes to DB when candidate score exceeds the threshold (60 > 30)", async () => {
    mockEvaluateEligibility.mockReturnValue({
      score: 60,
      status: "US_ELIGIBLE_PROSPECT",
      signals: [
        { signalType: "us_nationality", signalValue: null, weight: 35, source: "api_football" },
        { signalType: "us_birth_country", signalValue: null, weight: 25, source: "api_football" },
      ],
    });

    wireSelectMocks();
    wireAfFetch([{ id: 4001, name: "Strong Prospect" }]);

    const result = await discoverUSProspects();

    expect(result.skippedScore).toBe(0);
    expect(result.inserted).toBe(1);
    expect(capturedInsertValues).toHaveLength(1);
  });
});
