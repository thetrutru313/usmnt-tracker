/**
 * Regression guard: confirms that running the player-club sync twice in a row
 * with the same API-Football response inserts exactly one row into the
 * transfers table — not two.
 *
 * ## Why this matters
 * `syncPlayerClubs` inserts a transfer row whenever it detects the player's
 * DB club doesn't match `teams.in` from the API.  Before the deduplication
 * fix, nothing prevented a second concurrent or back-to-back sync tick from
 * reading the same stale `clubId` and inserting a duplicate row.
 *
 * ## What is tested
 * 1. Two sequential calls to `syncPlayerClubs` with identical mocked API
 *    data produce exactly one `db.insert(transfersTable)` call — not two.
 * 2. After the first run the player's `clubId` is updated; the second run
 *    detects the club is already current and skips the insert entirely.
 * 3. If the DB update from the first run is not yet visible (concurrent-tick
 *    scenario), the insert uses `onConflictDoNothing` so the DB-level unique
 *    constraint on (player_id, announced_at) prevents the duplicate.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared mock state — hoisted so factories can reference them before vi.mock
// ---------------------------------------------------------------------------

const {
  mockDb,
  tClubs,
  tPlayers,
  tTransfers,
  mockAfFetch,
  capturedInsertTables,
  capturedInsertValues,
  capturedUpdateSets,
  onConflictDoNothingMock,
} = vi.hoisted(() => {
  const tClubs = { _table: "clubs" };
  const tPlayers = { _table: "players" };
  const tTransfers = { _table: "transfers" };

  const capturedInsertTables: unknown[] = [];
  const capturedInsertValues: unknown[] = [];
  const capturedUpdateSets: unknown[] = [];
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
      set: vi.fn().mockImplementation((data: unknown) => {
        capturedUpdateSets.push(data);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
    delete: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
  };

  return {
    mockDb,
    tClubs,
    tPlayers,
    tTransfers,
    mockAfFetch: vi.fn(),
    capturedInsertTables,
    capturedInsertValues,
    capturedUpdateSets,
    onConflictDoNothingMock,
  };
});

// ---------------------------------------------------------------------------
// Module mocks — do NOT mock playerClubSync itself; we test the real function
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
  // sql is imported but only used in the schema file, not in playerClubSync directly
  sql: Object.assign(
    (..._args: unknown[]) => ({ _sql: true }),
    { raw: (..._args: unknown[]) => ({ _sql: true }) },
  ),
}));

vi.mock("../apiFootballSync.js", () => ({
  afFetch: mockAfFetch,
  // ensureClubForTeam is imported by playerClubSync but never called in these
  // tests (the destination club is always pre-seeded in clubsByApiFootballId).
  // We still need to export a stub so the import doesn't resolve to undefined.
  ensureClubForTeam: vi.fn(),
  // syncApiFootballFixtures is dynamically imported after a detected transfer;
  // stub it out so the scoped fixture sync doesn't make real API calls.
  syncApiFootballFixtures: vi.fn().mockResolvedValue({ clubsSynced: 0, fixturesUpserted: 0, fixturesReconciled: 0, fixturesRemoved: 0, failures: 0 }),
}));

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Block the playerDiscovery dynamic import at the end of syncPlayerClubs
vi.mock("../playerDiscovery.js", () => ({
  discoverUSProspects: vi.fn().mockResolvedValue(undefined),
}));

// Import AFTER mocks are registered — use the REAL syncPlayerClubs
import { syncPlayerClubs } from "../playerClubSync.js";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const OLD_CLUB_API_ID = 101;
const NEW_CLUB_API_ID = 202;

const OLD_CLUB = { id: 1, name: "Old Club FC", apiFootballTeamId: OLD_CLUB_API_ID, country: "Germany" };
const NEW_CLUB = { id: 2, name: "New Club FC", apiFootballTeamId: NEW_CLUB_API_ID, country: "Germany" };

/**
 * Player already has apiFootballPlayerId set → ensurePlayerApiFootballIds
 * short-circuits the ID-resolution and squad-lookup paths entirely, making
 * the only afFetch call the one for /transfers.
 */
const PLAYER = {
  id: 10,
  name: "Test Player",
  clubId: OLD_CLUB.id, // currently at old club in the DB
  apiFootballPlayerId: 55,
  age: 23,
};

const TRANSFER_DATE = "2026-01-15";

/** Minimal API-Football /transfers response — player moved to NEW_CLUB. */
const MOCK_TRANSFER_RESPONSE: unknown[] = [
  {
    transfers: [
      {
        date: TRANSFER_DATE,
        type: "Permanent",
        teams: {
          in: { id: NEW_CLUB_API_ID, name: NEW_CLUB.name, logo: null },
          out: { id: OLD_CLUB_API_ID, name: OLD_CLUB.name, logo: null },
        },
      },
    ],
  },
];

/**
 * Build a mock select chain: `.from()` resolves to `rows`, and
 * `.from().where()` also resolves to `rows`.
 */
function makeSelectResult(rows: unknown[]) {
  const fromResult = Object.assign(Promise.resolve(rows), {
    where: vi.fn().mockResolvedValue(rows),
  });
  return { from: vi.fn().mockReturnValue(fromResult) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("transfer sync deduplication — sequential double-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedInsertTables.length = 0;
    capturedInsertValues.length = 0;
    capturedUpdateSets.length = 0;
    onConflictDoNothingMock.mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 1 }]) });

    // afFetch always returns the same transfer response for all URLs.
    // - ensurePlayerApiFootballIds: skips squad/search calls because PLAYER
    //   already has apiFootballPlayerId set (resolvePlayerIdsViaSquads skips
    //   resolved players; applyKnownPlayerIdOverrides skips unknown names).
    //   syncResolvedPlayerPhotos issues a db.update (mocked).
    // - main loop: /transfers?player=55 → MOCK_TRANSFER_RESPONSE
    mockAfFetch.mockResolvedValue(MOCK_TRANSFER_RESPONSE);

    // Restore implementations after clearAllMocks
    mockDb.insert.mockImplementation((table: unknown) => ({
      values: vi.fn().mockImplementation((vals: unknown) => {
        capturedInsertTables.push(table);
        capturedInsertValues.push(vals);
        return { onConflictDoNothing: onConflictDoNothingMock };
      }),
    }));
    mockDb.update.mockImplementation(() => ({
      set: vi.fn().mockImplementation((data: unknown) => {
        capturedUpdateSets.push(data);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    }));
    mockDb.delete.mockImplementation(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    }));
  });

  it("inserts exactly one transfer row even when the sync runs twice in a row", async () => {
    // syncPlayerClubs fetches players FIRST, then clubs (see playerClubSync.ts)
    // First sync: player's clubId is OLD_CLUB → mismatch detected → insert + update
    mockDb.select
      .mockReturnValueOnce(makeSelectResult([PLAYER]))             // players (1st)
      .mockReturnValueOnce(makeSelectResult([OLD_CLUB, NEW_CLUB])) // clubs (1st)

    await syncPlayerClubs();

    // Second sync: simulate the DB having been updated (player now at new club)
    const UPDATED_PLAYER = { ...PLAYER, clubId: NEW_CLUB.id };
    mockDb.select
      .mockReturnValueOnce(makeSelectResult([UPDATED_PLAYER]))     // players (2nd, club updated)
      .mockReturnValueOnce(makeSelectResult([OLD_CLUB, NEW_CLUB])) // clubs (2nd)

    await syncPlayerClubs();

    const transferInserts = capturedInsertTables.filter((t) => t === tTransfers);
    expect(
      transferInserts.length,
      "expected exactly one db.insert(transfersTable) across both sync calls — second call must detect the club is already current and skip",
    ).toBe(1);
  });

  it("inserts the correct player/club data on the first run", async () => {
    mockDb.select
      .mockReturnValueOnce(makeSelectResult([PLAYER]))
      .mockReturnValueOnce(makeSelectResult([OLD_CLUB, NEW_CLUB]));

    await syncPlayerClubs();

    const transferInserts = capturedInsertTables.filter((t) => t === tTransfers);
    expect(transferInserts.length).toBe(1);

    const idx = capturedInsertTables.indexOf(tTransfers);
    const vals = capturedInsertValues[idx] as Record<string, unknown>;

    expect(vals.playerId).toBe(PLAYER.id);
    expect(vals.toClub).toBe(NEW_CLUB.name);
    expect(vals.fromClub).toBe(OLD_CLUB.name);
    expect(vals.status).toBe("confirmed");
    expect(vals.announcedAt).toEqual(new Date(TRANSFER_DATE));
  });

  it("calls onConflictDoNothing on the insert (concurrent-tick guard)", async () => {
    mockDb.select
      .mockReturnValueOnce(makeSelectResult([PLAYER]))
      .mockReturnValueOnce(makeSelectResult([OLD_CLUB, NEW_CLUB]));

    await syncPlayerClubs();

    expect(
      onConflictDoNothingMock,
      "db.insert(transfersTable).values(…).onConflictDoNothing() must be called so a concurrent tick cannot write a duplicate row",
    ).toHaveBeenCalledTimes(1);
  });

  it("skips the insert entirely when the player is already at the correct club", async () => {
    const ALREADY_AT_NEW_CLUB = { ...PLAYER, clubId: NEW_CLUB.id };

    // Both runs see the player already at the new club — no mismatch, no insert
    mockDb.select
      .mockReturnValueOnce(makeSelectResult([ALREADY_AT_NEW_CLUB]))
      .mockReturnValueOnce(makeSelectResult([OLD_CLUB, NEW_CLUB]))
      .mockReturnValueOnce(makeSelectResult([ALREADY_AT_NEW_CLUB]))
      .mockReturnValueOnce(makeSelectResult([OLD_CLUB, NEW_CLUB]));

    await syncPlayerClubs();
    await syncPlayerClubs();

    const transferInserts = capturedInsertTables.filter((t) => t === tTransfers);
    expect(
      transferInserts.length,
      "no insert should occur when the player's club already matches the API response",
    ).toBe(0);
  });
});
