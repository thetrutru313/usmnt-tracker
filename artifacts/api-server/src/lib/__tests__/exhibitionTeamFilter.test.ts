/**
 * Regression guard: confirms that syncPlayerClubs rejects exhibition/All-Star
 * team names from the transfer pipeline before they can overwrite a player's
 * real club.
 *
 * Scenario: the newest transfer entry is "MLS All Stars" (an All-Star Game
 * event squad); an older entry is a real club move. The player's club_id must
 * be set to the real club, not the All-Star entry, and a warning must be logged.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

const {
  mockDb,
  tClubs,
  tPlayers,
  tTransfers,
  mockAfFetch,
  mockEnsureClubForTeam,
  mockLogger,
  capturedInsertTables,
  capturedInsertValues,
  onConflictDoNothingMock,
  capturedUpdateSets,
} = vi.hoisted(() => {
  const tClubs = { _table: "clubs" };
  const tPlayers = { _table: "players" };
  const tTransfers = { _table: "transfers" };

  const capturedInsertTables: unknown[] = [];
  const capturedInsertValues: unknown[] = [];
  const capturedUpdateSets: unknown[] = [];
  const onConflictDoNothingMock = vi.fn().mockReturnValue({
    returning: vi.fn().mockResolvedValue([{ id: 1 }]),
  });

  const mockDb = {
    select: vi.fn(),
    insert: vi.fn().mockImplementation((table: unknown) => ({
      values: vi.fn().mockImplementation((vals: unknown) => {
        capturedInsertTables.push(table);
        capturedInsertValues.push(vals);
        return { onConflictDoNothing: onConflictDoNothingMock };
      }),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((vals: unknown) => {
        capturedUpdateSets.push(vals);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
    delete: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
  };

  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  return {
    mockDb,
    tClubs,
    tPlayers,
    tTransfers,
    mockAfFetch: vi.fn(),
    mockEnsureClubForTeam: vi.fn(),
    mockLogger,
    capturedInsertTables,
    capturedInsertValues,
    capturedUpdateSets,
    onConflictDoNothingMock,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: mockDb,
  clubsTable: tClubs,
  playersTable: tPlayers,
  transfersTable: tTransfers,
}));

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, val: unknown) => ({ _eq: [_col, val] }),
  inArray: (_col: unknown, vals: unknown) => ({ _inArray: [_col, vals] }),
  sql: Object.assign(
    (..._args: unknown[]) => ({ _sql: true }),
    { raw: (..._args: unknown[]) => ({ _sql: true }) },
  ),
}));

vi.mock("../apiFootballSync.js", () => ({
  afFetch: mockAfFetch,
  ensureClubForTeam: mockEnsureClubForTeam,
  syncApiFootballFixtures: vi.fn().mockResolvedValue({
    clubsSynced: 0,
    fixturesUpserted: 0,
    fixturesReconciled: 0,
    fixturesRemoved: 0,
    failures: 0,
  }),
}));

vi.mock("../logger.js", () => ({
  logger: mockLogger,
}));

vi.mock("../playerDiscovery.js", () => ({
  discoverUSProspects: vi.fn().mockResolvedValue(undefined),
}));

import { syncPlayerClubs } from "../playerClubSync.js";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const REAL_CLUB_API_ID = 200;
const ALL_STAR_API_ID = 9999;

const REAL_CLUB = {
  id: 5,
  name: "Columbus Crew",
  apiFootballTeamId: REAL_CLUB_API_ID,
  country: "USA",
};
const OLD_CLUB = {
  id: 1,
  name: "Old Club FC",
  apiFootballTeamId: 100,
  country: "USA",
};
// Exhibition club that IS already in the DB (the scenario this bug was reported for).
const TRACKED_ALL_STAR_CLUB = {
  id: 88,
  name: "MLS All Stars",
  apiFootballTeamId: ALL_STAR_API_ID,
  country: "USA",
};

const PLAYER = {
  id: 20,
  name: "Sebastian Berhalter",
  clubId: OLD_CLUB.id,
  apiFootballPlayerId: 77,
  age: 22,
};

/** Response where the NEWEST transfer is to "MLS All Stars" and an older one
 *  is to a real tracked club (Columbus Crew). */
const ALL_STAR_THEN_REAL_RESPONSE: unknown[] = [
  {
    transfers: [
      {
        // Newer date — All-Star Game event entry
        date: "2026-07-20",
        type: "Temporary",
        teams: {
          in: { id: ALL_STAR_API_ID, name: "MLS All Stars", logo: null },
          out: { id: REAL_CLUB_API_ID, name: REAL_CLUB.name, logo: null },
        },
      },
      {
        // Older date — real permanent transfer to Columbus Crew
        date: "2026-01-15",
        type: "Permanent",
        teams: {
          in: { id: REAL_CLUB_API_ID, name: REAL_CLUB.name, logo: null },
          out: { id: OLD_CLUB.apiFootballTeamId, name: OLD_CLUB.name, logo: null },
        },
      },
    ],
  },
];

function makeSelectResult(rows: unknown[]) {
  const fromResult = Object.assign(Promise.resolve(rows), {
    where: vi.fn().mockResolvedValue(rows),
  });
  return { from: vi.fn().mockReturnValue(fromResult) };
}

function seedDb() {
  mockDb.select
    .mockReturnValueOnce(makeSelectResult([PLAYER]))               // players
    .mockReturnValueOnce(makeSelectResult([OLD_CLUB, REAL_CLUB])); // clubs
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("transfer sync — exhibition/All-Star team filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedInsertTables.length = 0;
    capturedInsertValues.length = 0;
    capturedUpdateSets.length = 0;
    onConflictDoNothingMock.mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 1 }]),
    });
    mockDb.insert.mockImplementation((table: unknown) => ({
      values: vi.fn().mockImplementation((vals: unknown) => {
        capturedInsertTables.push(table);
        capturedInsertValues.push(vals);
        return { onConflictDoNothing: onConflictDoNothingMock };
      }),
    }));
    mockDb.update.mockImplementation(() => ({
      set: vi.fn().mockImplementation((vals: unknown) => {
        capturedUpdateSets.push(vals);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    }));
    mockDb.delete.mockImplementation(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    }));
    mockAfFetch.mockResolvedValue(ALL_STAR_THEN_REAL_RESPONSE);
  });

  it("sets club_id to the real club, not the All-Star entry", async () => {
    seedDb();
    await syncPlayerClubs();

    // At least one update should target the real club's id.
    const clubIdUpdates = capturedUpdateSets.filter(
      (s) => typeof s === "object" && s !== null && "clubId" in (s as Record<string, unknown>),
    ) as Array<{ clubId: number }>;

    expect(
      clubIdUpdates.some((u) => u.clubId === REAL_CLUB.id),
      "expected players.club_id to be updated to the real club (Columbus Crew)",
    ).toBe(true);

    expect(
      clubIdUpdates.some((u) => u.clubId === ALL_STAR_API_ID),
      "players.club_id must NOT be set to the All-Star API team id",
    ).toBe(false);
  });

  it("logs a warning when the All-Star transfer entry is skipped", async () => {
    seedDb();
    await syncPlayerClubs();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ player: PLAYER.name, teamName: "MLS All Stars" }),
      expect.stringContaining("exhibition/All-Star"),
    );
  });

  it("does not call ensureClubForTeam for the All-Star team", async () => {
    seedDb();
    await syncPlayerClubs();

    // ensureClubForTeam must never be called with the All-Star team id.
    const callArgs = mockEnsureClubForTeam.mock.calls;
    const allStarCall = callArgs.find((args) => args[0] === ALL_STAR_API_ID);
    expect(allStarCall).toBeUndefined();
  });

  it("inserts a transfer row pointing to the real club", async () => {
    seedDb();
    await syncPlayerClubs();

    const transferInserts = capturedInsertTables.filter((t) => t === tTransfers);
    expect(transferInserts.length, "expected exactly one transfer insert").toBe(1);

    const idx = capturedInsertTables.indexOf(tTransfers);
    const vals = capturedInsertValues[idx] as Record<string, unknown>;
    expect(vals.toClub).toBe(REAL_CLUB.name);
    expect(vals.fromClub).toBe(OLD_CLUB.name);
  });

  it.each([
    ["all-star", "Western Conference All-Stars"],
    ["all star", "MLS All Star Game"],
    ["allstar", "Bundesliga Allstar XI"],
  ])("blocks a dated destination named %s (%s)", async (_pattern, teamName) => {
    mockAfFetch.mockResolvedValue([
      {
        transfers: [
          {
            date: "2026-07-20",
            type: "Temporary",
            teams: {
              in: { id: 8888, name: teamName, logo: null },
              out: { id: OLD_CLUB.apiFootballTeamId, name: OLD_CLUB.name, logo: null },
            },
          },
        ],
      },
    ]);

    mockDb.select
      .mockReturnValueOnce(makeSelectResult([PLAYER]))
      .mockReturnValueOnce(makeSelectResult([OLD_CLUB]));

    await syncPlayerClubs();

    // No transfer insert, no ensureClubForTeam.
    expect(capturedInsertTables.filter((t) => t === tTransfers).length).toBe(0);
    expect(mockEnsureClubForTeam).not.toHaveBeenCalled();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ teamName }),
      expect.stringContaining("exhibition/All-Star"),
    );
  });

  it("blocks a null-date All-Star destination (freshly announced event entry)", async () => {
    // null-date entries sort to the front (treated as most recent). Without the
    // exhibition check running before the null-date early return, this entry
    // would bypass the filter entirely and overwrite the player's club.
    mockAfFetch.mockResolvedValue([
      {
        transfers: [
          {
            date: null, // no confirmed date — freshly announced
            type: "Temporary",
            teams: {
              in: { id: ALL_STAR_API_ID, name: "MLS All Stars", logo: null },
              out: { id: REAL_CLUB_API_ID, name: REAL_CLUB.name, logo: null },
            },
          },
          {
            date: "2026-01-15",
            type: "Permanent",
            teams: {
              in: { id: REAL_CLUB_API_ID, name: REAL_CLUB.name, logo: null },
              out: { id: OLD_CLUB.apiFootballTeamId, name: OLD_CLUB.name, logo: null },
            },
          },
        ],
      },
    ]);

    mockDb.select
      .mockReturnValueOnce(makeSelectResult([PLAYER]))
      .mockReturnValueOnce(makeSelectResult([OLD_CLUB, REAL_CLUB]));

    await syncPlayerClubs();

    // Warning must be logged for the null-date All-Star entry.
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ player: PLAYER.name, teamName: "MLS All Stars" }),
      expect.stringContaining("exhibition/All-Star"),
    );

    // The real club transfer should still be processed.
    const clubIdUpdates = capturedUpdateSets.filter(
      (s) => typeof s === "object" && s !== null && "clubId" in (s as Record<string, unknown>),
    ) as Array<{ clubId: number }>;
    expect(clubIdUpdates.some((u) => u.clubId === REAL_CLUB.id)).toBe(true);
  });

  it("blocks an already-tracked exhibition destination (club exists in DB)", async () => {
    // This is the exact Sebastian Berhalter scenario: MLS All Stars is already
    // a tracked club row in our DB (auto-created by a previous sync run).
    // The filter must still reject it before we look up the club by api id.
    mockAfFetch.mockResolvedValue([
      {
        transfers: [
          {
            date: "2026-07-20",
            type: "Temporary",
            teams: {
              in: { id: ALL_STAR_API_ID, name: "MLS All Stars", logo: null },
              out: { id: REAL_CLUB_API_ID, name: REAL_CLUB.name, logo: null },
            },
          },
          {
            date: "2026-01-15",
            type: "Permanent",
            teams: {
              in: { id: REAL_CLUB_API_ID, name: REAL_CLUB.name, logo: null },
              out: { id: OLD_CLUB.apiFootballTeamId, name: OLD_CLUB.name, logo: null },
            },
          },
        ],
      },
    ]);

    // Include TRACKED_ALL_STAR_CLUB in the clubs list — it's already in the DB.
    mockDb.select
      .mockReturnValueOnce(makeSelectResult([PLAYER]))
      .mockReturnValueOnce(makeSelectResult([OLD_CLUB, REAL_CLUB, TRACKED_ALL_STAR_CLUB]));

    await syncPlayerClubs();

    // club_id must not be updated to the All-Star club.
    const clubIdUpdates = capturedUpdateSets.filter(
      (s) => typeof s === "object" && s !== null && "clubId" in (s as Record<string, unknown>),
    ) as Array<{ clubId: number }>;
    expect(
      clubIdUpdates.some((u) => u.clubId === TRACKED_ALL_STAR_CLUB.id),
      "club_id must NOT be set to the already-tracked All-Star club",
    ).toBe(false);

    // The real club transfer must still be processed.
    expect(clubIdUpdates.some((u) => u.clubId === REAL_CLUB.id)).toBe(true);
  });

  it("blocks an All-Star origin team (the out-team is an exhibition squad)", async () => {
    // If the player was listed as coming *from* an All-Star team, the whole
    // transfer entry should be skipped (the origin is suspect data).
    mockAfFetch.mockResolvedValue([
      {
        transfers: [
          {
            date: "2026-07-20",
            type: "Permanent",
            teams: {
              in: { id: REAL_CLUB_API_ID, name: REAL_CLUB.name, logo: null },
              out: { id: ALL_STAR_API_ID, name: "MLS All Stars", logo: null },
            },
          },
        ],
      },
    ]);

    mockDb.select
      .mockReturnValueOnce(makeSelectResult([PLAYER]))
      .mockReturnValueOnce(makeSelectResult([OLD_CLUB, REAL_CLUB]));

    await syncPlayerClubs();

    // Transfer row must not be inserted.
    expect(capturedInsertTables.filter((t) => t === tTransfers).length).toBe(0);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ player: PLAYER.name, teamName: "MLS All Stars" }),
      expect.stringContaining("exhibition/All-Star"),
    );
  });
});
