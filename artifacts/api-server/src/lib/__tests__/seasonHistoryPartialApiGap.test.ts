/**
 * Regression documentation: `replaceSeasonHistoryRows` uses a delete-then-insert
 * strategy, so any season year that returns no API data is silently absent from
 * the season-history dropdown after that sync run.
 *
 * ## Scenario
 * Player has existing `season_all` rows for 2024 and 2025 (prior sync).
 * The daily sync fires and fetches three year candidates [2026, 2025, 2024]:
 *   - 2026 → real API data (new season started)
 *   - 2025 → empty response (transient 5xx / API gap)
 *   - 2024 → empty response
 *
 * `replaceSeasonHistoryRows`:
 *   1. DELETE all `season_all` rows for this player
 *   2. INSERT one row — 2026 only (2025 returned no data, so it is not re-inserted)
 *
 * ## Accepted behaviour
 * After sync, the 2025 season-history row is gone. The test pins this so any future
 * move toward additive/merge behaviour is a deliberate, visible change.
 *
 * ## What is tested
 * - db.delete fires for `season_all` (the full bucket is wiped)
 * - db.insert fires exactly once for `season_all` with season "2026"
 * - db.insert does NOT fire for `season_all` with season "2025"
 * - The sync completes without error and reports zero failures
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const TEAM_ID = 55;
const PLAYER_API_ID = 123;
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
  capturedSeasonAllDeletes,
  capturedSeasonAllInserts,
} = vi.hoisted(() => {
  const tClubs = { _table: "clubs" };
  const tPlayers = { _table: "players" };
  const tPlayerStats = { _table: "playerStats" };
  const tMatchLogs = { _table: "matchLogs" };
  const tInjuries = { _table: "injuries" };

  // Capture delete where-clauses and insert payloads for season_all assertions
  const capturedSeasonAllDeletes: unknown[] = [];
  const capturedSeasonAllInserts: Record<string, unknown>[] = [];

  const mockDb = {
    select: vi.fn(),
    delete: vi.fn().mockImplementation((table: unknown) => ({
      where: vi.fn().mockImplementation((condition: unknown) => {
        if (table === tPlayerStats) capturedSeasonAllDeletes.push(condition);
        return Promise.resolve(undefined);
      }),
    })),
    insert: vi.fn().mockImplementation((table: unknown) => ({
      values: vi.fn().mockImplementation((data: unknown) => {
        if (table === tPlayerStats) {
          const row = data as Record<string, unknown>;
          if (row.periodType === "season_all") capturedSeasonAllInserts.push(row);
        }
        return Promise.resolve(undefined);
      }),
    })),
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
    capturedSeasonAllDeletes,
    capturedSeasonAllInserts,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: mockDb,
  clubsTable: tClubs,
  playersTable: tPlayers,
  playerStatsTable: tPlayerStats,
  matchLogsTable: tMatchLogs,
  injuriesTable: tInjuries,
}));

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, val: unknown) => ({ _eq: [_col, val] }),
  and: (...args: unknown[]) => ({ _and: args }),
  inArray: (_col: unknown, vals: unknown) => ({ _inArray: [_col, vals] }),
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
// Fixtures
// ---------------------------------------------------------------------------

/** Club whose apiFootballTeamId is TEAM_ID — ensures allClubTeamIds includes it. */
const CLUB = { id: 1, name: "History FC", apiFootballTeamId: TEAM_ID };

const PLAYER = {
  id: 30,
  name: "History Player",
  clubId: 1,
  apiFootballPlayerId: PLAYER_API_ID,
  age: 26,
  category: "fringe" as const,
  nationalTeamCaps: 8,
  marketValueUsd: 5_000_000,
};

/**
 * A minimal valid AfSeasonStatBlock for a non-friendly league at TEAM_ID.
 * Used for the 2026 season response.
 */
const STAT_BLOCK_2026 = {
  team: { id: TEAM_ID, name: "History FC" },
  league: { name: "MLS", season: 2026 },
  games: { minutes: 1440, lineups: 16, position: "Midfielder", rating: "7.1" },
  goals: { total: 3, assists: 5, conceded: null, saves: null },
  shots: { total: 22 },
  passes: { total: 700, key: 35, accuracy: "80" },
  tackles: { total: 40, interceptions: 15 },
  duels: { total: 90, won: 52 },
};

function makeFromResult(data: unknown[]) {
  const p = Promise.resolve(data) as Promise<unknown[]> & { where: ReturnType<typeof vi.fn> };
  p.where = vi.fn().mockResolvedValue(data);
  return p;
}

// ---------------------------------------------------------------------------
// Helper — inspect delete where-clauses
// ---------------------------------------------------------------------------

/** Returns true if a mock drizzle condition object contains a given string value in any _eq leaf. */
function includesValue(condition: unknown, target: unknown): boolean {
  if (condition == null || typeof condition !== "object") return false;
  const c = condition as Record<string, unknown>;
  if ("_eq" in c) return (c._eq as unknown[]).includes(target);
  if ("_and" in c) return (c._and as unknown[]).some((sub) => includesValue(sub, target));
  return false;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("season history dropdown — partial API gap (accepted behaviour)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedSeasonAllDeletes.length = 0;
    capturedSeasonAllInserts.length = 0;

    mockResolveTeamId.mockResolvedValue(TEAM_ID);
    mockEnsurePlayerApiFootballIds.mockResolvedValue(undefined);

    // DB select sequencing: clubs → players → remaining post-loop selects
    mockDb.select
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([CLUB])) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([PLAYER])) })
      .mockReturnValue({ from: vi.fn().mockReturnValue(makeFromResult([])) });

    // Restore mock implementations after clearAllMocks
    mockDb.delete.mockImplementation((table: unknown) => ({
      where: vi.fn().mockImplementation((condition: unknown) => {
        if (table === tPlayerStats) capturedSeasonAllDeletes.push(condition);
        return Promise.resolve(undefined);
      }),
    }));
    mockDb.insert.mockImplementation((table: unknown) => ({
      values: vi.fn().mockImplementation((data: unknown) => {
        if (table === tPlayerStats) {
          const row = data as Record<string, unknown>;
          if (row.periodType === "season_all") capturedSeasonAllInserts.push(row);
        }
        return Promise.resolve(undefined);
      }),
    }));
    mockDb.update.mockImplementation(() => ({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }));

    // API mock:
    //   - 2026 season → valid stat block (new season underway)
    //   - 2025 season → empty (transient gap simulating a 5xx on that year's endpoint)
    //   - 2024 season → empty
    //   Everything else (injuries, fixtures) → empty
    mockAfFetch.mockImplementation(async (path: string) => {
      if (path === `/players?id=${PLAYER_API_ID}&season=2026`) {
        return [{ player: { id: PLAYER_API_ID, birth: { date: "1998-06-15" } }, statistics: [STAT_BLOCK_2026] }];
      }
      if (path.startsWith(`/players?id=${PLAYER_API_ID}`)) {
        // Covers 2025 and 2024 — simulate empty / transient gap
        return [];
      }
      if (path.startsWith(`/injuries?team=${USA_NATIONAL_TEAM_ID}`)) return [];
      if (path.startsWith(`/injuries?team=${TEAM_ID}`)) return [];
      if (path.startsWith("/fixtures?team=")) return [];
      return [];
    });
  });

  it("(accepted behaviour) when 2025 returns no API data, the season_all bucket is fully wiped and only 2026 is re-inserted", async () => {
    await syncPlayerStatsAndInjuries(0);

    // The full season_all bucket must have been deleted (delete-then-insert strategy).
    const seasonAllWiped = capturedSeasonAllDeletes.some((cond) =>
      includesValue(cond, "season_all"),
    );
    expect(
      seasonAllWiped,
      "db.delete(playerStatsTable) must fire with periodType='season_all' to wipe the prior bucket",
    ).toBe(true);

    // Only the 2026 row is re-inserted — the transient gap for 2025 means it is gone.
    expect(
      capturedSeasonAllInserts,
      "exactly one season_all row should be inserted (2026 only; 2025 had no API data)",
    ).toHaveLength(1);

    expect(
      capturedSeasonAllInserts[0].season,
      "the surviving season_all row must be for 2026",
    ).toBe("2026");
  });

  it("(accepted behaviour) no season_all row is inserted for the gap year (2025 absent from dropdown)", async () => {
    await syncPlayerStatsAndInjuries(0);

    const has2025Insert = capturedSeasonAllInserts.some((row) => row.season === "2025");
    expect(
      has2025Insert,
      // This is a documentation assertion — the failing case would mean additive behaviour was introduced.
      "season_all for 2025 must NOT be inserted when that year's API response was empty " +
        "(accepted behaviour: delete-then-insert wipes gap years from the dropdown)",
    ).toBe(false);
  });

  it("sync completes without error and reports zero failures", async () => {
    const result = await syncPlayerStatsAndInjuries(0);
    expect(result.failures).toBe(0);
    expect(result.clubsProcessed).toBe(1);
  });
});
