/**
 * Regression guard: confirms that `backfillCandidateBirthplaces` correctly
 * writes US-state birthplace data from API-Football, and that a subsequent
 * `rescoreAllCandidates` run picks up and persists the `us_state_birthplace`
 * eligibility signal.
 *
 * ## What is tested
 *
 * Part 1 — birthplace backfill (`backfillCandidateBirthplaces`):
 *   1. When API-Football returns a US-state birthplace for a candidate that has
 *      no birthplace in the DB, `db.update` is called with that birthplace value.
 *   2. When API-Football returns no birthplace for any season, `db.update` is
 *      NOT called and the count is tracked as `notFound`.
 *   3. When `afFetch` throws, the candidate counts as `failed` and the loop
 *      continues to process the remaining candidates.
 *   4. Multiple candidates are each processed independently; only the ones with
 *      a returned birthplace are written to the DB.
 *
 * Part 2 — rescore fires `us_state_birthplace` signal:
 *   5. When `rescoreAllCandidates` fetches a profile whose `birth.place` is
 *      "Houston, Texas", the real `evaluateEligibility` fires the
 *      `us_state_birthplace` signal and `persistSignals` writes it to
 *      `eligibility_signals` via `db.insert`.
 *   6. When `birth.place` is a non-US city ("Berlin"), the `us_state_birthplace`
 *      signal is NOT inserted into `eligibility_signals`.
 *   7. When `birth.place` is null, the `us_state_birthplace` signal is NOT
 *      inserted.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { _resetWeightsCacheForTesting } from "../eligibilitySignalsConfig";

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
  capturedUpdateSets,
  capturedInsertValues,
} = vi.hoisted(() => {
  const tCandidates = { _table: "player_candidates" };
  const tClubs = { _table: "clubs" };
  const tPlayers = { _table: "players" };
  const tEligibilitySignals = { _table: "eligibility_signals" };

  /** All { birthplace } payloads passed to db.update().set() */
  const capturedUpdateSets: unknown[] = [];

  /** All value objects passed to db.insert().values() */
  const capturedInsertValues: unknown[] = [];

  const mockDb = {
    select: vi.fn(),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((setArg: unknown) => {
        capturedUpdateSets.push(setArg);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((vals: unknown) => {
        capturedInsertValues.push(vals);
        return { onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) };
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
    capturedUpdateSets,
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
  eq: (_col: unknown, val: unknown) => ({ _eq: val }),
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
}));

vi.mock("../playerStatsSync.js", () => ({
  isFriendlyLeague: vi.fn().mockReturnValue(false),
  syncPlayerStatsAndInjuries: vi.fn().mockResolvedValue(undefined),
  syncStatsForFinishedFixture: vi.fn().mockResolvedValue(undefined),
}));

// NOTE: evaluateEligibility is intentionally NOT mocked so the real signal
// detection logic runs — that's exactly what this test is verifying.

vi.mock("../eligibilitySignalsConfig.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../eligibilitySignalsConfig")>();
  return {
    ...real,
    // Keep the real SIGNAL_REGISTRY and getResolvedWeights.
    // Lower the minimum score to 0 so every candidate is stored regardless
    // of how many signals fire — we are testing signal presence, not dismissal.
    getMinEligibilityScore: vi.fn().mockReturnValue(0),
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  backfillCandidateBirthplaces,
  rescoreAllCandidates,
} from "../playerDiscovery.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wire mockDb.select to return `rows` from a single chain call. */
function setupSelectMock(rows: unknown[]) {
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(rows),
      }),
    }),
  });
}

/** Wire mockDb.select to return `rows` from a chain that ends in `.where()`
 *  (no `.orderBy()`), used by backfillCandidateBirthplaces. */
function setupSelectWhereOnly(rows: unknown[]) {
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  });
}

/** Minimal API-Football stats response used to pass the re-fetch guard inside
 *  rescoreAllCandidates (statistics must be non-empty). */
function makeStatsResponse(birthplace: string | null, birthCountry = "Germany", nationality = "Germany") {
  return [
    {
      player: {
        nationality,
        birth: { country: birthCountry, date: "2001-06-15", place: birthplace },
      },
      statistics: [
        {
          team: { id: 9, name: "TSG Hoffenheim" },
          league: { name: "Bundesliga", season: 2025 },
          games: { lineups: 22, minutes: 1980, position: "MF", rating: "7.10" },
        },
      ],
    },
  ];
}

/** Minimal API-Football /players response used in backfill tests. */
function makeBirthplaceResponse(birthplace: string | null) {
  return [{ player: { birth: { place: birthplace } } }];
}

// ---------------------------------------------------------------------------
// Per-test reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  capturedUpdateSets.length = 0;
  capturedInsertValues.length = 0;
  _resetWeightsCacheForTesting();

  // Restore mock implementations cleared by vi.clearAllMocks()
  mockDb.update.mockImplementation(() => ({
    set: vi.fn().mockImplementation((setArg: unknown) => {
      capturedUpdateSets.push(setArg);
      return { where: vi.fn().mockResolvedValue(undefined) };
    }),
  }));

  mockDb.insert.mockImplementation(() => ({
    values: vi.fn().mockImplementation((vals: unknown) => {
      capturedInsertValues.push(vals);
      return { onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) };
    }),
  }));

  mockDb.delete.mockImplementation(() => ({
    where: vi.fn().mockResolvedValue(undefined),
  }));
});

afterEach(() => {
  _resetWeightsCacheForTesting();
});

// ===========================================================================
// Part 1 — backfillCandidateBirthplaces
// ===========================================================================

describe("backfillCandidateBirthplaces — birthplace write", () => {
  // -------------------------------------------------------------------------
  // Scenario 1: API returns a US-state birthplace → db.update fires
  // -------------------------------------------------------------------------
  it("writes a US-state birthplace to the DB when API-Football returns one", async () => {
    const candidate = { id: 1, name: "Tyler US", apiFootballPlayerId: 1001 };
    setupSelectWhereOnly([candidate]);

    mockAfFetch.mockResolvedValue(makeBirthplaceResponse("Houston, Texas"));

    const result = await backfillCandidateBirthplaces({ seasons: [2025] });

    expect(result.updated).toBe(1);
    expect(result.notFound).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(1);

    // db.update must have been called with the correct birthplace
    const sets = capturedUpdateSets as Array<{ birthplace?: unknown }>;
    expect(sets.some((s) => s.birthplace === "Houston, Texas")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Scenario 2: API returns null birthplace → db.update NOT called
  // -------------------------------------------------------------------------
  it("does NOT call db.update when API-Football returns no birthplace for any season", async () => {
    const candidate = { id: 2, name: "Unknown Place", apiFootballPlayerId: 2002 };
    setupSelectWhereOnly([candidate]);

    mockAfFetch.mockResolvedValue(makeBirthplaceResponse(null));

    const result = await backfillCandidateBirthplaces({ seasons: [2025] });

    expect(result.updated).toBe(0);
    expect(result.notFound).toBe(1);

    const sets = capturedUpdateSets as Array<{ birthplace?: unknown }>;
    expect(sets.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Scenario 3: afFetch throws → failed count increments, loop continues
  // -------------------------------------------------------------------------
  it("counts a failed candidate and continues when afFetch throws", async () => {
    const bad = { id: 3, name: "Fetch Error", apiFootballPlayerId: 3003 };
    const good = { id: 4, name: "Portland Joe", apiFootballPlayerId: 4004 };
    setupSelectWhereOnly([bad, good]);

    mockAfFetch
      .mockRejectedValueOnce(new Error("API timeout"))
      .mockResolvedValueOnce(makeBirthplaceResponse("Portland, Oregon"));

    const result = await backfillCandidateBirthplaces({ seasons: [2025] });

    expect(result.failed).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.total).toBe(2);

    // Only the second candidate's birthplace should be written
    const sets = capturedUpdateSets as Array<{ birthplace?: unknown }>;
    expect(sets.some((s) => s.birthplace === "Portland, Oregon")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Scenario 4: multiple candidates, each processed independently
  // -------------------------------------------------------------------------
  it("processes all candidates: writes birthplace for each one that has a result", async () => {
    const c1 = { id: 10, name: "Alex Chicago", apiFootballPlayerId: 10001 };
    const c2 = { id: 11, name: "Berlin Born",  apiFootballPlayerId: 10002 };
    const c3 = { id: 12, name: "Dallas Kid",   apiFootballPlayerId: 10003 };
    setupSelectWhereOnly([c1, c2, c3]);

    mockAfFetch
      .mockResolvedValueOnce(makeBirthplaceResponse("Chicago, Illinois"))
      .mockResolvedValueOnce(makeBirthplaceResponse("Berlin"))
      .mockResolvedValueOnce(makeBirthplaceResponse("Dallas, Texas"));

    const result = await backfillCandidateBirthplaces({ seasons: [2025] });

    // All three returned a birthplace (even non-US — backfill doesn't filter)
    expect(result.updated).toBe(3);
    expect(result.notFound).toBe(0);
    expect(result.total).toBe(3);

    const sets = capturedUpdateSets as Array<{ birthplace?: unknown }>;
    expect(sets.map((s) => s.birthplace)).toEqual(
      expect.arrayContaining(["Chicago, Illinois", "Berlin", "Dallas, Texas"]),
    );
  });

  // -------------------------------------------------------------------------
  // Scenario 5: seasons tried in order — stops at first successful season
  // -------------------------------------------------------------------------
  it("uses the first season that returns a birthplace and does not call further seasons", async () => {
    const candidate = { id: 20, name: "Seattle Sam", apiFootballPlayerId: 20001 };
    setupSelectWhereOnly([candidate]);

    // First season returns a birthplace → second season must NOT be called
    mockAfFetch
      .mockResolvedValueOnce(makeBirthplaceResponse("Seattle, Washington"))
      .mockResolvedValueOnce(makeBirthplaceResponse("Other City"));

    await backfillCandidateBirthplaces({ seasons: [2025, 2024] });

    // afFetch called exactly once (stopped after first success)
    expect(mockAfFetch).toHaveBeenCalledTimes(1);

    const sets = capturedUpdateSets as Array<{ birthplace?: unknown }>;
    expect(sets[0]).toMatchObject({ birthplace: "Seattle, Washington" });
  });
});

// ===========================================================================
// Part 2 — rescoreAllCandidates fires us_state_birthplace signal
// ===========================================================================

describe("rescoreAllCandidates — us_state_birthplace signal via real evaluateEligibility", () => {
  const PENDING_CANDIDATE = {
    id: 100,
    name: "Houston Lad",
    apiFootballPlayerId: 99001,
    isManualOverride: false,
    status: "pending" as const,
    discoveredAt: new Date("2026-01-01"),
  };

  // -------------------------------------------------------------------------
  // Scenario 5: US-state birthplace → signal persisted
  // -------------------------------------------------------------------------
  it("persists a us_state_birthplace signal when birth.place contains a US state", async () => {
    setupSelectMock([PENDING_CANDIDATE]);
    mockAfFetch.mockResolvedValue(makeStatsResponse("Houston, Texas"));

    await rescoreAllCandidates({ maxCandidates: 10 });

    const inserts = capturedInsertValues as Array<{ signalType?: unknown; candidateId?: unknown }>;
    const stateBirthplaceSignal = inserts.find((v) => v.signalType === "us_state_birthplace");
    expect(
      stateBirthplaceSignal,
      "expected a us_state_birthplace signal to be inserted into eligibility_signals",
    ).toBeDefined();
    expect(stateBirthplaceSignal?.candidateId).toBe(100);
  });

  // -------------------------------------------------------------------------
  // Scenario 6: non-US birthplace → signal NOT inserted
  // -------------------------------------------------------------------------
  it("does NOT persist a us_state_birthplace signal when birth.place is a non-US city", async () => {
    setupSelectMock([PENDING_CANDIDATE]);
    mockAfFetch.mockResolvedValue(makeStatsResponse("Berlin"));

    await rescoreAllCandidates({ maxCandidates: 10 });

    const inserts = capturedInsertValues as Array<{ signalType?: unknown }>;
    const stateBirthplaceSignal = inserts.find((v) => v.signalType === "us_state_birthplace");
    expect(
      stateBirthplaceSignal,
      "us_state_birthplace signal must NOT be inserted for a non-US birthplace",
    ).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Scenario 7: null birthplace → signal NOT inserted
  // -------------------------------------------------------------------------
  it("does NOT persist a us_state_birthplace signal when birth.place is null", async () => {
    setupSelectMock([PENDING_CANDIDATE]);
    mockAfFetch.mockResolvedValue(makeStatsResponse(null));

    await rescoreAllCandidates({ maxCandidates: 10 });

    const inserts = capturedInsertValues as Array<{ signalType?: unknown }>;
    const stateBirthplaceSignal = inserts.find((v) => v.signalType === "us_state_birthplace");
    expect(
      stateBirthplaceSignal,
      "us_state_birthplace signal must NOT be inserted when birthplace is null",
    ).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Scenario 8: verify signal value matches the birthplace text
  // -------------------------------------------------------------------------
  it("stores the birthplace text as the signal value when us_state_birthplace fires", async () => {
    setupSelectMock([PENDING_CANDIDATE]);
    mockAfFetch.mockResolvedValue(makeStatsResponse("Denver, Colorado"));

    await rescoreAllCandidates({ maxCandidates: 10 });

    const inserts = capturedInsertValues as Array<{ signalType?: unknown; signalValue?: unknown }>;
    const sig = inserts.find((v) => v.signalType === "us_state_birthplace");
    expect(sig?.signalValue).toBe("Denver, Colorado");
  });

  // -------------------------------------------------------------------------
  // Scenario 9: db.update is also called (candidate row is updated after rescore)
  // -------------------------------------------------------------------------
  it("calls db.update on the candidate row in addition to persisting signals", async () => {
    setupSelectMock([PENDING_CANDIDATE]);
    mockAfFetch.mockResolvedValue(makeStatsResponse("Miami, Florida"));

    await rescoreAllCandidates({ maxCandidates: 10 });

    // At least one db.update call must have fired (the candidate row update)
    expect(capturedUpdateSets.length).toBeGreaterThanOrEqual(1);

    // The us_state_birthplace signal must also be persisted
    const inserts = capturedInsertValues as Array<{ signalType?: unknown }>;
    expect(inserts.some((v) => v.signalType === "us_state_birthplace")).toBe(true);
  });
});
