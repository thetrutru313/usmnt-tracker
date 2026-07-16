/**
 * Integration guard: confirms that the "DATELESS CANDIDATE MATCHED" warning
 * fires through the FULL syncPlayerClubs pipeline — not just through the
 * unit-tested resolvePlayerIdBySearch function in isolation.
 *
 * ## Why this test exists (Task #168)
 * The unit tests in datelessCandidateConfidence.test.ts call
 * ensurePlayerApiFootballIds directly with a mocked DB layer.  That
 * approach is fast and precise but cannot catch an integration gap where
 * syncPlayerClubs passes the player list to ensurePlayerApiFootballIds in a
 * shape that prevents the warning from firing (e.g. wrong club-map key,
 * missing age field, logger not wired up at the call site).
 *
 * This file exercises the path:
 *   syncPlayerClubs()
 *     → ensurePlayerApiFootballIds()
 *       → resolvePlayerIdBySearch()
 *         → "DATELESS CANDIDATE MATCHED" logged via logger.warn
 *
 * ## Scenario
 * A foreign prospect (non-USA-domestic club) has no apiFootballPlayerId and
 * an on-file age.  The squad lookup finds nothing.  The only profile-search
 * candidate shares the player's first initial ("A") but has no birth date on
 * file.  The resolver matches it (sole candidate in the pool) but emits the
 * DATELESS CANDIDATE MATCHED warning because age cannot be verified.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared mock state — vi.hoisted so factories run before vi.mock calls.
// ---------------------------------------------------------------------------

const { mockDb, tPlayers, tClubs, mockAfFetch, mockLogger } = vi.hoisted(() => {
  const tPlayers = { _table: "players" };
  const tClubs = { _table: "clubs" };

  const mockDb = {
    select: vi.fn(),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    })),
    insert: vi.fn().mockImplementation(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    delete: vi.fn().mockImplementation(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  };

  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  return { mockDb, tPlayers, tClubs, mockAfFetch: vi.fn(), mockLogger };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: mockDb,
  playersTable: tPlayers,
  clubsTable: tClubs,
}));

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, _val: unknown) => ({ _eq: [_col, _val] }),
  and: (...args: unknown[]) => ({ _and: args }),
  inArray: (_col: unknown, vals: unknown) => ({ _inArray: [_col, vals] }),
}));

vi.mock("../logger", () => ({
  logger: mockLogger,
}));

vi.mock("../apiFootballSync", () => ({
  afFetch: mockAfFetch,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { syncPlayerClubs } from "../playerClubSync";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a PromiseLike that also exposes a `.where()` method, matching the
 * drizzle-ORM chain `await db.select().from(t)` and
 * `await db.select().from(t).where(...)`.
 */
function makeFromResult(data: unknown[]) {
  const p = Promise.resolve(data) as Promise<unknown[]> & { where: ReturnType<typeof vi.fn> };
  p.where = vi.fn().mockResolvedValue(data);
  return p;
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

/** Non-USA-domestic club — makes the nationality gate irrelevant. */
const CLUB = {
  id: 1,
  name: "Benfica",
  apiFootballTeamId: 211,
  country: "Portugal",
};

/**
 * Prospect with no API-Football id and an on-file age.
 * First initial is "A" (Alexandre/Alexandre) — will hit the initial-match path.
 */
const PLAYER = {
  id: 800,
  name: "Alex Syncwarn",
  clubId: 1,
  apiFootballPlayerId: null as number | null,
  age: 23,
};

/** A single dateless candidate whose first initial matches ("A"). */
const DATELESS_CANDIDATE = {
  player: {
    id: 99001,
    name: "Alexandre Syncwarn",
    firstname: "Alexandre",
    lastname: "Syncwarn",
    nationality: "Portugal",
    birth: { date: null },
  },
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Restore db.update implementation after vi.clearAllMocks wipes it.
  mockDb.update.mockImplementation(() => ({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  }));
  mockDb.delete.mockImplementation(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
  mockDb.insert.mockImplementation(() => ({ values: vi.fn().mockResolvedValue(undefined) }));

  // syncPlayerClubs fetches players then clubs.  All subsequent select calls
  // (e.g. inside checkNullPinnedPlayers) get an empty result.
  mockDb.select
    .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([{ ...PLAYER }])) }) // players
    .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([CLUB])) }) // clubs
    .mockReturnValue({ from: vi.fn().mockReturnValue(makeFromResult([])) }); // fallback

  // afFetch routing:
  //  - /players/squads?team=211 → empty roster  (squad-lookup path finds nothing)
  //  - /players/profiles?search=Syncwarn → single dateless candidate
  //  - /transfers?player=99001  → no transfers  (resolved player has no transfer data)
  mockAfFetch.mockImplementation((url: string) => {
    if (url.includes("/players/squads")) return Promise.resolve([{ players: [] }]);
    if (url.includes("/players/profiles")) return Promise.resolve([DATELESS_CANDIDATE]);
    if (url.includes("/transfers")) return Promise.resolve([]);
    return Promise.resolve([]);
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("syncPlayerClubs — dateless-candidate warning fires through full pipeline", () => {
  it("emits DATELESS CANDIDATE MATCHED warning when the only initial-match candidate has no birth date and the player has an on-file age", async () => {
    await syncPlayerClubs();

    // The warning must appear in the logger.warn call chain.
    const warnCalls: unknown[][] = mockLogger.warn.mock.calls;
    const datelessWarning = warnCalls.find(
      (args) =>
        typeof args[1] === "string" &&
        args[1].toUpperCase().includes("DATELESS CANDIDATE MATCHED"),
    );

    expect(
      datelessWarning,
      [
        "Expected a DATELESS CANDIDATE MATCHED logger.warn call from syncPlayerClubs.",
        "logger.warn was called with these messages:",
        ...warnCalls.map((a) => `  • ${JSON.stringify(a[1])}`),
      ].join("\n"),
    ).toBeDefined();
  });

  it("resolves the player to the dateless candidate's id despite the warning (sole candidate — match proceeds)", async () => {
    // When the only candidate is dateless and no confident alternative exists,
    // the resolver accepts it (with a warning) rather than leaving the player
    // unresolved.  syncPlayerClubs must then persist the resolved id to the DB.
    await syncPlayerClubs();

    // db.update(playersTable).set({ apiFootballPlayerId: 99001 }) must have been called.
    const updateCalls = mockDb.update.mock.calls;
    const idWritten = updateCalls.some(() => {
      // Inspect every .set() invocation on any update chain.
      return mockDb.update.mock.results.some((result) => {
        if (result.type !== "return") return false;
        const setCalls: unknown[][] = (result.value as { set: { mock: { calls: unknown[][] } } }).set.mock.calls;
        return setCalls.some(
          (setArgs) =>
            setArgs[0] != null &&
            typeof setArgs[0] === "object" &&
            (setArgs[0] as Record<string, unknown>).apiFootballPlayerId === 99001,
        );
      });
    });

    expect(
      idWritten,
      "Expected db.update(playersTable).set({ apiFootballPlayerId: 99001 }) to be called after resolving the dateless candidate",
    ).toBe(true);
  });
});
