/**
 * Regression guard: confirms that the USA-domestic initial gate in
 * `resolvePlayerIdBySearch` correctly handles nickname players.
 *
 * ## Background
 * Task #148 tightened the unambiguous-surname fallback for USA-domestic clubs:
 * if the sole surname candidate's API-Football `firstname` initial disagrees
 * with our stored first initial, the match is rejected and a warning is emitted
 * rather than silently linking the wrong person.
 *
 * This is correct for typo-or-wrong-person cases (e.g. "G. Romero" when we
 * want "M. Romero"), but it also blocks nickname players — "Gaga Slonina"
 * (stored initial "g") whose legal name is "Nicholas" (initial "n"). Those
 * players are currently protected by KNOWN_PLAYER_IDS, but a future nickname
 * prospect who is NOT yet pinned would silently go unresolved via this path
 * instead of being matched.  This test suite documents that exact behaviour so
 * any regression is caught immediately.
 *
 * ## What is tested
 * 1. A USA-domestic player whose stored nickname initial ("g") differs from the
 *    API-Football legal firstname initial ("n") is left UNRESOLVED and the
 *    "USA-domestic initial gate (surname fallback)" warning is emitted.
 * 2. A USA-domestic player whose stored first initial DOES match the API-Football
 *    firstname initial resolves correctly through the same unambiguous-surname
 *    path (same-initial case must not be broken by the gate).
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared mock state (vi.hoisted so factories run before vi.mock calls)
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
}));

vi.mock("../logger", () => ({
  logger: mockLogger,
}));

vi.mock("../apiFootballSync", () => ({
  afFetch: mockAfFetch,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks so they pick up the mocked modules)
// ---------------------------------------------------------------------------

import { ensurePlayerApiFootballIds, KNOWN_PLAYER_IDS } from "../playerClubSync";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal AfPlayerProfile shape for the search results mock. */
function makeCandidate(opts: {
  id: number;
  firstname: string;
  lastname: string;
  nationality: string;
  birthDate?: string | null;
}): object {
  return {
    player: {
      id: opts.id,
      name: `${opts.firstname} ${opts.lastname}`,
      firstname: opts.firstname,
      lastname: opts.lastname,
      nationality: opts.nationality,
      birth: { date: opts.birthDate ?? null },
    },
  };
}

/** Empty squad response — forces every test through the search fallback. */
function emptySquadResponse(): object[] {
  return [];
}

beforeEach(() => {
  vi.clearAllMocks();
  // Squad lookup returns empty for all calls — exercises the search path.
  mockAfFetch.mockResolvedValue(emptySquadResponse());
  // Default db.update chain.
  mockDb.update.mockImplementation(() => ({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  }));
});

// ---------------------------------------------------------------------------
// USA-domestic initial gate — nickname-vs-legal-name scenario
// ---------------------------------------------------------------------------

describe("USA-domestic initial gate — nickname player whose stored initial disagrees with legal firstname", () => {
  it("leaves the player UNRESOLVED when the sole surname candidate's initial disagrees (nickname mismatch)", async () => {
    // Scenario mirrors the real "Gaga Slonina" case:
    //   stored name  = "Gaga Testslonina"  → surname "testslonina", initial "g"
    //   API-Football = "Nicholas Testslonina" → firstname "Nicholas", initial "n"
    //
    // The search returns one unambiguous USA-nationality surname match, but the
    // candidate's first initial ("n") disagrees with our stored initial ("g").
    // The USA-domestic gate must reject it and leave the player unresolved.

    const player = {
      id: 501,
      name: "Gaga Testslonina",
      clubId: 10,
      apiFootballPlayerId: null as number | null,
      age: 22,
    };

    // Must not be in KNOWN_PLAYER_IDS — we want to exercise the search path.
    expect(KNOWN_PLAYER_IDS["Gaga Testslonina"]).toBeUndefined();

    const clubsById = new Map([
      [10, { id: 10, name: "Chicago Fire", apiFootballTeamId: null, country: "USA" }],
    ]);

    // API-Football legal name "Nicholas Testslonina" — initial "n", USA nationality.
    const legalNameCandidate = makeCandidate({
      id: 201711,
      firstname: "Nicholas",
      lastname: "Testslonina",
      nationality: "USA",
      birthDate: "2004-05-15", // age ~22 — within ±3 tolerance
    });

    mockAfFetch.mockImplementation((url: string) => {
      if (url.includes("/players/profiles")) return Promise.resolve([legalNameCandidate]);
      return Promise.resolve(emptySquadResponse());
    });

    await ensurePlayerApiFootballIds([player], clubsById);

    // Player must remain unresolved — the initial gate blocks the wrong match.
    expect(player.apiFootballPlayerId).toBeNull();
  });

  it("emits the USA-domestic initial gate warning when blocking the nickname-initial mismatch", async () => {
    const player = {
      id: 502,
      name: "Gaga Testslonina",
      clubId: 10,
      apiFootballPlayerId: null as number | null,
      age: 22,
    };

    expect(KNOWN_PLAYER_IDS["Gaga Testslonina"]).toBeUndefined();

    const clubsById = new Map([
      [10, { id: 10, name: "Chicago Fire", apiFootballTeamId: null, country: "USA" }],
    ]);

    const legalNameCandidate = makeCandidate({
      id: 201711,
      firstname: "Nicholas",
      lastname: "Testslonina",
      nationality: "USA",
      birthDate: "2004-05-15",
    });

    mockAfFetch.mockImplementation((url: string) => {
      if (url.includes("/players/profiles")) return Promise.resolve([legalNameCandidate]);
      return Promise.resolve(emptySquadResponse());
    });

    await ensurePlayerApiFootballIds([player], clubsById);

    // The warning log must have been emitted with the gate message.
    const warnCalls: unknown[][] = mockLogger.warn.mock.calls;
    const gateWarning = warnCalls.find((args) =>
      typeof args[1] === "string" && args[1].includes("USA-domestic initial gate (surname fallback)"),
    );
    expect(gateWarning).toBeDefined();

    // The logged metadata should identify the player and the disagreeing initials,
    // plus the candidate id — enough for an admin to action the stuck prospect.
    const meta = gateWarning?.[0] as Record<string, unknown>;
    expect(meta).toMatchObject({
      player: "Gaga Testslonina",
      ourInitial: "g",
      candidateInitial: "n",
      candidateId: 201711,
    });
  });

  it("does NOT apply the gate for a non-USA-domestic club — unambiguous surname match is accepted regardless of initial", async () => {
    // Same nickname scenario, but the club is in Germany — the initial gate
    // only fires for USA-domestic clubs, so the match should go through.
    const player = {
      id: 503,
      name: "Gaga Testslonina",
      clubId: 20,
      apiFootballPlayerId: null as number | null,
      age: 22,
    };

    expect(KNOWN_PLAYER_IDS["Gaga Testslonina"]).toBeUndefined();

    const clubsById = new Map([
      [20, { id: 20, name: "Schalke 04", apiFootballTeamId: null, country: "Germany" }],
    ]);

    const legalNameCandidate = makeCandidate({
      id: 201711,
      firstname: "Nicholas",
      lastname: "Testslonina",
      nationality: "USA",
      birthDate: "2004-05-15",
    });

    mockAfFetch.mockImplementation((url: string) => {
      if (url.includes("/players/profiles")) return Promise.resolve([legalNameCandidate]);
      return Promise.resolve(emptySquadResponse());
    });

    await ensurePlayerApiFootballIds([player], clubsById);

    // Non-USA-domestic club — initial gate does not apply. Unambiguous surname match wins.
    expect(player.apiFootballPlayerId).toBe(201711);
  });
});

// ---------------------------------------------------------------------------
// USA-domestic initial gate — legitimate same-initial USA candidate
// ---------------------------------------------------------------------------

describe("USA-domestic initial gate — legitimate same-initial USA candidate still resolves", () => {
  it("resolves a USA-domestic player whose stored initial matches the API-Football legal firstname", async () => {
    // This is the complementary case: stored name "Nick Testsample" (initial "n"),
    // API-Football has "Nicolas Testsample" (firstname "Nicolas", initial "n").
    // Initial matches → the player should resolve through the unambiguous-surname path.
    const player = {
      id: 601,
      name: "Nick Testsample",
      clubId: 30,
      apiFootballPlayerId: null as number | null,
      age: 21,
    };

    expect(KNOWN_PLAYER_IDS["Nick Testsample"]).toBeUndefined();

    const clubsById = new Map([
      [30, { id: 30, name: "New York City FC", apiFootballTeamId: null, country: "USA" }],
    ]);

    // "Nicolas" starts with "n" — same as our stored "Nick" — so it's an
    // initial match. With one USA-nationality candidate, it should be accepted.
    const rightCandidate = makeCandidate({
      id: 77001,
      firstname: "Nicolas",
      lastname: "Testsample",
      nationality: "USA",
      birthDate: "2005-03-20", // age ~21 — within ±3 tolerance
    });

    mockAfFetch.mockImplementation((url: string) => {
      if (url.includes("/players/profiles")) return Promise.resolve([rightCandidate]);
      return Promise.resolve(emptySquadResponse());
    });

    await ensurePlayerApiFootballIds([player], clubsById);

    // Initial matches — player resolves correctly.
    expect(player.apiFootballPlayerId).toBe(77001);
  });

  it("resolves via the unambiguous-surname path when initial matches but no explicit initial-match pool fires (edge: stored short name matches multi-character legal first name start)", async () => {
    // "Al Testmatch" (initial "a") at a USA-domestic club.
    // API-Football has "Alexander Testmatch" (firstname "Alexander", initial "a").
    // The initial check matches → accepted through the initial-match pool (not even
    // the unambiguous-surname fallback is needed here), confirming the gate doesn't
    // over-block legitimate short-name matches.
    const player = {
      id: 602,
      name: "Al Testmatch",
      clubId: 30,
      apiFootballPlayerId: null as number | null,
      age: 24,
    };

    expect(KNOWN_PLAYER_IDS["Al Testmatch"]).toBeUndefined();

    const clubsById = new Map([
      [30, { id: 30, name: "New York City FC", apiFootballTeamId: null, country: "USA" }],
    ]);

    const rightCandidate = makeCandidate({
      id: 88001,
      firstname: "Alexander",
      lastname: "Testmatch",
      nationality: "USA",
      birthDate: "2002-07-10", // age ~24 — within ±3 tolerance
    });

    mockAfFetch.mockImplementation((url: string) => {
      if (url.includes("/players/profiles")) return Promise.resolve([rightCandidate]);
      return Promise.resolve(emptySquadResponse());
    });

    await ensurePlayerApiFootballIds([player], clubsById);

    // Initial "a" matches "Alexander"[0] "a" → resolves.
    expect(player.apiFootballPlayerId).toBe(88001);
  });
});
