/**
 * Regression guard: national-team injury entries merge without creating
 * duplicate episodes on repeated syncs.
 *
 * Three test suites:
 *  1. groupInjuryEpisodes unit tests — player in both feeds produces one episode
 *     with the correct match count; two fixtures within 45 days merge into one
 *     episode; same fixture appearing twice (exact duplicate) is irrelevant to
 *     groupInjuryEpisodes itself (dedup happens upstream), but the function
 *     must still produce the right count when called with the deduplicated list.
 *  2. Double-sync stability — running syncPlayerStatsAndInjuries twice writes the
 *     same injury-insert count each time; the delete-before-insert pattern
 *     prevents accumulation.
 *  3. Fixture-less entry — null fixture.date produces a status="active" episode
 *     with matches=0 and the "no matches missed yet" latestUpdate text.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { groupInjuryEpisodes } from "../playerStatsSync.js";

// ---------------------------------------------------------------------------
// Minimal local type that matches AfInjuryEntry (which is not exported)
// ---------------------------------------------------------------------------
type InjuryEntry = {
  player: { id: number; name: string; type: string; reason: string };
  fixture: { id: number; date: string | null };
  team: { id: number; name: string };
  league: { season: number };
};

function makeEntry(overrides: {
  playerId?: number;
  reason?: string;
  fixtureId?: number;
  fixtureDate?: string | null;
  teamId?: number;
}): InjuryEntry {
  return {
    player: { id: overrides.playerId ?? 1, name: "Test Player", type: "Missing Fixture", reason: overrides.reason ?? "Hamstring Injury" },
    fixture: { id: overrides.fixtureId ?? 100, date: overrides.fixtureDate !== undefined ? overrides.fixtureDate : "2026-03-15T15:00:00Z" },
    team: { id: overrides.teamId ?? 42, name: "Test Club FC" },
    league: { season: 2025 },
  };
}

// ---------------------------------------------------------------------------
// Suite 1: groupInjuryEpisodes — episode grouping with merged feeds
// ---------------------------------------------------------------------------

describe("groupInjuryEpisodes — club + national-team entry deduplication", () => {
  const TODAY = "2026-07-15";

  it("two separate fixtures (club + national-team) with same reason within 45 days → one episode, matches=2", () => {
    // Simulates: club feed has fixture 101 (2026-03-10), national-team feed has
    // fixture 102 (2026-04-01). After dedup (no overlap), groupInjuryEpisodes
    // gets both entries and must merge them into a single episode.
    const entries: InjuryEntry[] = [
      makeEntry({ fixtureId: 101, fixtureDate: "2026-03-10T15:00:00Z", reason: "Hamstring Injury" }),
      makeEntry({ fixtureId: 102, fixtureDate: "2026-04-01T15:00:00Z", reason: "Hamstring Injury" }),
    ];
    const episodes = groupInjuryEpisodes(entries as Parameters<typeof groupInjuryEpisodes>[0], TODAY);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].matches).toBe(2);
    expect(episodes[0].reason).toBe("Hamstring Injury");
  });

  it("single fixture that appears in both club and national-team feeds (exact duplicate) — deduplicated before calling groupInjuryEpisodes → one episode, matches=1", () => {
    // Upstream dedup (the Set in syncClubInjuries) removes the duplicate before
    // calling groupInjuryEpisodes. This test verifies that groupInjuryEpisodes
    // correctly counts one match when given one entry.
    const entries: InjuryEntry[] = [
      makeEntry({ fixtureId: 100, fixtureDate: "2026-03-15T15:00:00Z", reason: "Hamstring Injury" }),
      // Duplicate removed upstream — only one entry reaches groupInjuryEpisodes
    ];
    const episodes = groupInjuryEpisodes(entries as Parameters<typeof groupInjuryEpisodes>[0], TODAY);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].matches).toBe(1);
  });

  it("two fixtures > 45 days apart with same reason → two separate episodes", () => {
    const entries: InjuryEntry[] = [
      makeEntry({ fixtureId: 101, fixtureDate: "2025-09-01T15:00:00Z", reason: "Hamstring Injury" }),
      makeEntry({ fixtureId: 102, fixtureDate: "2026-03-01T15:00:00Z", reason: "Hamstring Injury" }),
    ];
    const episodes = groupInjuryEpisodes(entries as Parameters<typeof groupInjuryEpisodes>[0], TODAY);
    expect(episodes).toHaveLength(2);
    expect(episodes[0].matches).toBe(1);
    expect(episodes[1].matches).toBe(1);
  });

  it("fixtures with different reasons → two separate episodes even if dates are close", () => {
    const entries: InjuryEntry[] = [
      makeEntry({ fixtureId: 101, fixtureDate: "2026-03-10T15:00:00Z", reason: "Hamstring Injury" }),
      makeEntry({ fixtureId: 102, fixtureDate: "2026-03-15T15:00:00Z", reason: "Knee Injury" }),
    ];
    const episodes = groupInjuryEpisodes(entries as Parameters<typeof groupInjuryEpisodes>[0], TODAY);
    expect(episodes).toHaveLength(2);
  });

  it("suspension entries are excluded — only genuine injuries reach episode grouping", () => {
    const entries: InjuryEntry[] = [
      makeEntry({ fixtureId: 101, fixtureDate: "2026-03-10T15:00:00Z", reason: "Yellow Cards" }), // suspension
      makeEntry({ fixtureId: 102, fixtureDate: "2026-03-15T15:00:00Z", reason: "Hamstring Injury" }),
    ];
    const episodes = groupInjuryEpisodes(entries as Parameters<typeof groupInjuryEpisodes>[0], TODAY);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].reason).toBe("Hamstring Injury");
  });

  it("fixture-less entry → one episode with matches=0 and hasFixturelessEntry=true", () => {
    const entries: InjuryEntry[] = [
      makeEntry({ fixtureId: 0, fixtureDate: null, reason: "Hamstring Injury" }),
    ];
    const episodes = groupInjuryEpisodes(entries as Parameters<typeof groupInjuryEpisodes>[0], TODAY);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].matches).toBe(0);
    expect(episodes[0].hasFixturelessEntry).toBe(true);
    // Null fixture.date maps to today — episode start/end should equal TODAY
    expect(episodes[0].start).toBe(TODAY);
    expect(episodes[0].end).toBe(TODAY);
  });

  it("fixture-less entry combined with a real fixture → one episode, matches=1, hasFixturelessEntry=true", () => {
    const entries: InjuryEntry[] = [
      makeEntry({ fixtureId: 101, fixtureDate: "2026-06-20T15:00:00Z", reason: "Knee Injury" }),
      makeEntry({ fixtureId: 0, fixtureDate: null, reason: "Knee Injury" }), // active, no fixture yet
    ];
    const episodes = groupInjuryEpisodes(entries as Parameters<typeof groupInjuryEpisodes>[0], TODAY);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].matches).toBe(1);
    expect(episodes[0].hasFixturelessEntry).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite 2 & 3: Full-sync integration via syncPlayerStatsAndInjuries
// ---------------------------------------------------------------------------

const USA_NATIONAL_TEAM_ID = 2384;
const TEAM_ID = 42;
const PLAYER_API_ID = 99;

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

const CLUB = { id: 1, name: "Test Club FC", apiFootballTeamId: TEAM_ID };
const PLAYER = {
  id: 10,
  name: "Test Player",
  clubId: 1,
  apiFootballPlayerId: PLAYER_API_ID,
  age: 25,
  category: "core",
  nationalTeamCaps: 10,
  marketValueUsd: 5_000_000,
};

/** The one national-team injury entry used across Suite 2 and 3 tests. */
const NATIONAL_TEAM_ENTRY: InjuryEntry = makeEntry({
  playerId: PLAYER_API_ID,
  fixtureId: 200,
  fixtureDate: "2026-03-15T15:00:00Z",
  reason: "Hamstring Injury",
  teamId: USA_NATIONAL_TEAM_ID,
});

/** Fixture-less national-team entry (active, no fixture assigned yet). */
const FIXTURELESS_ENTRY: InjuryEntry = makeEntry({
  playerId: PLAYER_API_ID,
  fixtureId: 0,
  fixtureDate: null,
  reason: "Hamstring Injury",
  teamId: USA_NATIONAL_TEAM_ID,
});

function makeFromResult(data: unknown[]) {
  const p = Promise.resolve(data) as Promise<unknown[]> & { where: ReturnType<typeof vi.fn> };
  p.where = vi.fn().mockResolvedValue(data);
  return p;
}

/** Count how many db.insert(tInjuries).values() calls were made since last clearAllMocks(). */
function countInjuryInserts(): number {
  let count = 0;
  for (let i = 0; i < mockDb.insert.mock.calls.length; i++) {
    const [tableArg] = mockDb.insert.mock.calls[i];
    if (tableArg !== tInjuries) continue;
    const chain = mockDb.insert.mock.results[i]?.value as { values: ReturnType<typeof vi.fn> } | undefined;
    if (!chain?.values) continue;
    count += chain.values.mock.calls.length;
  }
  return count;
}

/** Collect all injury payloads inserted since last clearAllMocks(). */
function collectInjuryInsertPayloads(): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < mockDb.insert.mock.calls.length; i++) {
    const [tableArg] = mockDb.insert.mock.calls[i];
    if (tableArg !== tInjuries) continue;
    const chain = mockDb.insert.mock.results[i]?.value as { values: ReturnType<typeof vi.fn> } | undefined;
    if (!chain?.values) continue;
    for (const [payload] of chain.values.mock.calls) {
      rows.push(payload as Record<string, unknown>);
    }
  }
  return rows;
}

function setupDbMocks() {
  mockDb.select
    .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([CLUB])) })
    .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([PLAYER])) })
    .mockReturnValue({ from: vi.fn().mockReturnValue(makeFromResult([])) });

  mockDb.delete.mockImplementation(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
  mockDb.insert.mockImplementation(() => ({ values: vi.fn().mockResolvedValue(undefined) }));
  mockDb.update.mockImplementation(() => ({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  }));
}

// ---------------------------------------------------------------------------
// Suite 2: Double-sync stability — repeated runs write the same episode count
// ---------------------------------------------------------------------------

describe("syncPlayerStatsAndInjuries — double-sync does not accumulate injury episodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveTeamId.mockResolvedValue(TEAM_ID);
    mockEnsurePlayerApiFootballIds.mockResolvedValue(undefined);
  });

  it("injury insert count after run 2 equals run 1 (delete-before-insert is idempotent)", async () => {
    // Run 1
    setupDbMocks();
    mockAfFetch.mockImplementation(async (path: string) => {
      if (path.includes(`/injuries?team=${USA_NATIONAL_TEAM_ID}`)) return [NATIONAL_TEAM_ENTRY];
      if (path.includes(`/injuries?team=${TEAM_ID}`)) return []; // no club-side duplicates
      if (path.startsWith("/fixtures?team=")) return []; // skip match log processing
      return [];
    });
    await syncPlayerStatsAndInjuries(0);
    const countAfterRun1 = countInjuryInserts();

    // Run 2 — same entries, fresh mock counts
    vi.clearAllMocks();
    mockResolveTeamId.mockResolvedValue(TEAM_ID);
    mockEnsurePlayerApiFootballIds.mockResolvedValue(undefined);
    setupDbMocks();
    mockAfFetch.mockImplementation(async (path: string) => {
      if (path.includes(`/injuries?team=${USA_NATIONAL_TEAM_ID}`)) return [NATIONAL_TEAM_ENTRY];
      if (path.includes(`/injuries?team=${TEAM_ID}`)) return [];
      if (path.startsWith("/fixtures?team=")) return [];
      return [];
    });
    await syncPlayerStatsAndInjuries(0);
    const countAfterRun2 = countInjuryInserts();

    // Both runs must write the same number of rows — not doubled.
    expect(countAfterRun1).toBe(1);
    expect(countAfterRun2).toBe(countAfterRun1);
  });

  it("club + national-team entries for the same fixture are deduplicated — still exactly one episode", async () => {
    setupDbMocks();
    // Same fixture id (200) in both club and national-team feeds — upstream dedup
    // inside syncClubInjuries must discard the duplicate, leaving one episode.
    const CLUB_DUPLICATE_ENTRY: InjuryEntry = {
      ...NATIONAL_TEAM_ENTRY,
      team: { id: TEAM_ID, name: "Test Club FC" },
    };
    mockAfFetch.mockImplementation(async (path: string) => {
      if (path.includes(`/injuries?team=${USA_NATIONAL_TEAM_ID}`)) return [NATIONAL_TEAM_ENTRY];
      if (path.includes(`/injuries?team=${TEAM_ID}`)) return [CLUB_DUPLICATE_ENTRY]; // exact dup
      if (path.startsWith("/fixtures?team=")) return [];
      return [];
    });

    await syncPlayerStatsAndInjuries(0);

    // One episode, not two
    expect(countInjuryInserts()).toBe(1);
  });

  it("two distinct fixtures (club + national-team, same reason, ≤ 45 days apart) → merged into one episode", async () => {
    setupDbMocks();
    const CLUB_ENTRY: InjuryEntry = makeEntry({
      playerId: PLAYER_API_ID,
      fixtureId: 201, // different fixture id
      fixtureDate: "2026-04-01T15:00:00Z",
      reason: "Hamstring Injury",
      teamId: TEAM_ID,
    });
    mockAfFetch.mockImplementation(async (path: string) => {
      if (path.includes(`/injuries?team=${USA_NATIONAL_TEAM_ID}`)) return [NATIONAL_TEAM_ENTRY];
      if (path.includes(`/injuries?team=${TEAM_ID}`)) return [CLUB_ENTRY];
      if (path.startsWith("/fixtures?team=")) return [];
      return [];
    });

    await syncPlayerStatsAndInjuries(0);

    // Two entries, same reason, within 45 days → groupInjuryEpisodes merges into 1 episode
    expect(countInjuryInserts()).toBe(1);
    const [row] = collectInjuryInsertPayloads();
    expect(row.matchesMissed).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Fixture-less entry — status, matchesMissed, and latestUpdate text
// ---------------------------------------------------------------------------

describe("syncPlayerStatsAndInjuries — fixture-less entry produces correct episode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveTeamId.mockResolvedValue(TEAM_ID);
    mockEnsurePlayerApiFootballIds.mockResolvedValue(undefined);
  });

  it("fixture-less national-team entry writes status='active' with matchesMissed=0", async () => {
    setupDbMocks();
    mockAfFetch.mockImplementation(async (path: string) => {
      if (path.includes(`/injuries?team=${USA_NATIONAL_TEAM_ID}`)) return [FIXTURELESS_ENTRY];
      if (path.startsWith("/fixtures?team=")) return [];
      return [];
    });

    await syncPlayerStatsAndInjuries(0);

    const rows = collectInjuryInsertPayloads();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("active");
    expect(rows[0].matchesMissed).toBe(0);
  });

  it("fixture-less entry latestUpdate contains 'no matches missed yet'", async () => {
    setupDbMocks();
    mockAfFetch.mockImplementation(async (path: string) => {
      if (path.includes(`/injuries?team=${USA_NATIONAL_TEAM_ID}`)) return [FIXTURELESS_ENTRY];
      if (path.startsWith("/fixtures?team=")) return [];
      return [];
    });

    await syncPlayerStatsAndInjuries(0);

    const rows = collectInjuryInsertPayloads();
    expect(rows).toHaveLength(1);
    expect(rows[0].latestUpdate).toMatch(/no matches missed yet/i);
  });

  it("fixture-less entry latestUpdate includes the injury reason", async () => {
    setupDbMocks();
    mockAfFetch.mockImplementation(async (path: string) => {
      if (path.includes(`/injuries?team=${USA_NATIONAL_TEAM_ID}`)) return [FIXTURELESS_ENTRY];
      if (path.startsWith("/fixtures?team=")) return [];
      return [];
    });

    await syncPlayerStatsAndInjuries(0);

    const rows = collectInjuryInsertPayloads();
    expect(String(rows[0].latestUpdate)).toContain("Hamstring Injury");
  });

  it("fixture-less entry produces exactly one episode (not duplicated by multiple season fetches)", async () => {
    setupDbMocks();
    // seasonYearCandidates() returns 3 years; the national-team fetch loops over
    // all three. A fixture-less entry has no fixture id, so its dedup key is
    // `nofix:<playerId>:<reason>:<date>`. All three season responses return the
    // same entry — the Set must discard duplicates, leaving one episode.
    mockAfFetch.mockImplementation(async (path: string) => {
      if (path.includes(`/injuries?team=${USA_NATIONAL_TEAM_ID}`)) return [FIXTURELESS_ENTRY];
      if (path.startsWith("/fixtures?team=")) return [];
      return [];
    });

    await syncPlayerStatsAndInjuries(0);

    expect(countInjuryInserts()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Suite 4: Two players injured in the same fixture each get their own episode
// ---------------------------------------------------------------------------
//
// The dedup key is `fix:<playerId>:<fixtureId>`. If it were simplified to just
// `fix:<fixtureId>` (dropping the player id) the second player's entry would
// be discarded by the Set, giving player B zero episodes and player A a
// matches=1 episode — silently wrong. This suite guards that regression.

const PLAYER_A_API_ID = 201;
const PLAYER_B_API_ID = 202;
const SHARED_FIXTURE_ID = 500;

const PLAYER_A = {
  id: 20,
  name: "Player A",
  clubId: 1,
  apiFootballPlayerId: PLAYER_A_API_ID,
  age: 24,
  category: "core",
  nationalTeamCaps: 8,
  marketValueUsd: 4_000_000,
};
const PLAYER_B = {
  id: 21,
  name: "Player B",
  clubId: 1,
  apiFootballPlayerId: PLAYER_B_API_ID,
  age: 26,
  category: "core",
  nationalTeamCaps: 12,
  marketValueUsd: 6_000_000,
};

describe("syncPlayerStatsAndInjuries — two players injured in the same fixture each get their own episode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveTeamId.mockResolvedValue(TEAM_ID);
    mockEnsurePlayerApiFootballIds.mockResolvedValue(undefined);
  });

  function setupTwoPlayerDbMocks() {
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

  it("both players get exactly one episode each (not conflated by the shared fixture id)", async () => {
    setupTwoPlayerDbMocks();

    const ENTRY_A: InjuryEntry = makeEntry({
      playerId: PLAYER_A_API_ID,
      fixtureId: SHARED_FIXTURE_ID,
      fixtureDate: "2026-05-10T15:00:00Z",
      reason: "Hamstring Injury",
      teamId: USA_NATIONAL_TEAM_ID,
    });
    const ENTRY_B: InjuryEntry = makeEntry({
      playerId: PLAYER_B_API_ID,
      fixtureId: SHARED_FIXTURE_ID,
      fixtureDate: "2026-05-10T15:00:00Z",
      reason: "Knee Injury",
      teamId: USA_NATIONAL_TEAM_ID,
    });

    mockAfFetch.mockImplementation(async (path: string) => {
      if (path.includes(`/injuries?team=${USA_NATIONAL_TEAM_ID}`)) return [ENTRY_A, ENTRY_B];
      if (path.includes(`/injuries?team=${TEAM_ID}`)) return [];
      if (path.startsWith("/fixtures?team=")) return [];
      return [];
    });

    await syncPlayerStatsAndInjuries(0);

    // Each player must have exactly one injury episode written — total = 2.
    expect(countInjuryInserts()).toBe(2);
  });

  it("each player's episode has matches=1 (not one getting matches=2 and the other nothing)", async () => {
    setupTwoPlayerDbMocks();

    const ENTRY_A: InjuryEntry = makeEntry({
      playerId: PLAYER_A_API_ID,
      fixtureId: SHARED_FIXTURE_ID,
      fixtureDate: "2026-05-10T15:00:00Z",
      reason: "Hamstring Injury",
      teamId: USA_NATIONAL_TEAM_ID,
    });
    const ENTRY_B: InjuryEntry = makeEntry({
      playerId: PLAYER_B_API_ID,
      fixtureId: SHARED_FIXTURE_ID,
      fixtureDate: "2026-05-10T15:00:00Z",
      reason: "Knee Injury",
      teamId: USA_NATIONAL_TEAM_ID,
    });

    mockAfFetch.mockImplementation(async (path: string) => {
      if (path.includes(`/injuries?team=${USA_NATIONAL_TEAM_ID}`)) return [ENTRY_A, ENTRY_B];
      if (path.includes(`/injuries?team=${TEAM_ID}`)) return [];
      if (path.startsWith("/fixtures?team=")) return [];
      return [];
    });

    await syncPlayerStatsAndInjuries(0);

    const rows = collectInjuryInsertPayloads();
    // Both episodes must report exactly one missed match.
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.matchesMissed).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 5: National-team season fetch partial / total failure
//
// The fetch loop wraps each of the three season calls in a try/catch and
// continues on error. These tests confirm:
//  a) a partial failure (first season succeeds, second and third throw) still
//     surfaces the successful season's entries in the episode grouping, and
//  b) a total failure (all three seasons throw) does NOT throw from
//     syncPlayerStatsAndInjuries itself, writes zero injury rows for the
//     affected player, and does not leave stale rows behind.
// ---------------------------------------------------------------------------

describe("syncPlayerStatsAndInjuries — national-team season fetch failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveTeamId.mockResolvedValue(TEAM_ID);
    mockEnsurePlayerApiFootballIds.mockResolvedValue(undefined);
  });

  it("first season succeeds, second and third throw — successful season's entry still produces one episode", async () => {
    setupDbMocks();

    // seasonYearCandidates() = [2026, 2025, 2024] at test-run time.
    // We match on the full path so we can distinguish seasons.
    let callIndex = 0;
    mockAfFetch.mockImplementation(async (path: string) => {
      if (path.includes(`/injuries?team=${USA_NATIONAL_TEAM_ID}`)) {
        // First call succeeds; subsequent calls throw
        if (callIndex++ === 0) return [NATIONAL_TEAM_ENTRY];
        throw new Error("Simulated API failure");
      }
      if (path.startsWith("/fixtures?team=")) return [];
      return [];
    });

    // Must not throw — resolves to a stats summary object
    await expect(syncPlayerStatsAndInjuries(0)).resolves.toBeDefined();

    // The one entry from the first season must have been written as an episode
    expect(countInjuryInserts()).toBe(1);
  });

  it("all three season calls throw — sync completes without throwing and writes zero injury rows", async () => {
    setupDbMocks();

    mockAfFetch.mockImplementation(async (path: string) => {
      if (path.includes(`/injuries?team=${USA_NATIONAL_TEAM_ID}`)) {
        throw new Error("Simulated API failure");
      }
      if (path.startsWith("/fixtures?team=")) return [];
      return [];
    });

    // Must not throw — resolves to a stats summary object
    await expect(syncPlayerStatsAndInjuries(0)).resolves.toBeDefined();

    // No national-team entries means no injury episodes should be written
    expect(countInjuryInserts()).toBe(0);
  });
});
