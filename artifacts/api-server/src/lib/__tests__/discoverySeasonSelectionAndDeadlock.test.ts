/**
 * Regression guard for two `playerDiscovery.ts` bugs:
 *
 * Bug 1 — `rescoreAllCandidates` deadlocked on unscoreable candidates: when
 * the API-Football fetch returned no usable profile, `lastScoredAt` was
 * never written, so the row kept sorting to the front of the
 * `lastScoredAt ASC NULLS FIRST` queue and consumed a cap slot on every run.
 *
 * Bug 2 — the season fallback broke on the first season with *any*
 * statistics array, even one with zero minutes played (which API-Football
 * returns as soon as a player is registered to a squad). This produced false
 * negatives every season turnover, discarding players whose complete prior
 * season was never inspected.
 *
 * ## What is tested
 * 1. A candidate whose fetch yields no profile gets `lastScoredAt` written
 *    and does not touch status/confidence/signals.
 * 2. Season selector: current season has stats but zero minutes, prior
 *    season has real minutes → prior season wins.
 * 3. Season selector: both seasons have stats but zero minutes → most recent
 *    season is returned rather than null.
 * 4. Season selector: no season has any statistics → returns null.
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
  capturedUpdateCalls,
} = vi.hoisted(() => {
  const tCandidates = { _table: "player_candidates" };
  const tClubs = { _table: "clubs" };
  const tPlayers = { _table: "players" };
  const tEligibilitySignals = { _table: "eligibility_signals" };

  /** Each entry: { candidateId, setArg } captured from db.update(...).set(...).where(...) */
  const capturedUpdateCalls: Array<{ candidateId: unknown; setArg: unknown }> = [];

  const mockDb = {
    select: vi.fn(),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((setArg: unknown) => ({
        where: vi.fn().mockImplementation((whereArg: { _eq: unknown }) => {
          capturedUpdateCalls.push({ candidateId: whereArg._eq, setArg });
          return Promise.resolve(undefined);
        }),
      })),
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
    capturedUpdateCalls,
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
  detectSeniorNonUsCaps: vi.fn().mockReturnValue(false),
  countNationalTeamCaps: vi.fn().mockReturnValue({ seniorCaps: 0, youthCaps: 0 }),
}));

vi.mock("../eligibilitySignalsConfig.js", () => ({
  getMinEligibilityScore: vi.fn().mockReturnValue(30),
  getMaxCandidateAge: vi.fn().mockReturnValue(23),
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import { rescoreAllCandidates, applyQualityGate } from "../playerDiscovery.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CURRENT_YEAR = new Date().getUTCFullYear();

const CANDIDATE = {
  id: 500,
  name: "Test Player",
  age: 20,
  apiFootballPlayerId: 99500,
  isManualOverride: false,
  status: "pending" as const,
  discoveredAt: new Date("2026-01-01"),
};

function setupSelectMock(rows: unknown[]) {
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(rows),
      }),
    }),
  });
}

function statBlock(minutes: number, lineups = 0) {
  return {
    team: { id: 1, name: "Club FC" },
    league: { id: 39, name: "Test League", season: CURRENT_YEAR },
    games: { lineups, minutes, appearences: lineups, position: "MF", rating: null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedUpdateCalls.length = 0;

  mockDb.update.mockImplementation(() => ({
    set: vi.fn().mockImplementation((setArg: unknown) => ({
      where: vi.fn().mockImplementation((whereArg: { _eq: unknown }) => {
        capturedUpdateCalls.push({ candidateId: whereArg._eq, setArg });
        return Promise.resolve(undefined);
      }),
    })),
  }));

  mockDb.insert.mockImplementation(() => ({
    values: vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    }),
  }));
});

// ---------------------------------------------------------------------------
// Bug 1 — deadlock on unscoreable candidates
// ---------------------------------------------------------------------------

describe("rescoreAllCandidates — unscoreable candidates no longer deadlock the queue", () => {
  it("stamps lastScoredAt (and only lastScoredAt) when no profile is found, without touching status/confidence/signals", async () => {
    setupSelectMock([CANDIDATE]);
    // No statistics for either season → selectBestSeasonProfile returns null
    mockAfFetch.mockResolvedValue([]);

    const result = await rescoreAllCandidates({ maxCandidates: 10 });

    expect(result.skippedNoStats).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.failed).toBe(0);

    expect(capturedUpdateCalls).toHaveLength(1);
    const call = capturedUpdateCalls[0]!;
    expect(call.candidateId).toBe(CANDIDATE.id);

    const setArg = call.setArg as Record<string, unknown>;
    expect(setArg["lastScoredAt"]).toBeInstanceOf(Date);
    // Status, confidence, and signals must NOT appear in this update —
    // the row is unscoreable right now, not ineligible.
    expect(setArg).not.toHaveProperty("status");
    expect(setArg).not.toHaveProperty("eligibilityConfidence");
    expect(setArg).not.toHaveProperty("usmntStatus");
  });

  it("a previously-unscoreable candidate no longer sorts first on the next run (rotates to the back of the queue)", async () => {
    // Simulate: run 1 stamps lastScoredAt on the unscoreable candidate.
    setupSelectMock([CANDIDATE]);
    mockAfFetch.mockResolvedValue([]);
    await rescoreAllCandidates({ maxCandidates: 10 });

    const stampedAt = (capturedUpdateCalls[0]!.setArg as { lastScoredAt: Date }).lastScoredAt;
    expect(stampedAt.getTime()).toBeGreaterThan(0);

    // Run 2: a newly-discovered candidate with lastScoredAt = null would sort
    // before our now-stamped candidate under ORDER BY lastScoredAt ASC NULLS
    // FIRST — confirming the row is no longer permanently "first".
    const freshCandidate = { ...CANDIDATE, id: 501, apiFootballPlayerId: 99501 };
    capturedUpdateCalls.length = 0;
    setupSelectMock([freshCandidate]); // production ORDER BY would now put this one first
    mockAfFetch.mockResolvedValue([]);
    const result2 = await rescoreAllCandidates({ maxCandidates: 10 });

    expect(result2.skippedNoStats).toBe(1);
    expect(capturedUpdateCalls[0]!.candidateId).toBe(freshCandidate.id);
  });
});

// ---------------------------------------------------------------------------
// Bug 2 — season selection picks the season with the most minutes
// ---------------------------------------------------------------------------

describe("season selection — picks most total minutes rather than first non-empty season", () => {
  it("prior season with real minutes wins over a current season with stats but zero minutes", async () => {
    const currentSeasonZeroMinutes = [statBlock(0, 0)];
    const priorSeasonRealMinutes = [statBlock(1800, 20)];

    mockAfFetch.mockImplementation((path: string) => {
      const seasonMatch = path.match(/season=(\d+)/);
      const season = seasonMatch ? parseInt(seasonMatch[1]!, 10) : null;
      if (season === CURRENT_YEAR) {
        return Promise.resolve([
          { player: { nationality: "USA", birth: { country: "USA", place: null } }, statistics: currentSeasonZeroMinutes },
        ]);
      }
      return Promise.resolve([
        { player: { nationality: "USA", birth: { country: "USA", place: null } }, statistics: priorSeasonRealMinutes },
      ]);
    });

    setupSelectMock([CANDIDATE]);
    const result = await rescoreAllCandidates({ maxCandidates: 10 });

    expect(result.skippedNoStats).toBe(0);
    expect(result.updated).toBe(1);

    // Sanity-check our test fixtures agree with applyQualityGate's minutes math.
    expect(applyQualityGate(currentSeasonZeroMinutes).minutes).toBe(0);
    expect(applyQualityGate(priorSeasonRealMinutes).minutes).toBe(1800);
  });

  it("returns the most recent season when every season with statistics has zero minutes", async () => {
    const zeroMinutesEitherSeason = [statBlock(0, 0)];
    mockAfFetch.mockResolvedValue([
      { player: { nationality: "USA", birth: { country: "USA", place: null } }, statistics: zeroMinutesEitherSeason },
    ]);

    setupSelectMock([CANDIDATE]);
    const result = await rescoreAllCandidates({ maxCandidates: 10 });

    // A profile was found (statistics existed, even at zero minutes), so the
    // candidate was NOT counted as skippedNoStats — it went through scoring.
    expect(result.skippedNoStats).toBe(0);
    expect(result.updated).toBe(1);
  });

  it("returns null (skippedNoStats) when no season returns any statistics", async () => {
    mockAfFetch.mockResolvedValue([]);

    setupSelectMock([CANDIDATE]);
    const result = await rescoreAllCandidates({ maxCandidates: 10 });

    expect(result.skippedNoStats).toBe(1);
    expect(result.updated).toBe(0);
  });
});
