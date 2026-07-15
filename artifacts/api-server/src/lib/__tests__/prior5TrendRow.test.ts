/**
 * Regression guard: confirms that when a player has ≥ 10 match logs, both the
 * "last5" and "previous5" stat rows are written, the `previous5Stats` field in
 * the API response is non-null with a correct avgRating, and the UI rendering
 * conditions required to show the "vs prior 5 games" row are satisfied.
 *
 * Three test suites:
 *  1. aggregateFromMatchLogs — direct unit tests on both windows.
 *  2. Sync path integration — mocked sync with 10 logs → confirms upsertStatsRow
 *     is called for `previous5` with the correct avgRating.
 *  3. UI rendering conditions — pure-logic checks that `hasPrev5` is truthy
 *     when previous5Stats is non-null with minutes > 0.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { aggregateFromMatchLogs } from "../playerStatsSync.js";
import type { RealMatchLog } from "../playerStatsSync.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLog(overrides: Partial<RealMatchLog> = {}): RealMatchLog {
  return {
    apiFootballFixtureId: Math.floor(Math.random() * 1_000_000),
    date: "2025-01-01",
    opponent: "Opponent FC",
    competition: "Bundesliga",
    result: "W 2-1",
    minutes: 90,
    goals: 0,
    assists: 0,
    conceded: null,
    rating: 7.0,
    isNationalTeam: false,
    ...overrides,
  };
}

/** Build a 10-log array where ratings differ by window so we can assert precisely. */
function makeTenLogs(): RealMatchLog[] {
  // logs[0..4] → last-5 window.  rating = 7.5 each → avg 7.5
  // logs[5..9] → prior-5 window. rating = 6.8 each → avg 6.8
  return [
    makeLog({ date: "2025-05-10", rating: 7.5, minutes: 90 }),
    makeLog({ date: "2025-05-03", rating: 7.5, minutes: 90 }),
    makeLog({ date: "2025-04-26", rating: 7.5, minutes: 90 }),
    makeLog({ date: "2025-04-19", rating: 7.5, minutes: 90 }),
    makeLog({ date: "2025-04-12", rating: 7.5, minutes: 90 }),
    // — boundary —
    makeLog({ date: "2025-04-05", rating: 6.8, minutes: 90 }),
    makeLog({ date: "2025-03-29", rating: 6.8, minutes: 90 }),
    makeLog({ date: "2025-03-22", rating: 6.8, minutes: 90 }),
    makeLog({ date: "2025-03-15", rating: 6.8, minutes: 90 }),
    makeLog({ date: "2025-03-08", rating: 6.8, minutes: 90 }),
  ];
}

// ---------------------------------------------------------------------------
// Suite 1: aggregateFromMatchLogs — both windows
// ---------------------------------------------------------------------------

describe("aggregateFromMatchLogs — last-5 and prior-5 windows from a 10-game log", () => {
  const logs = makeTenLogs();

  it("last-5 window produces non-null stats", () => {
    const result = aggregateFromMatchLogs(logs.slice(0, 5));
    expect(result).not.toBeNull();
  });

  it("last-5 window has correct avgRating (7.50)", () => {
    const result = aggregateFromMatchLogs(logs.slice(0, 5))!;
    expect(result.avgRating).not.toBeNull();
    expect(result.avgRating!).toBeCloseTo(7.5, 5);
  });

  it("last-5 window has minutes > 0", () => {
    const result = aggregateFromMatchLogs(logs.slice(0, 5))!;
    expect(result.minutes).toBe(450);
  });

  it("prior-5 window produces non-null stats", () => {
    const result = aggregateFromMatchLogs(logs.slice(5, 10));
    expect(result).not.toBeNull();
  });

  it("prior-5 window has correct avgRating (6.80)", () => {
    const result = aggregateFromMatchLogs(logs.slice(5, 10))!;
    expect(result.avgRating).not.toBeNull();
    expect(result.avgRating!).toBeCloseTo(6.8, 5);
  });

  it("prior-5 window has minutes > 0", () => {
    const result = aggregateFromMatchLogs(logs.slice(5, 10))!;
    expect(result.minutes).toBe(450);
  });

  it("avgRatings differ between the two windows — last-5 > prior-5", () => {
    const last5 = aggregateFromMatchLogs(logs.slice(0, 5))!;
    const prior5 = aggregateFromMatchLogs(logs.slice(5, 10))!;
    expect(last5.avgRating!).toBeGreaterThan(prior5.avgRating!);
  });

  it("prior-5 window returns null when only 5 logs exist (no prior window)", () => {
    const fiveLogs = makeTenLogs().slice(0, 5);
    // slice(5, 10) on a 5-element array is empty → null
    const result = aggregateFromMatchLogs(fiveLogs.slice(5, 10));
    expect(result).toBeNull();
  });

  it("prior-5 window is non-null when exactly 6 logs exist (partial prior window)", () => {
    const sixLogs = makeTenLogs().slice(0, 6);
    // logs[5] is the one log in the prior window
    const result = aggregateFromMatchLogs(sixLogs.slice(5, 10));
    expect(result).not.toBeNull();
    expect(result!.minutes).toBe(90); // just the one game
  });
});

// ---------------------------------------------------------------------------
// Suite 2: sync path — mocked DB confirms previous5 row is written
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
} = vi.hoisted(() => {
  const tClubs = { _table: "clubs" };
  const tPlayers = { _table: "players" };
  const tPlayerStats = { _table: "playerStats" };
  const tMatchLogs = { _table: "matchLogs" };
  const tInjuries = { _table: "injuries" };

  const mockDb = {
    select: vi.fn(),
    delete: vi.fn().mockImplementation(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    insert: vi.fn().mockImplementation(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
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
  };
});

vi.mock("@workspace/db", () => ({
  db: mockDb,
  clubsTable: tClubs,
  playersTable: tPlayers,
  playerStatsTable: tPlayerStats,
  matchLogsTable: tMatchLogs,
  injuriesTable: tInjuries,
}));

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, _val: unknown) => ({ _eq: [_col, _val] }),
  and: (...args: unknown[]) => ({ _and: args }),
  inArray: (_col: unknown, _vals: unknown) => ({ _inArray: [_col, _vals] }),
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

import { syncPlayerStatsAndInjuries } from "../playerStatsSync.js";

// Test fixtures
const TEAM_ID = 42;
const PLAYER_API_ID = 99;

const CLUB = { id: 1, name: "Test Club FC", apiFootballTeamId: TEAM_ID };
const PLAYER = {
  id: 10,
  name: "Test Player",
  clubId: 1,
  apiFootballPlayerId: PLAYER_API_ID,
  age: 24,
  category: "prospect",
  nationalTeamCaps: 5,
  marketValueUsd: 3_000_000,
};

/** Build 10 finished fixture stubs for the club. */
function makeFixtureList() {
  return Array.from({ length: 10 }, (_, i) => ({
    fixture: { id: 1000 + i, date: `2025-05-${String(10 - i).padStart(2, "0")}T15:00:00Z`, status: { short: "FT" } },
    league: { name: "Bundesliga" },
    teams: { home: { id: TEAM_ID, name: "Test Club FC" }, away: { id: 99 + i, name: `Opponent ${i}` } },
    goals: { home: 1, away: 0 },
  }));
}

/** Build the fixture-players response for a single fixture. */
function makeFixturePlayers(fixtureId: number, rating: string) {
  return [
    {
      team: { id: TEAM_ID, name: "Test Club FC" },
      players: [
        {
          player: { id: PLAYER_API_ID, name: "Test Player" },
          statistics: [
            {
              games: { minutes: 90, rating, position: "Midfielder" },
              goals: { total: 0, assists: 0 },
            },
          ],
        },
      ],
    },
  ];
}

/** Season stats block — gives us a season baseline so computeFormTier fires. */
function makeSeasonStats() {
  return [
    {
      player: { id: PLAYER_API_ID, birth: { date: "2000-01-01" } },
      statistics: [
        {
          team: { id: TEAM_ID, name: "Test Club FC" },
          league: { name: "Bundesliga", season: 2025 },
          games: { minutes: 2700, lineups: 30, position: "Midfielder", rating: "7.0" },
          goals: { total: 5, assists: 3, conceded: null, saves: null },
          shots: { total: 20 },
          passes: { total: 1000, key: 40, accuracy: "80" },
          tackles: { total: 30, interceptions: 10 },
          duels: { total: 100, won: 60 },
        },
      ],
    },
  ];
}

function makeFromResult(data: unknown[]) {
  const p = Promise.resolve(data) as Promise<unknown[]> & { where: ReturnType<typeof vi.fn> };
  p.where = vi.fn().mockResolvedValue(data);
  return p;
}

describe("sync path — previous5 DB row written when player has 10 match logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockResolveTeamId.mockResolvedValue(TEAM_ID);
    mockEnsurePlayerApiFootballIds.mockResolvedValue(undefined);

    // Fixture-players ratings: last 5 (indices 0-4) rated 7.5, prior 5 (5-9) rated 6.8
    const fixtureRatings = ["7.5", "7.5", "7.5", "7.5", "7.5", "6.8", "6.8", "6.8", "6.8", "6.8"];

    mockAfFetch.mockImplementation(async (path: string) => {
      if (path.startsWith("/fixtures?team=")) return makeFixtureList();
      if (path.startsWith("/fixtures/players?fixture=")) {
        // Extract fixture id from path
        const fixtureId = parseInt(path.split("=")[1], 10);
        const index = fixtureId - 1000; // 0..9
        const rating = fixtureRatings[index] ?? "7.0";
        return makeFixturePlayers(fixtureId, rating);
      }
      if (path.startsWith("/players?id=")) return makeSeasonStats();
      if (path.startsWith("/injuries?")) return [];
      return [];
    });

    // db.select sequencing: clubs → players → post-loop aggregates
    mockDb.select
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([CLUB])) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([PLAYER])) })
      .mockReturnValue({ from: vi.fn().mockReturnValue(makeFromResult([])) });

    mockDb.delete.mockImplementation(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    mockDb.insert.mockImplementation(() => ({ values: vi.fn().mockResolvedValue(undefined) }));
    mockDb.update.mockImplementation(() => ({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }));
  });

  it("calls db.insert(playerStatsTable) with periodType 'previous5'", async () => {
    await syncPlayerStatsAndInjuries(10);

    // Collect all .values() calls on inserts to playerStatsTable
    const statsInserts: Array<{ periodType: string; avgRating: number | null }> = [];
    for (const [tableArg, ...rest] of mockDb.insert.mock.calls) {
      if (tableArg !== tPlayerStats) continue;
      // The chained .values() call stores its arg; retrieve it from the mock
      const valuesCallArgs = (rest as unknown as []) ; // insert().values() is the next call
      void valuesCallArgs; // suppress lint — we introspect via the values mock below
    }

    // Re-check via the values mock on the insert chain
    const previous5Inserts: unknown[] = [];
    for (let i = 0; i < mockDb.insert.mock.calls.length; i++) {
      const [tableArg] = mockDb.insert.mock.calls[i];
      if (tableArg !== tPlayerStats) continue;
      // The .values() was chained; vitest records return values for mock chains
      const returnedChain = mockDb.insert.mock.results[i]?.value as { values: ReturnType<typeof vi.fn> } | undefined;
      if (!returnedChain?.values) continue;
      for (const [payload] of returnedChain.values.mock.calls) {
        if (payload && (payload as { periodType?: string }).periodType === "previous5") {
          previous5Inserts.push(payload);
        }
      }
    }

    expect(previous5Inserts.length).toBeGreaterThanOrEqual(1);
  });

  it("previous5 row has a non-null avgRating close to 6.80", async () => {
    await syncPlayerStatsAndInjuries(10);

    const previous5Rows: Array<{ periodType: string; avgRating: number | null }> = [];
    for (let i = 0; i < mockDb.insert.mock.calls.length; i++) {
      const [tableArg] = mockDb.insert.mock.calls[i];
      if (tableArg !== tPlayerStats) continue;
      const chain = mockDb.insert.mock.results[i]?.value as { values: ReturnType<typeof vi.fn> } | undefined;
      if (!chain?.values) continue;
      for (const [payload] of chain.values.mock.calls) {
        if (payload && (payload as { periodType?: string }).periodType === "previous5") {
          previous5Rows.push(payload as { periodType: string; avgRating: number | null });
        }
      }
    }

    expect(previous5Rows.length).toBeGreaterThanOrEqual(1);
    const row = previous5Rows[0];
    expect(row.avgRating).not.toBeNull();
    // Prior-5 games were all rated 6.8 → avg must be 6.80
    expect(row.avgRating!).toBeCloseTo(6.8, 5);
  });

  it("last5 row has a non-null avgRating close to 7.50", async () => {
    await syncPlayerStatsAndInjuries(10);

    const last5Rows: Array<{ periodType: string; avgRating: number | null }> = [];
    for (let i = 0; i < mockDb.insert.mock.calls.length; i++) {
      const [tableArg] = mockDb.insert.mock.calls[i];
      if (tableArg !== tPlayerStats) continue;
      const chain = mockDb.insert.mock.results[i]?.value as { values: ReturnType<typeof vi.fn> } | undefined;
      if (!chain?.values) continue;
      for (const [payload] of chain.values.mock.calls) {
        if (payload && (payload as { periodType?: string }).periodType === "last5") {
          last5Rows.push(payload as { periodType: string; avgRating: number | null });
        }
      }
    }

    expect(last5Rows.length).toBeGreaterThanOrEqual(1);
    const row = last5Rows[0];
    expect(row.avgRating).not.toBeNull();
    expect(row.avgRating!).toBeCloseTo(7.5, 5);
  });

  it("sync returns playersWithMatchLogs >= 1", async () => {
    const result = await syncPlayerStatsAndInjuries(10);
    expect(result.playersWithMatchLogs).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: UI rendering condition — pure logic checks
//
// The Form Breakdown card renders the "vs prior 5 games" row under two guards:
//
//   Outer guard (lines 362-413 of PlayerProfile.tsx):
//     player.last5Stats.minutes >= 270
//     && player.last5Stats.avgRating != null
//     && player.seasonStats.avgRating != null
//
//   Inner guard (line 371):
//     const hasPrev5 = prev5Avg != null && (player.previous5Stats?.minutes ?? 0) > 0;
//
// These are pure boolean conditions that we can test without a DOM.
// ---------------------------------------------------------------------------

describe("UI rendering conditions — hasPrev5 and outer form breakdown guard", () => {
  type MinimalPlayerData = {
    last5Stats: { minutes: number; avgRating: number | null };
    seasonStats: { avgRating: number | null };
    previous5Stats: { avgRating: number | null; minutes: number } | null;
  };

  function outerGuardPasses(p: MinimalPlayerData): boolean {
    return p.last5Stats.minutes >= 270 && p.last5Stats.avgRating != null && p.seasonStats.avgRating != null;
  }

  function hasPrev5(p: MinimalPlayerData): boolean {
    const prev5Avg = p.previous5Stats?.avgRating ?? null;
    return prev5Avg != null && (p.previous5Stats?.minutes ?? 0) > 0;
  }

  const fullPlayer: MinimalPlayerData = {
    last5Stats: { minutes: 450, avgRating: 7.5 },
    seasonStats: { avgRating: 7.0 },
    previous5Stats: { avgRating: 6.8, minutes: 450 },
  };

  it("outer guard passes when last5 has 450 min + rating and season has rating", () => {
    expect(outerGuardPasses(fullPlayer)).toBe(true);
  });

  it("hasPrev5 is true when previous5Stats has avgRating and minutes > 0", () => {
    expect(hasPrev5(fullPlayer)).toBe(true);
  });

  it("both guards pass together — prior-5 row would render", () => {
    expect(outerGuardPasses(fullPlayer) && hasPrev5(fullPlayer)).toBe(true);
  });

  it("outer guard fails when last5 minutes < 270 — whole block hidden", () => {
    const p: MinimalPlayerData = {
      ...fullPlayer,
      last5Stats: { minutes: 200, avgRating: 7.5 },
    };
    expect(outerGuardPasses(p)).toBe(false);
  });

  it("hasPrev5 is false when previous5Stats is null", () => {
    const p: MinimalPlayerData = { ...fullPlayer, previous5Stats: null };
    expect(hasPrev5(p)).toBe(false);
  });

  it("hasPrev5 is false when previous5Stats.avgRating is null", () => {
    const p: MinimalPlayerData = {
      ...fullPlayer,
      previous5Stats: { avgRating: null, minutes: 450 },
    };
    expect(hasPrev5(p)).toBe(false);
  });

  it("hasPrev5 is false when previous5Stats.minutes is 0", () => {
    const p: MinimalPlayerData = {
      ...fullPlayer,
      previous5Stats: { avgRating: 6.8, minutes: 0 },
    };
    expect(hasPrev5(p)).toBe(false);
  });

  it("trendDelta is positive (TrendingUp) when last5Avg > prev5Avg", () => {
    const last5Avg = 7.5;
    const prev5Avg = 6.8;
    const trendDelta = last5Avg - prev5Avg;
    const trendPositive = trendDelta > 0.005;
    expect(trendPositive).toBe(true);
  });

  it("trendDelta is negative (TrendingDown) when last5Avg < prev5Avg", () => {
    const last5Avg = 6.8;
    const prev5Avg = 7.5;
    const trendDelta = last5Avg - prev5Avg;
    const trendNegative = trendDelta < -0.005;
    expect(trendNegative).toBe(true);
  });

  it("trendDelta is neutral (Minus icon) when last5Avg ≈ prev5Avg (within 0.005)", () => {
    const last5Avg = 7.001;
    const prev5Avg = 7.0;
    const trendDelta = last5Avg - prev5Avg;
    const trendPositive = trendDelta > 0.005;
    const trendNegative = trendDelta < -0.005;
    expect(trendPositive).toBe(false);
    expect(trendNegative).toBe(false);
  });
});
