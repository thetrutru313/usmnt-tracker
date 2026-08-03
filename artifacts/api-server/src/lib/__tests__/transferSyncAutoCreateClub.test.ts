/**
 * Regression guard: confirms that syncPlayerClubs auto-creates a missing
 * destination club via ensureClubForTeam instead of silently dropping the
 * transfer.
 *
 * Three paths are verified:
 *  1. Untracked destination → ensureClubForTeam called, transfer inserted.
 *  2. Null teams.in.id     → ensureClubForTeam NOT called, warn logged, transfer skipped.
 *  3. ensureClubForTeam throws → error caught, warn logged, transfer skipped.
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
} = vi.hoisted(() => {
  const tClubs = { _table: "clubs" };
  const tPlayers = { _table: "players" };
  const tTransfers = { _table: "transfers" };

  const capturedInsertTables: unknown[] = [];
  const capturedInsertValues: unknown[] = [];
  const onConflictDoNothingMock = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 1 }]) });

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
      set: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
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
  // syncApiFootballFixtures is dynamically imported after a detected transfer;
  // stub it out so the scoped fixture sync doesn't make real API calls.
  syncApiFootballFixtures: vi.fn().mockResolvedValue({ clubsSynced: 0, fixturesUpserted: 0, fixturesReconciled: 0, fixturesRemoved: 0, failures: 0 }),
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

const OLD_CLUB_API_ID = 301;
const NEW_CLUB_API_ID = 404; // NOT in the clubs table

const OLD_CLUB = { id: 1, name: "Old Club FC", apiFootballTeamId: OLD_CLUB_API_ID, country: "USA" };
// NEW_CLUB is absent from the initial clubs list to simulate the untracked case.
const AUTO_CREATED_CLUB = { id: 99, name: "Middlesbrough" };

const PLAYER = {
  id: 20,
  name: "Sebastian Berhalter",
  clubId: OLD_CLUB.id,
  apiFootballPlayerId: 77,
  age: 22,
};

const TRANSFER_DATE = "2026-06-01";

/** Transfer to a destination club whose apiFootballTeamId is NOT in our clubs table. */
const UNTRACKED_TRANSFER_RESPONSE: unknown[] = [
  {
    transfers: [
      {
        date: TRANSFER_DATE,
        type: "Permanent",
        teams: {
          in: { id: NEW_CLUB_API_ID, name: "Middlesbrough", logo: "http://example.com/logo.png" },
          out: { id: OLD_CLUB_API_ID, name: OLD_CLUB.name, logo: null },
        },
      },
    ],
  },
];

/** Transfer where teams.in.id is null — nothing to look up. */
const NULL_TEAM_ID_RESPONSE: unknown[] = [
  {
    transfers: [
      {
        date: TRANSFER_DATE,
        type: "Permanent",
        teams: {
          in: { id: null, name: "Unknown Club", logo: null },
          out: { id: OLD_CLUB_API_ID, name: OLD_CLUB.name, logo: null },
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

/** Set up db.select to return only old club — new club intentionally absent. */
function seedUntrackedClub() {
  mockDb.select
    .mockReturnValueOnce(makeSelectResult([PLAYER]))    // players
    .mockReturnValueOnce(makeSelectResult([OLD_CLUB])); // clubs (no NEW_CLUB)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("transfer sync — auto-create missing destination club", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedInsertTables.length = 0;
    capturedInsertValues.length = 0;
    onConflictDoNothingMock.mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 1 }]) });

    mockAfFetch.mockResolvedValue(UNTRACKED_TRANSFER_RESPONSE);

    mockDb.insert.mockImplementation((table: unknown) => ({
      values: vi.fn().mockImplementation((vals: unknown) => {
        capturedInsertTables.push(table);
        capturedInsertValues.push(vals);
        return { onConflictDoNothing: onConflictDoNothingMock };
      }),
    }));
    mockDb.update.mockImplementation(() => ({
      set: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    }));
    mockDb.delete.mockImplementation(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    }));
  });

  it("calls ensureClubForTeam with the destination team's id, name and logo when the club is not yet tracked", async () => {
    mockEnsureClubForTeam.mockResolvedValue(AUTO_CREATED_CLUB);
    seedUntrackedClub();

    await syncPlayerClubs();

    expect(mockEnsureClubForTeam).toHaveBeenCalledWith(
      NEW_CLUB_API_ID,
      "Middlesbrough",
      "http://example.com/logo.png",
    );
  });

  it("inserts the transfer row after ensureClubForTeam succeeds", async () => {
    mockEnsureClubForTeam.mockResolvedValue(AUTO_CREATED_CLUB);
    seedUntrackedClub();

    await syncPlayerClubs();

    const transferInserts = capturedInsertTables.filter((t) => t === tTransfers);
    expect(
      transferInserts.length,
      "expected exactly one db.insert(transfersTable) after club auto-creation",
    ).toBe(1);

    const idx = capturedInsertTables.indexOf(tTransfers);
    const vals = capturedInsertValues[idx] as Record<string, unknown>;
    expect(vals.playerId).toBe(PLAYER.id);
    expect(vals.toClub).toBe(AUTO_CREATED_CLUB.name);
    expect(vals.fromClub).toBe(OLD_CLUB.name);
    expect(vals.status).toBe("confirmed");
    expect(vals.announcedAt).toEqual(new Date(TRANSFER_DATE));
  });

  it("skips the transfer and logs a warning when teams.in.id is null", async () => {
    mockAfFetch.mockResolvedValue(NULL_TEAM_ID_RESPONSE);
    mockDb.select
      .mockReturnValueOnce(makeSelectResult([PLAYER]))
      .mockReturnValueOnce(makeSelectResult([OLD_CLUB]));

    await syncPlayerClubs();

    // ensureClubForTeam must NOT be called — there's nothing to look up.
    expect(mockEnsureClubForTeam).not.toHaveBeenCalled();

    // No transfer row should be inserted.
    const transferInserts = capturedInsertTables.filter((t) => t === tTransfers);
    expect(
      transferInserts.length,
      "should not insert a transfer when destination team ID is null",
    ).toBe(0);

    // A warning must be logged.
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ player: PLAYER.name }),
      expect.stringContaining("no destination team ID"),
    );
  });

  it("skips the transfer and logs a warning when ensureClubForTeam throws", async () => {
    mockEnsureClubForTeam.mockRejectedValue(new Error("API error"));
    seedUntrackedClub();

    await syncPlayerClubs();

    // No transfer row should be inserted.
    const transferInserts = capturedInsertTables.filter((t) => t === tTransfers);
    expect(
      transferInserts.length,
      "should not insert a transfer when ensureClubForTeam fails",
    ).toBe(0);

    // A warning must be logged.
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ player: PLAYER.name }),
      expect.stringContaining("Failed to auto-create destination club"),
    );
  });
});
