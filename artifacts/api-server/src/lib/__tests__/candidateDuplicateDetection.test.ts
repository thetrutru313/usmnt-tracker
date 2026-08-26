/**
 * Regression guard: confirms that the discovery pass detects a name collision
 * and marks the newer candidate as a duplicate of the earlier one.
 *
 * ## What is tested
 * 1. When a new player's slugified name matches an existing pending candidate,
 *    the insert is called with `duplicateOfId` set to the existing candidate's
 *    id and `needsReview: true`.
 * 2. When a new player's slugified name matches an existing promoted candidate,
 *    the same duplicate flag is applied.
 * 3. When a new player's name matches a *dismissed* candidate, no duplicate
 *    flag is set — dismissed rows are ignored so names can be reconsidered.
 * 4. When no name collision exists the insert has no `duplicateOfId`.
 * 5. Accent-stripped slugs are compared so accented variants collide correctly.
 * 6. A third candidate with the same name as a newly inserted duplicate is
 *    also flagged in the same run (slug map is updated after each insert).
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
  capturedInsertValues,
} = vi.hoisted(() => {
  const tCandidates = { _table: "player_candidates" };
  const tPlayers = { _table: "players" };
  const tClubs = { _table: "clubs" };
  const tEligibilitySignals = { _table: "eligibility_signals" };

  /** Capture every .values({...}) call on db.insert(playerCandidatesTable) */
  const capturedInsertValues: unknown[] = [];

  const mockDb = {
    select: vi.fn(),
    insert: vi.fn().mockImplementation((table: unknown) => ({
      values: vi.fn().mockImplementation((vals: unknown) => {
        if (table === tCandidates) {
          capturedInsertValues.push(vals);
        }
        return {
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              { id: 99, isNew: new Date() }, // new row (within the 5-second window)
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

  return {
    mockDb,
    tCandidates,
    tPlayers,
    tClubs,
    tEligibilitySignals,
    mockAfFetch: vi.fn(),
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
  detectSeniorNonUsCaps: vi.fn().mockReturnValue(false),
  countNationalTeamCaps: vi.fn().mockReturnValue({ seniorCaps: 0, youthCaps: 0 }),
}));

vi.mock("../eligibilitySignalsConfig.js", () => ({
  getMinEligibilityScore: vi.fn().mockReturnValue(30),
  getMaxCandidateAge: vi.fn().mockReturnValue(23),
}));

// Import AFTER mocks are registered
import { discoverUSProspects } from "../playerDiscovery.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stats that pass the quality gate (10 starts, 900 min). */
const PASSING_STATS = [
  {
    team: { id: 1, name: "Club FC" },
    league: { name: "Premier League", season: 2025 },
    games: { lineups: 10, minutes: 900, position: "MF", rating: "7.20" },
  },
];

const TEST_CLUB = { id: 1, name: "Test Club", apiFootballTeamId: 100 };

/**
 * Builds a minimal API-Football profile response for one player.
 * The name must match the squad player name so the deduplication check fires.
 */
function makeProfileResponse(apiId: number, name: string) {
  return [
    {
      player: {
        id: apiId,
        name,
        firstname: name.split(" ")[0] ?? null,
        age: 23,
        nationality: "USA",
        birth: { country: "USA", date: "2003-06-15", place: "Denver, CO" },
      },
      statistics: PASSING_STATS,
    },
  ];
}

/**
 * Wire db.select for a discovery run.
 *
 * discoverUSProspects() makes exactly three sequential db.select calls,
 * each ending with .from() (no .where()):
 *   call 0 → clubs
 *   call 1 → tracked players (Promise.all left)
 *   call 2 → existing candidates (Promise.all right)
 *
 * Promise.all dispatches both in the same microtask, but JS executes the
 * two .select() calls synchronously left-to-right before any await, so the
 * counter is reliable.
 */
function wireSelectMocks(options: {
  existingCandidates: Array<{
    id: number;
    apiFootballPlayerId: number;
    name: string;
    status: string;
  }>;
}) {
  let callCount = 0;
  mockDb.select.mockImplementation(() => {
    const n = callCount++;
    let resolvedValue: unknown;
    if (n === 0) {
      resolvedValue = [TEST_CLUB]; // clubs
    } else if (n === 1) {
      resolvedValue = []; // tracked players — none
    } else {
      resolvedValue = options.existingCandidates; // existing candidates
    }
    return { from: vi.fn().mockResolvedValue(resolvedValue) };
  });
}

/**
 * Wire afFetch to return:
 * - squads call → squad containing squadPlayers
 * - profile calls → a passing profile for each squad player
 */
function wireAfFetch(squadPlayers: Array<{ id: number; name: string }>) {
  mockAfFetch.mockImplementation((path: string) => {
    if (path.includes("/players/squads")) {
      return Promise.resolve([
        { team: { id: 100, name: "Test Club" }, players: squadPlayers },
      ]);
    }
    const idMatch = path.match(/[?&]id=(\d+)/);
    if (idMatch) {
      const apiId = parseInt(idMatch[1]!, 10);
      const sp = squadPlayers.find((p) => p.id === apiId);
      if (sp) return Promise.resolve(makeProfileResponse(apiId, sp.name));
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
      if (table === tCandidates) {
        capturedInsertValues.push(vals);
      }
      return {
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            { id: 99, isNew: new Date() },
          ]),
        }),
      };
    }),
  }));

  mockDb.update.mockImplementation(() => ({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  }));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("discoverUSProspects — duplicate name detection", () => {
  // -------------------------------------------------------------------------
  // Scenario 1: slug matches an existing pending candidate
  // -------------------------------------------------------------------------
  it("sets duplicateOfId when the new player's name matches an existing pending candidate", async () => {
    wireSelectMocks({
      existingCandidates: [
        { id: 10, apiFootballPlayerId: 1001, name: "John Smith", status: "pending" },
      ],
    });
    // New player same name, different API ID (1001 is already known → only 2002 is unknown)
    wireAfFetch([
      { id: 1001, name: "John Smith" }, // already in knownApiIds — skipped
      { id: 2002, name: "John Smith" }, // unknown → triggers deduplication check
    ]);

    await discoverUSProspects();

    // Only one insert should have fired (for apiId 2002)
    expect(capturedInsertValues).toHaveLength(1);
    const inserted = capturedInsertValues[0] as Record<string, unknown>;
    expect(inserted["duplicateOfId"]).toBe(10);
    expect(inserted["needsReview"]).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Scenario 2: slug matches an existing promoted candidate
  // -------------------------------------------------------------------------
  it("sets duplicateOfId when the new player's name matches an existing promoted candidate", async () => {
    wireSelectMocks({
      existingCandidates: [
        { id: 20, apiFootballPlayerId: 2001, name: "Carlos Garcia", status: "promoted" },
      ],
    });
    wireAfFetch([
      { id: 2001, name: "Carlos Garcia" }, // already known
      { id: 3002, name: "Carlos Garcia" }, // unknown — should be flagged
    ]);

    await discoverUSProspects();

    expect(capturedInsertValues).toHaveLength(1);
    const inserted = capturedInsertValues[0] as Record<string, unknown>;
    expect(inserted["duplicateOfId"]).toBe(20);
    expect(inserted["needsReview"]).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Scenario 3: name matches a dismissed candidate — no duplicate flag
  // -------------------------------------------------------------------------
  it("does NOT set duplicateOfId when the matching candidate is dismissed", async () => {
    wireSelectMocks({
      existingCandidates: [
        { id: 30, apiFootballPlayerId: 3001, name: "Alex Turner", status: "dismissed" },
      ],
    });
    wireAfFetch([
      { id: 3001, name: "Alex Turner" }, // already in knownApiIds
      { id: 4002, name: "Alex Turner" }, // unknown — dismissed origin → no flag
    ]);

    await discoverUSProspects();

    expect(capturedInsertValues).toHaveLength(1);
    const inserted = capturedInsertValues[0] as Record<string, unknown>;
    // No collision — dismissed candidates are ignored
    expect(inserted["duplicateOfId"]).toBeUndefined();
    expect(inserted["needsReview"]).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Scenario 4: no name collision — no duplicate flag
  // -------------------------------------------------------------------------
  it("does NOT set duplicateOfId when there is no name collision", async () => {
    wireSelectMocks({
      existingCandidates: [
        { id: 40, apiFootballPlayerId: 4001, name: "James Brown", status: "pending" },
      ],
    });
    wireAfFetch([
      { id: 4001, name: "James Brown" }, // already known
      { id: 5002, name: "Tyler Reed" },   // different name — no collision
    ]);

    await discoverUSProspects();

    expect(capturedInsertValues).toHaveLength(1);
    const inserted = capturedInsertValues[0] as Record<string, unknown>;
    expect(inserted["duplicateOfId"]).toBeUndefined();
    expect(inserted["needsReview"]).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Scenario 5: accent-stripped slug normalisation detects collision
  // -------------------------------------------------------------------------
  it("detects a collision when accent-stripped slugs match an existing candidate", async () => {
    wireSelectMocks({
      existingCandidates: [
        // Stored without accents
        { id: 50, apiFootballPlayerId: 5001, name: "Luis Lopez", status: "pending" },
      ],
    });
    wireAfFetch([
      { id: 5001, name: "Luis Lopez" }, // already known
      // New player with accented name — slug normalises to "luis-lopez"
      { id: 6002, name: "Luís López" },
    ]);

    await discoverUSProspects();

    expect(capturedInsertValues).toHaveLength(1);
    const inserted = capturedInsertValues[0] as Record<string, unknown>;
    expect(inserted["duplicateOfId"]).toBe(50);
    expect(inserted["needsReview"]).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Scenario 6: third candidate with same name is also flagged in same run
  // -------------------------------------------------------------------------
  it("flags a third same-name candidate discovered in the same run", async () => {
    // Existing: one pending "John Smith" (id=60, apiId=6001)
    // Squad: two additional "John Smith" players (apiIds 7001 and 7002)
    // → both new inserts should carry a duplicateOfId
    wireSelectMocks({
      existingCandidates: [
        { id: 60, apiFootballPlayerId: 6001, name: "John Smith", status: "pending" },
      ],
    });
    wireAfFetch([
      { id: 6001, name: "John Smith" }, // already known — skipped
      { id: 7001, name: "John Smith" }, // unknown — collides with id=60
      { id: 7002, name: "John Smith" }, // unknown — collides with newly inserted id=99
    ]);

    await discoverUSProspects();

    // Both new candidates should have been flagged
    expect(capturedInsertValues).toHaveLength(2);
    for (const vals of capturedInsertValues) {
      const v = vals as Record<string, unknown>;
      expect(v["duplicateOfId"]).toBeDefined();
      expect(typeof v["duplicateOfId"]).toBe("number");
      expect(v["needsReview"]).toBe(true);
    }
  });
});
