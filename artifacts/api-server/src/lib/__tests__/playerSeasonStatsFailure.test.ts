/**
 * Regression guard: when fetchSeasonStats fails for one player (all
 * afFetch calls for that player's /players?id=...&season=... throw),
 * the sync must:
 *   1. Delete any stale season and previous_season rows for that player
 *      (not leave prior-run data in place).
 *   2. Leave other players at the same club completely unaffected —
 *      their season stats are still written normally.
 *
 * fetchSeasonStats catches internally and returns { statistics: [], birthDate: null }
 * when afFetch throws, so "throws" here means afFetch throws for those paths.
 * With empty statistics, aggregateSeasonBlocks returns null → withData is empty →
 * deleteStatsRow is called for both "season" and "previous_season".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks (must be defined before any imports from the tested module)
// ---------------------------------------------------------------------------

const TEAM_ID = 42;
const PLAYER_A_API_ID = 99; // fetchSeasonStats will throw for this player
const PLAYER_B_API_ID = 88; // fetchSeasonStats returns valid data for this player
const USA_NATIONAL_TEAM_ID = 2384;

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

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const CLUB = { id: 1, name: "Test Club FC", apiFootballTeamId: TEAM_ID };

/** Player A — fetchSeasonStats will throw for all seasons. */
const PLAYER_A = {
  id: 10,
  name: "Player A",
  clubId: 1,
  apiFootballPlayerId: PLAYER_A_API_ID,
  age: 25,
  category: "fringe" as const,
  nationalTeamCaps: 5,
  marketValueUsd: 3_000_000,
};

/** Player B — fetchSeasonStats returns valid data. */
const PLAYER_B = {
  id: 11,
  name: "Player B",
  clubId: 1,
  apiFootballPlayerId: PLAYER_B_API_ID,
  age: 27,
  category: "core" as const,
  nationalTeamCaps: 15,
  marketValueUsd: 8_000_000,
};

/** Minimal valid AfSeasonStatBlock for player B (non-friendly, club team). */
const PLAYER_B_STAT_BLOCK = {
  team: { id: TEAM_ID, name: "Test Club FC" },
  league: { name: "MLS", season: 2026 },
  games: { minutes: 1800, lineups: 20, position: "Midfielder", rating: "7.2" },
  goals: { total: 4, assists: 3, conceded: null, saves: null },
  shots: { total: 30 },
  passes: { total: 800, key: 40, accuracy: "84" },
  tackles: { total: 50, interceptions: 20 },
  duels: { total: 100, won: 58 },
};

function makeFromResult(data: unknown[]) {
  const p = Promise.resolve(data) as Promise<unknown[]> & { where: ReturnType<typeof vi.fn> };
  p.where = vi.fn().mockResolvedValue(data);
  return p;
}

/**
 * Set up DB select mocks for one club and two players.
 * Remaining selects (post-loop call-up score computation) return empty arrays.
 */
function setupDbMocksForTwoPlayers() {
  mockDb.select
    .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([CLUB])) })
    .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([PLAYER_A, PLAYER_B])) })
    .mockReturnValue({ from: vi.fn().mockReturnValue(makeFromResult([])) });

  mockDb.delete.mockImplementation(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
  mockDb.insert.mockImplementation(() => ({ values: vi.fn().mockResolvedValue(undefined) }));
  mockDb.update.mockImplementation(() => ({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  }));
}

// ---------------------------------------------------------------------------
// Helpers for inspecting mock calls
// ---------------------------------------------------------------------------

/**
 * Collect all payloads inserted into tPlayerStats since last clearAllMocks().
 * Each entry is the first argument passed to .values().
 */
function collectPlayerStatsInsertPayloads(): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < mockDb.insert.mock.calls.length; i++) {
    const [tableArg] = mockDb.insert.mock.calls[i];
    if (tableArg !== tPlayerStats) continue;
    const chain = mockDb.insert.mock.results[i]?.value as { values: ReturnType<typeof vi.fn> } | undefined;
    if (!chain?.values) continue;
    for (const [payload] of chain.values.mock.calls) {
      rows.push(payload as Record<string, unknown>);
    }
  }
  return rows;
}

/**
 * Collect all `.where(...)` argument values passed to `db.delete(tPlayerStats)` calls.
 * Each entry is the where-clause argument (the mock drizzle `and(...)` / `eq(...)` object).
 */
function collectPlayerStatsDeleteWhereClauses(): unknown[] {
  const clauses: unknown[] = [];
  for (let i = 0; i < mockDb.delete.mock.calls.length; i++) {
    const [tableArg] = mockDb.delete.mock.calls[i];
    if (tableArg !== tPlayerStats) continue;
    const chain = mockDb.delete.mock.results[i]?.value as { where: ReturnType<typeof vi.fn> } | undefined;
    if (!chain?.where) continue;
    for (const [clause] of chain.where.mock.calls) {
      clauses.push(clause);
    }
  }
  return clauses;
}

/**
 * Extract all (playerId, periodType) pairs from the delete-where clauses
 * collected above. The mocked drizzle `and(eq(col, val), eq(col, val))` objects
 * carry the raw values in `_and[n]._eq[1]` — numeric values are player IDs,
 * string values are period types.
 */
function extractDeletedPeriods(): { playerId: number; periodType: string }[] {
  const clauses = collectPlayerStatsDeleteWhereClauses();
  const results: { playerId: number; periodType: string }[] = [];
  for (const clause of clauses) {
    const c = clause as { _and?: { _eq: [unknown, unknown] }[] };
    if (!c._and || c._and.length < 2) continue;
    const vals = c._and.map((term) => term._eq[1]);
    const playerId = vals.find((v) => typeof v === "number") as number | undefined;
    const periodType = vals.find((v) => typeof v === "string") as string | undefined;
    if (playerId != null && periodType != null) {
      results.push({ playerId, periodType });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("syncPlayerStatsAndInjuries — fetchSeasonStats failure for one player", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveTeamId.mockResolvedValue(TEAM_ID);
    mockEnsurePlayerApiFootballIds.mockResolvedValue(undefined);
  });

  it("when fetchSeasonStats throws for player A, player A's season and previous_season rows are deleted (not left stale)", async () => {
    setupDbMocksForTwoPlayers();

    mockAfFetch.mockImplementation(async (path: string) => {
      // Season-stats calls for player A — always throw.
      if (path.startsWith(`/players?id=${PLAYER_A_API_ID}`)) {
        throw new Error("API-Football timeout");
      }
      // Season-stats calls for player B — return valid data for 2026 only.
      if (path.startsWith(`/players?id=${PLAYER_B_API_ID}&season=2026`)) {
        return [{ player: { id: PLAYER_B_API_ID, birth: { date: "1997-04-12" } }, statistics: [PLAYER_B_STAT_BLOCK] }];
      }
      if (path.startsWith(`/players?id=${PLAYER_B_API_ID}`)) return [];
      // Injuries and fixtures — no data needed for this test.
      if (path.startsWith(`/injuries?team=${USA_NATIONAL_TEAM_ID}`)) return [];
      if (path.startsWith(`/injuries?team=${TEAM_ID}`)) return [];
      if (path.startsWith("/fixtures?team=")) return [];
      return [];
    });

    await syncPlayerStatsAndInjuries(0);

    const deletedPeriods = extractDeletedPeriods();
    const playerADeleted = deletedPeriods.filter((d) => d.playerId === PLAYER_A.id);

    // Player A must have had both season and previous_season deleted.
    const periodTypesDeleted = playerADeleted.map((d) => d.periodType);
    expect(periodTypesDeleted).toContain("season");
    expect(periodTypesDeleted).toContain("previous_season");
  });

  it("when fetchSeasonStats throws for player A, no season or previous_season rows are inserted for player A", async () => {
    setupDbMocksForTwoPlayers();

    mockAfFetch.mockImplementation(async (path: string) => {
      if (path.startsWith(`/players?id=${PLAYER_A_API_ID}`)) {
        throw new Error("API-Football timeout");
      }
      if (path.startsWith(`/players?id=${PLAYER_B_API_ID}&season=2026`)) {
        return [{ player: { id: PLAYER_B_API_ID, birth: { date: "1997-04-12" } }, statistics: [PLAYER_B_STAT_BLOCK] }];
      }
      if (path.startsWith(`/players?id=${PLAYER_B_API_ID}`)) return [];
      if (path.startsWith(`/injuries?team=${USA_NATIONAL_TEAM_ID}`)) return [];
      if (path.startsWith(`/injuries?team=${TEAM_ID}`)) return [];
      if (path.startsWith("/fixtures?team=")) return [];
      return [];
    });

    await syncPlayerStatsAndInjuries(0);

    const inserts = collectPlayerStatsInsertPayloads();
    // Inserts for player A's season or previous_season must not exist.
    const playerASeasonInserts = inserts.filter(
      (r) => r.playerId === PLAYER_A.id && (r.periodType === "season" || r.periodType === "previous_season"),
    );
    expect(playerASeasonInserts).toHaveLength(0);
  });

  it("when fetchSeasonStats throws for player A, player B at the same club still gets their season row written", async () => {
    setupDbMocksForTwoPlayers();

    mockAfFetch.mockImplementation(async (path: string) => {
      if (path.startsWith(`/players?id=${PLAYER_A_API_ID}`)) {
        throw new Error("API-Football timeout");
      }
      if (path.startsWith(`/players?id=${PLAYER_B_API_ID}&season=2026`)) {
        return [{ player: { id: PLAYER_B_API_ID, birth: { date: "1997-04-12" } }, statistics: [PLAYER_B_STAT_BLOCK] }];
      }
      if (path.startsWith(`/players?id=${PLAYER_B_API_ID}`)) return [];
      if (path.startsWith(`/injuries?team=${USA_NATIONAL_TEAM_ID}`)) return [];
      if (path.startsWith(`/injuries?team=${TEAM_ID}`)) return [];
      if (path.startsWith("/fixtures?team=")) return [];
      return [];
    });

    await syncPlayerStatsAndInjuries(0);

    const inserts = collectPlayerStatsInsertPayloads();
    const playerBSeasonInserts = inserts.filter(
      (r) => r.playerId === PLAYER_B.id && r.periodType === "season",
    );
    // Player B must have exactly one season row written.
    expect(playerBSeasonInserts).toHaveLength(1);
    // And it should contain the stats from the mock data (goals=4).
    expect(playerBSeasonInserts[0].goals).toBe(4);
  });

  it("when fetchSeasonStats throws for player A, the sync result still counts player B's season stats", async () => {
    setupDbMocksForTwoPlayers();

    mockAfFetch.mockImplementation(async (path: string) => {
      if (path.startsWith(`/players?id=${PLAYER_A_API_ID}`)) {
        throw new Error("API-Football timeout");
      }
      if (path.startsWith(`/players?id=${PLAYER_B_API_ID}&season=2026`)) {
        return [{ player: { id: PLAYER_B_API_ID, birth: { date: "1997-04-12" } }, statistics: [PLAYER_B_STAT_BLOCK] }];
      }
      if (path.startsWith(`/players?id=${PLAYER_B_API_ID}`)) return [];
      if (path.startsWith(`/injuries?team=${USA_NATIONAL_TEAM_ID}`)) return [];
      if (path.startsWith(`/injuries?team=${TEAM_ID}`)) return [];
      if (path.startsWith("/fixtures?team=")) return [];
      return [];
    });

    const result = await syncPlayerStatsAndInjuries(0);

    // One club processed, no club-level failures (fetchSeasonStats failure is
    // handled inside the per-player loop, not at the club level).
    expect(result.clubsProcessed).toBe(1);
    expect(result.failures).toBe(0);
    // Only player B produced season stats.
    expect(result.playersWithSeasonStats).toBe(1);
  });
});
