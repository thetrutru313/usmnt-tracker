/**
 * Integration guard: confirms that dateless-candidate warnings fire correctly
 * through the FULL syncPlayerClubs pipeline — not just through the unit-tested
 * resolvePlayerIdBySearch function in isolation.
 *
 * ## Why this file exists
 *
 * ### Scenario A — DATELESS CANDIDATE MATCHED (Task #168)
 * The unit tests in datelessCandidateConfidence.test.ts call
 * ensurePlayerApiFootballIds directly with a mocked DB layer.  That approach
 * is fast and precise but cannot catch an integration gap where syncPlayerClubs
 * passes the player list to ensurePlayerApiFootballIds in a shape that prevents
 * the warning from firing (e.g. wrong club-map key, missing age field, logger
 * not wired up at the call site).
 *
 * A foreign prospect (non-USA-domestic club) has no apiFootballPlayerId and an
 * on-file age.  The squad lookup finds nothing.  The only profile-search
 * candidate shares the player's first initial ("A") but has no birth date on
 * file.  The resolver matches it (sole candidate in the pool) but emits the
 * DATELESS CANDIDATE MATCHED warning because age cannot be verified.
 *
 * ### Scenario B — DATELESS SURNAME-FALLBACK CANDIDATE REJECTED (Task #187)
 * Guards the rejection path: the only profile-search candidate has a
 * MISMATCHED first initial AND no birth date.  Because the initial does not
 * match, no candidate enters the initial-match pool (match stays undefined) and
 * the resolver falls into the surname-fallback branch.  There, the candidate is
 * dateless and the player has an on-file age, so the resolver emits
 * DATELESS SURNAME-FALLBACK CANDIDATE REJECTED and leaves the player unresolved
 * (apiFootballPlayerId stays null).  A future refactor of syncPlayerClubs could
 * silently wire this incorrectly (e.g. wrong isUSADomestic flag, missing age
 * field), so the pipeline-level guard catches that without relying on unit tests
 * alone.
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

// ---------------------------------------------------------------------------
// Scenario B — DATELESS SURNAME-FALLBACK CANDIDATE REJECTED
// ---------------------------------------------------------------------------
//
// The only profile-search candidate has a MISMATCHED first initial AND no
// birth date.  Because the initial doesn't match, the candidate never enters
// the initial-match pool (allInitialCandidates is empty → match stays
// undefined).  The resolver then enters the surname-fallback branch where the
// sole unambiguous match is dateless and the player has an on-file age, so it
// emits DATELESS SURNAME-FALLBACK CANDIDATE REJECTED and returns null.
//
// This guards the wiring through syncPlayerClubs: a future refactor that
// passes the wrong isUSADomestic flag or drops the player's age field could
// silently skip the rejection and accept the wrong person.
// ---------------------------------------------------------------------------

/**
 * Player whose first initial is "A" but the only search candidate has first
 * name starting with "B" — guaranteed initial mismatch.
 */
const REJECTION_PLAYER = {
  id: 801,
  name: "Alex Rejection",
  clubId: 1,     // reuses the Portugal/Benfica CLUB defined above
  apiFootballPlayerId: null as number | null,
  age: 22,
};

/**
 * Dateless candidate whose firstname starts with "B" — mismatched first
 * initial relative to REJECTION_PLAYER ("a" vs "b").  No birth date so age
 * cannot be verified.
 */
const MISMATCHED_DATELESS_CANDIDATE = {
  player: {
    id: 99002,
    name: "Bruno Rejection",
    firstname: "Bruno",
    lastname: "Rejection",
    nationality: "Portugal",
    birth: { date: null },
  },
};

describe("syncPlayerClubs — DATELESS SURNAME-FALLBACK CANDIDATE REJECTED path fires through full pipeline", () => {
  beforeEach(() => {
    // Use resetAllMocks (not clearAllMocks) so that the queued mockReturnValueOnce
    // values added by the outer beforeEach are fully discarded before this
    // describe block sets up its own queue.  clearAllMocks only clears call
    // history; it leaves the once-queue intact, which would cause syncPlayerClubs
    // to receive PLAYER/CLUB from the outer queue first — the wrong scenario.
    vi.resetAllMocks();

    mockDb.update.mockImplementation(() => ({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }));
    mockDb.delete.mockImplementation(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    mockDb.insert.mockImplementation(() => ({ values: vi.fn().mockResolvedValue(undefined) }));

    // Return REJECTION_PLAYER (no apiFootballPlayerId) then CLUB, then empty for everything else.
    mockDb.select
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([{ ...REJECTION_PLAYER }])) }) // players
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeFromResult([CLUB])) })                    // clubs
      .mockReturnValue({ from: vi.fn().mockReturnValue(makeFromResult([])) });                           // fallback

    // Squad lookup returns empty; profile search returns sole mismatched-initial dateless candidate.
    mockAfFetch.mockImplementation((url: string) => {
      if (url.includes("/players/squads"))   return Promise.resolve([{ players: [] }]);
      if (url.includes("/players/profiles")) return Promise.resolve([MISMATCHED_DATELESS_CANDIDATE]);
      return Promise.resolve([]);
    });
  });

  it("emits DATELESS SURNAME-FALLBACK CANDIDATE REJECTED warning when the only surname-fallback candidate has a mismatched first initial and no birth date", async () => {
    await syncPlayerClubs();

    const warnCalls: unknown[][] = mockLogger.warn.mock.calls;
    const rejectionWarning = warnCalls.find(
      (args) =>
        typeof args[1] === "string" &&
        args[1].toUpperCase().includes("DATELESS SURNAME-FALLBACK CANDIDATE REJECTED"),
    );

    expect(
      rejectionWarning,
      [
        "Expected a DATELESS SURNAME-FALLBACK CANDIDATE REJECTED logger.warn call from syncPlayerClubs.",
        "logger.warn was called with these messages:",
        ...warnCalls.map((a) => `  • ${JSON.stringify(a[1])}`),
      ].join("\n"),
    ).toBeDefined();
  });

  it("leaves the player's apiFootballPlayerId as null after rejecting the mismatched dateless candidate", async () => {
    await syncPlayerClubs();

    // Confirm that no db.update() call wrote a non-null apiFootballPlayerId for
    // REJECTION_PLAYER.  The only acceptable update is a null-clearing write
    // (e.g. from applyKnownPlayerIdOverrides for a null-pinned player) — but
    // REJECTION_PLAYER is not in KNOWN_PLAYER_IDS so no update should touch its
    // apiFootballPlayerId at all.
    const idWritten = mockDb.update.mock.results.some((result) => {
      if (result.type !== "return") return false;
      const setCalls: unknown[][] = (result.value as { set: { mock: { calls: unknown[][] } } }).set.mock.calls;
      return setCalls.some(
        (setArgs) =>
          setArgs[0] != null &&
          typeof setArgs[0] === "object" &&
          (setArgs[0] as Record<string, unknown>).apiFootballPlayerId === MISMATCHED_DATELESS_CANDIDATE.player.id,
      );
    });

    expect(
      idWritten,
      [
        `Did NOT expect db.update to persist candidateId ${MISMATCHED_DATELESS_CANDIDATE.player.id} — the dateless`,
        "mismatched-initial candidate must be rejected and the player left unresolved.",
      ].join(" "),
    ).toBe(false);
  });
});
