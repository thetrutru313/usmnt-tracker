/**
 * Regression guard: confirms that a null-date transfer row is treated as newer
 * than any dated transfer, so a freshly announced move wins over a stale old
 * club row — the root cause of Sebastian Berhalter showing as a Vancouver
 * Whitecap after transferring away.
 *
 * ## What & Why
 * API-Football logs a transfer before the official date is confirmed. The
 * `/transfers` endpoint returns the new-club row with `date: null`, while the
 * old Vancouver row has a real date. The old sort/filter was:
 *
 *   .filter((t) => t.date && ...) // drops null-date rows entirely
 *
 * …which meant the Vancouver row always won, locking the player at the stale
 * club on every sync. The fix changes the filter to:
 *
 *   .filter((t) => !t.date || new Date(t.date).getTime() <= now)
 *
 * …and sorts null dates to the front (treated as the most recent).
 *
 * ## Test suites
 * 1. Null-date row wins over an older dated row (the Berhalter scenario).
 * 2. Future-dated row is excluded even when there's no null-date alternative.
 * 3. Two dated rows: the newer date still wins (normal case, not regressed).
 * 4. Club override bypasses the transfer API call entirely.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared mock state (vi.hoisted so factories run before vi.mock calls)
// ---------------------------------------------------------------------------

const {
  mockDb,
  tPlayers,
  tClubs,
  tTransfers,
  capturedUpdateSets,
  mockAfFetch,
  mockEnsureClubForTeam,
} = vi.hoisted(() => {
  const tPlayers   = { _table: "players" };
  const tClubs     = { _table: "clubs" };
  const tTransfers = { _table: "transfers" };

  const capturedUpdateSets: Array<Record<string, unknown>> = [];

  const mockDb = {
    // select().from() and select().from().where() both resolve
    select: vi.fn(),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((data: Record<string, unknown>) => {
        capturedUpdateSets.push(data);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation(() => ({
        onConflictDoNothing: vi.fn().mockImplementation(() => ({
          returning: vi.fn().mockResolvedValue([{ id: 999 }]),
        })),
      })),
    })),
    execute: vi.fn().mockResolvedValue({ rowCount: 0 }),
  };

  return {
    mockDb,
    tPlayers,
    tClubs,
    tTransfers,
    capturedUpdateSets,
    mockAfFetch: vi.fn(),
    mockEnsureClubForTeam: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: mockDb,
  playersTable: tPlayers,
  clubsTable: tClubs,
  transfersTable: tTransfers,
  fixturesTable: { _table: "fixtures" },
  fixturePlayersTable: { _table: "fixturePlayersTable" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, val: unknown) => ({ _eq: [_col, val] }),
  and: (...args: unknown[]) => ({ _and: args }),
  inArray: (_col: unknown, vals: unknown) => ({ _inArray: [_col, vals] }),
  isNotNull: (_col: unknown) => ({ _isNotNull: _col }),
  isNull: (_col: unknown) => ({ _isNull: _col }),
  sql: Object.assign(
    (_parts: TemplateStringsArray, ..._vals: unknown[]) => ({ _sql: true }),
    { join: vi.fn(), raw: vi.fn() },
  ),
}));

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../apiFootballSync.js", () => ({
  afFetch: mockAfFetch,
  ensureClubForTeam: mockEnsureClubForTeam,
}));

// Import AFTER mocks
import { syncPlayerClubs } from "../playerClubSync.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAST_ISO   = "2024-06-01";
const FUTURE_ISO = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

/** A minimal club row */
function makeClub(id: number, apiId: number, name: string) {
  return { id, apiFootballTeamId: apiId, name, country: "USA" };
}

/** A minimal player row — apiFootballPlayerId is already resolved */
function makePlayer(
  id: number,
  clubId: number,
  apiPlayerId: number,
  clubOverrideId: number | null = null,
) {
  return {
    id,
    name: `Player ${id}`,
    clubId,
    apiFootballPlayerId: apiPlayerId,
    age: 22,
    clubOverrideId,
  };
}

/** A transfer row with optional null date */
function makeTransfer(
  inId: number,
  inName: string,
  outId: number,
  outName: string,
  date: string | null,
) {
  return {
    date,
    type: "Transfer",
    teams: {
      in:  { id: inId,  name: inName,  logo: null },
      out: { id: outId, name: outName, logo: null },
    },
  };
}

// Shared club/player identifiers
const VANCOUVER_ID  = 100;
const WHITECAPS_API = 555;
const NEW_CLUB_ID   = 200;
const NEW_CLUB_API  = 666;
const NEW_CLUB_NAME = "New Club FC";
const PLAYER_ID     = 1;
const API_PLAYER_ID = 9999;

/**
 * Sets up db.select mock in the correct call order for syncPlayerClubs:
 *   call 1 → players query  (from playersTable)
 *   call 2 → clubs query    (from clubsTable)
 */
function setupSelectMocks(players: object[], clubs: object[]) {
  mockDb.select
    .mockReturnValueOnce({ from: vi.fn().mockReturnValue(Promise.resolve(players)) })
    .mockReturnValueOnce({ from: vi.fn().mockReturnValue(Promise.resolve(clubs)) });
}

// ---------------------------------------------------------------------------
// beforeEach — reset shared state
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  capturedUpdateSets.length = 0;

  mockDb.update.mockImplementation(() => ({
    set: vi.fn().mockImplementation((data: Record<string, unknown>) => {
      capturedUpdateSets.push(data);
      return { where: vi.fn().mockResolvedValue(undefined) };
    }),
  }));
  mockDb.insert.mockImplementation(() => ({
    values: vi.fn().mockImplementation(() => ({
      onConflictDoNothing: vi.fn().mockImplementation(() => ({
        returning: vi.fn().mockResolvedValue([{ id: 999 }]),
      })),
    })),
  }));
  mockDb.execute.mockResolvedValue({ rowCount: 0 });

  // ensureClubForTeam returns the new club by default
  mockEnsureClubForTeam.mockResolvedValue({ id: NEW_CLUB_ID, name: NEW_CLUB_NAME });
});

// ---------------------------------------------------------------------------
// Suite 1: null-date row wins over a dated row
// ---------------------------------------------------------------------------

describe("transfer sort — null-date row wins over an older dated row", () => {
  it("updates club_id to the null-date transfer destination (Berhalter scenario)", async () => {
    // Both clubs tracked — so no ensureClubForTeam call needed (found via apiFootballTeamId).
    const clubs   = [
      makeClub(VANCOUVER_ID, WHITECAPS_API, "Vancouver Whitecaps"),
      makeClub(NEW_CLUB_ID,  NEW_CLUB_API,  NEW_CLUB_NAME),
    ];
    const players = [makePlayer(PLAYER_ID, VANCOUVER_ID, API_PLAYER_ID)];

    // Players selected FIRST, clubs SECOND — matches syncPlayerClubs() call order.
    setupSelectMocks(players, clubs);

    // One afFetch call: /transfers (player already has apiFootballPlayerId → no squad lookup)
    mockAfFetch.mockResolvedValueOnce([
      {
        player: { id: API_PLAYER_ID, name: "Sebastian Berhalter" },
        transfers: [
          makeTransfer(NEW_CLUB_API, NEW_CLUB_NAME, WHITECAPS_API, "Vancouver Whitecaps", null),     // null-date → NEW club (should win)
          makeTransfer(WHITECAPS_API, "Vancouver Whitecaps", 999, "Previous Club", PAST_ISO),         // dated → old club
        ],
      },
    ]);

    await syncPlayerClubs();

    // The null-date row wins → club_id updated to NEW_CLUB_ID (200)
    const clubUpdate = capturedUpdateSets.find((s) => s.clubId === NEW_CLUB_ID);
    expect(
      clubUpdate,
      [
        "Expected club_id to be updated to the null-date transfer destination (NEW_CLUB_ID=200).",
        "This is the Berhalter fix: null-date rows must win over dated rows.",
        "Captured set() payloads:",
        ...capturedUpdateSets.map((s) => `  • ${JSON.stringify(s)}`),
      ].join("\n"),
    ).toBeDefined();

    // Must NOT have updated to the old Vancouver club id
    const staleUpdate = capturedUpdateSets.find(
      (s) => s.clubId === VANCOUVER_ID,
    );
    expect(
      staleUpdate,
      "club_id must not regress to the stale Vancouver club (VANCOUVER_ID=100).",
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: future-dated row is excluded
// ---------------------------------------------------------------------------

describe("transfer sort — future-dated row is excluded", () => {
  it("leaves club_id unchanged when the only new-club transfer is future-dated", async () => {
    const clubs   = [makeClub(VANCOUVER_ID, WHITECAPS_API, "Vancouver Whitecaps")];
    const players = [makePlayer(PLAYER_ID, VANCOUVER_ID, API_PLAYER_ID)];

    setupSelectMocks(players, clubs);

    // Only one transfer row — future-dated, should be filtered out.
    mockAfFetch.mockResolvedValueOnce([
      {
        player: { id: API_PLAYER_ID, name: "Player" },
        transfers: [
          makeTransfer(NEW_CLUB_API, NEW_CLUB_NAME, WHITECAPS_API, "Vancouver Whitecaps", FUTURE_ISO),
        ],
      },
    ]);

    await syncPlayerClubs();

    // Future row excluded → latest is undefined → no club_id change
    const clubUpdate = capturedUpdateSets.find((s) => s.clubId === NEW_CLUB_ID);
    expect(
      clubUpdate,
      "Future-dated transfer must NOT trigger a club_id update.",
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: normal dated-row sort still works
// ---------------------------------------------------------------------------

describe("transfer sort — most recent dated row wins (normal case)", () => {
  it("picks the later of two dated transfers", async () => {
    const today = new Date().toISOString().slice(0, 10);

    const clubs   = [
      makeClub(VANCOUVER_ID, WHITECAPS_API, "Vancouver Whitecaps"),
      makeClub(NEW_CLUB_ID,  NEW_CLUB_API,  NEW_CLUB_NAME),
    ];
    const players = [makePlayer(PLAYER_ID, VANCOUVER_ID, API_PLAYER_ID)];

    setupSelectMocks(players, clubs);

    mockAfFetch.mockResolvedValueOnce([
      {
        player: { id: API_PLAYER_ID, name: "Player" },
        transfers: [
          makeTransfer(NEW_CLUB_API, NEW_CLUB_NAME, WHITECAPS_API, "Vancouver Whitecaps", today),    // newer (today)
          makeTransfer(WHITECAPS_API, "Vancouver Whitecaps", 999, "Previous Club", PAST_ISO),         // older
        ],
      },
    ]);

    await syncPlayerClubs();

    const clubUpdate = capturedUpdateSets.find((s) => s.clubId === NEW_CLUB_ID);
    expect(
      clubUpdate,
      "The more recent dated transfer must win the sort.",
    ).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Suite 4: club override bypasses API call
// ---------------------------------------------------------------------------

describe("club override — bypasses transfer API call", () => {
  it("enforces the override club and skips the transfers endpoint", async () => {
    const OVERRIDE_CLUB_ID = 77;
    const clubs   = [
      makeClub(VANCOUVER_ID,   WHITECAPS_API, "Vancouver Whitecaps"),
      makeClub(OVERRIDE_CLUB_ID, 888,          "Override Club"),
    ];
    // Player has clubOverrideId = 77, current clubId = 100 → should update to 77
    const players = [makePlayer(PLAYER_ID, VANCOUVER_ID, API_PLAYER_ID, OVERRIDE_CLUB_ID)];

    setupSelectMocks(players, clubs);
    // No afFetch calls expected — override exits the player loop immediately

    await syncPlayerClubs();

    // Override enforced: club_id updated to OVERRIDE_CLUB_ID (77)
    const overrideUpdate = capturedUpdateSets.find(
      (s) => s.clubId === OVERRIDE_CLUB_ID,
    );
    expect(
      overrideUpdate,
      "When clubOverrideId is set, club_id must be updated to the override club.",
    ).toBeDefined();

    // No transfers API call must have been made
    const transferCalls = mockAfFetch.mock.calls.filter(
      (args) =>
        typeof args[0] === "string" &&
        (args[0] as string).includes("/transfers"),
    );
    expect(
      transferCalls.length,
      "Club override must bypass the transfers API call entirely.",
    ).toBe(0);
  });
});
