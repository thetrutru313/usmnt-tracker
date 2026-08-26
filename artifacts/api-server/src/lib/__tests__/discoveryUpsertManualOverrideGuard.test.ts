/**
 * Regression guard: confirms that the discovery upsert (discoverUSProspects)
 * never overwrites `usmnt_status` or `eligibility_confidence` for a candidate
 * whose `is_manual_override` flag is set.
 *
 * ## Why this matters
 * The discovery pass uses onConflictDoUpdate keyed on apiFootballPlayerId.
 * Without an override guard in the conflict SET clause, every daily squad scan
 * would silently clobber whatever status an operator pinned via the
 * override-status endpoint — the same regression class that rescoreAllCandidates
 * already had.
 *
 * ## What is tested
 * 1. The `set` object passed to onConflictDoUpdate uses SQL CASE expressions
 *    (not plain values) for `eligibilityConfidence` and `usmntStatus`, so the
 *    DB engine preserves the existing row's values when `is_manual_override = true`.
 * 2. Other fields in the conflict set (birthplace, season stats, dataSources)
 *    are still updated as plain values — only the scored/status fields are
 *    protected.
 * 3. Newly inserted candidates (no conflict) still receive the scored values
 *    directly in the insert `values` payload.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared mock state — vi.hoisted so factories execute before vi.mock calls
// ---------------------------------------------------------------------------

const {
  mockDb,
  tCandidates,
  tPlayers,
  tClubs,
  tEligibilitySignals,
  mockAfFetch,
  capturedConflictSets,
  capturedInsertValues,
} = vi.hoisted(() => {
  const tCandidates = { _table: "player_candidates", isManualOverride: "is_manual_override", eligibilityConfidence: "eligibility_confidence", usmntStatus: "usmnt_status" };
  const tPlayers = { _table: "players" };
  const tClubs = { _table: "clubs" };
  const tEligibilitySignals = { _table: "eligibility_signals" };

  /** Capture the `set` object passed to every onConflictDoUpdate call. */
  const capturedConflictSets: unknown[] = [];
  /** Capture the `values` object passed to every insert for playerCandidatesTable. */
  const capturedInsertValues: unknown[] = [];

  const mockDb = {
    select: vi.fn(),
    insert: vi.fn().mockImplementation((table: unknown) => ({
      values: vi.fn().mockImplementation((vals: unknown) => {
        if (table === tCandidates) {
          capturedInsertValues.push(vals);
        }
        return {
          onConflictDoUpdate: vi.fn().mockImplementation((opts: unknown) => {
            if (table === tCandidates) {
              capturedConflictSets.push((opts as { set: unknown }).set);
            }
            return {
              returning: vi.fn().mockResolvedValue([
                // Return a row with a very recent discoveredAt so isNewRow = true
                { id: 99, isNew: new Date() },
              ]),
            };
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

  return {
    mockDb,
    tCandidates,
    tPlayers,
    tClubs,
    tEligibilitySignals,
    mockAfFetch: vi.fn(),
    capturedConflictSets,
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
  isFriendlyLeague: vi.fn().mockReturnValue(false),
}));

vi.mock("../playerStatsSync.js", () => ({
  isFriendlyLeague: vi.fn().mockReturnValue(false),
  syncPlayerStatsAndInjuries: vi.fn().mockResolvedValue(undefined),
  syncStatsForFinishedFixture: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../evaluateEligibility.js", () => ({
  evaluateEligibility: vi.fn().mockReturnValue({
    score: 80,
    status: "US_ELIGIBLE_PROSPECT",
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

import { discoverUSProspects } from "../playerDiscovery.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_CLUB = { id: 1, name: "Portland Timbers", apiFootballTeamId: 500 };

const SQUAD_PLAYER = { id: 7777, name: "Alex Discovery" };

/** Passing stats so the quality gate lets the player through. */
const PASSING_STATS = [
  {
    team: { id: 500, name: "Portland Timbers" },
    league: { name: "Major League Soccer", season: 2025 },
    games: { lineups: 12, minutes: 1080, position: "MF", rating: "7.10" },
  },
];

/** API-Football profile response for the squad player. */
function makeProfileResponse() {
  return [
    {
      player: {
        id: SQUAD_PLAYER.id,
        name: SQUAD_PLAYER.name,
        firstname: "Alex",
        age: 21,
        nationality: "USA",
        birth: { country: "USA", date: "2004-04-20", place: "Portland, OR" },
      },
      statistics: PASSING_STATS,
    },
  ];
}

/**
 * Wire db.select for a discovery run.
 *
 * discoverUSProspects() makes three sequential db.select calls:
 *   call 0 → clubs list
 *   call 1 → tracked players   (Promise.all left)
 *   call 2 → existing candidates slug map (Promise.all right)
 */
function wireSelectMocks(
  existingCandidates: Array<{ id: number; apiFootballPlayerId: number; name: string; status: string }> = [],
) {
  let callCount = 0;
  mockDb.select.mockImplementation(() => {
    const n = callCount++;
    let resolvedValue: unknown;
    if (n === 0) {
      resolvedValue = [TEST_CLUB];
    } else if (n === 1) {
      resolvedValue = []; // no already-tracked players
    } else {
      resolvedValue = existingCandidates;
    }
    return { from: vi.fn().mockResolvedValue(resolvedValue) };
  });
}

/** Wire afFetch for a single club squad + profile. */
function wireAfFetch() {
  mockAfFetch.mockImplementation((path: string) => {
    if (path.includes("/players/squads")) {
      return Promise.resolve([
        { team: { id: TEST_CLUB.apiFootballTeamId, name: TEST_CLUB.name }, players: [SQUAD_PLAYER] },
      ]);
    }
    if (path.includes(`id=${SQUAD_PLAYER.id}`)) {
      return Promise.resolve(makeProfileResponse());
    }
    return Promise.resolve([]);
  });
}

// ---------------------------------------------------------------------------
// Per-test reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  capturedConflictSets.length = 0;
  capturedInsertValues.length = 0;

  // Restore the insert mock after clearAllMocks
  mockDb.insert.mockImplementation((table: unknown) => ({
    values: vi.fn().mockImplementation((vals: unknown) => {
      if (table === tCandidates) {
        capturedInsertValues.push(vals);
      }
      return {
        onConflictDoUpdate: vi.fn().mockImplementation((opts: unknown) => {
          if (table === tCandidates) {
            capturedConflictSets.push((opts as { set: unknown }).set);
          }
          return {
            returning: vi.fn().mockResolvedValue([
              { id: 99, isNew: new Date() },
            ]),
          };
        }),
      };
    }),
  }));

  mockDb.update.mockImplementation(() => ({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  }));

  mockDb.delete.mockImplementation(() => ({
    where: vi.fn().mockResolvedValue(undefined),
  }));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("discoverUSProspects — manual override guard in onConflictDoUpdate", () => {
  it("uses a SQL expression (not a plain value) for usmntStatus in the conflict SET", async () => {
    wireSelectMocks();
    wireAfFetch();

    await discoverUSProspects();

    expect(capturedConflictSets.length).toBeGreaterThan(0);

    const set = capturedConflictSets[0] as Record<string, unknown>;
    expect(
      set["usmntStatus"],
      "usmntStatus in the conflict SET must be a SQL CASE expression, not a plain string",
    ).toEqual({ _sql: true });
  });

  it("uses a SQL expression (not a plain value) for eligibilityConfidence in the conflict SET", async () => {
    wireSelectMocks();
    wireAfFetch();

    await discoverUSProspects();

    expect(capturedConflictSets.length).toBeGreaterThan(0);

    const set = capturedConflictSets[0] as Record<string, unknown>;
    expect(
      set["eligibilityConfidence"],
      "eligibilityConfidence in the conflict SET must be a SQL CASE expression, not a plain number",
    ).toEqual({ _sql: true });
  });

  it("still supplies plain values for non-protected fields (dataSources, birthplace, season stats)", async () => {
    wireSelectMocks();
    wireAfFetch();

    await discoverUSProspects();

    expect(capturedConflictSets.length).toBeGreaterThan(0);

    const set = capturedConflictSets[0] as Record<string, unknown>;

    // dataSources, birthplace, and season metrics should remain plain values —
    // they are not subject to the manual override guard.
    expect(set["dataSources"]).not.toEqual({ _sql: true });
    expect(set["birthplace"]).not.toEqual({ _sql: true });
    expect(set["currentSeasonStarts"]).not.toEqual({ _sql: true });
    expect(set["currentSeasonMinutes"]).not.toEqual({ _sql: true });
  });

  it("inserts scored values directly into the values() payload for brand-new candidates", async () => {
    wireSelectMocks();
    wireAfFetch();

    await discoverUSProspects();

    expect(capturedInsertValues.length).toBeGreaterThan(0);

    const vals = capturedInsertValues[0] as Record<string, unknown>;

    // New-row values should be concrete — the guard only applies to the
    // conflict SET so existing overridden rows are protected on re-upsert.
    expect(typeof vals["eligibilityConfidence"]).toBe("number");
    expect(typeof vals["usmntStatus"]).toBe("string");
  });

  it("fires exactly one onConflictDoUpdate per discovered player", async () => {
    wireSelectMocks();
    wireAfFetch();

    await discoverUSProspects();

    expect(capturedConflictSets.length).toBe(1);
  });
});
