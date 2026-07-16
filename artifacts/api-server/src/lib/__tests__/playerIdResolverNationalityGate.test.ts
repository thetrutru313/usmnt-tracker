/**
 * Regression guard: confirms that `resolvePlayerIdBySearch` rejects same-
 * initial, different-nationality, age-adjacent candidates rather than
 * silently linking a prospect to the wrong person.
 *
 * ## Background
 * Cruz Medina (born 2006) was once matched to a Chilean player born 2001
 * because the age-consistency tolerance was ±6 years and the difference was
 * exactly 5–6 years.  The mismatch corrupted Cruz Medina's date_of_birth in
 * the DB before being caught manually.
 *
 * ## What is tested
 * 1. `AGE_TOLERANCE_YEARS` is 3 — documents the tighter constant.
 * 2. A candidate >3 years away from the on-file age is filtered out even when
 *    surname and first-initial both match.
 * 3. For a USA-domestic club: when a USA-nationality and a non-USA-nationality
 *    candidate both match surname + initial, only the USA candidate is accepted
 *    (nationality gate).
 * 4. For a USA-domestic club: when a non-USA-nationality candidate is the
 *    ONLY initial match and no USA candidate exists, it is still accepted
 *    (gate only fires when a USA alternative is present).
 * 5. `ageFromBirthDate` computes the expected value.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared mock state (vi.hoisted so factories run before vi.mock calls)
// ---------------------------------------------------------------------------

const { mockDb, tPlayers, tClubs, mockAfFetch } = vi.hoisted(() => {
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

  return { mockDb, tPlayers, tClubs, mockAfFetch: vi.fn() };
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
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../apiFootballSync", () => ({
  afFetch: mockAfFetch,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks so they pick up the mocked modules)
// ---------------------------------------------------------------------------

import { ageFromBirthDate, AGE_TOLERANCE_YEARS, ensurePlayerApiFootballIds, KNOWN_PLAYER_IDS } from "../playerClubSync";

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

/** Build an AfSquadResponse-shaped array (empty — forces the search fallback). */
function emptySquadResponse(): object[] {
  return [];
}

beforeEach(() => {
  vi.clearAllMocks();
  // Squad lookup returns empty — exercises the search fallback for all tests.
  mockAfFetch.mockResolvedValue(emptySquadResponse());
  // Default db.update chain
  mockDb.update.mockImplementation(() => ({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  }));
});

// ---------------------------------------------------------------------------
// Pure-function tests
// ---------------------------------------------------------------------------

describe("AGE_TOLERANCE_YEARS", () => {
  it("is 3", () => {
    expect(AGE_TOLERANCE_YEARS).toBe(3);
  });
});

describe("ageFromBirthDate", () => {
  it("returns null for null input", () => {
    expect(ageFromBirthDate(null)).toBeNull();
  });

  it("returns null for invalid date string", () => {
    expect(ageFromBirthDate("not-a-date")).toBeNull();
  });

  it("returns a reasonable age for a known birth date", () => {
    // Someone born exactly 20 years before a fixed point in mid-2026.
    // Use a date far enough in the past that clock skew won't flip it.
    const age = ageFromBirthDate("2000-01-01");
    expect(age).toBeGreaterThan(25);
    expect(age).toBeLessThan(30);
  });
});

// ---------------------------------------------------------------------------
// resolvePlayerIdBySearch via ensurePlayerApiFootballIds
// ---------------------------------------------------------------------------

describe("resolvePlayerIdBySearch — age-tolerance gate (±3 years)", () => {
  it("rejects a candidate whose age is 5 years off from on-file age", async () => {
    // Prospect: "Cruz Medina", age 20 (born ~2006), at a USA-domestic club.
    // Interloper: "C. Medina" from Chile, born ~2001 (age 25) — 5 years off.
    const player = { id: 99, name: "Cruz Medina", clubId: 1, apiFootballPlayerId: null, age: 20 };
    // Ensure we exercise the search path, not the KNOWN_PLAYER_IDS null-pin.
    // (Cruz Medina IS currently pinned to null; we test the logic with a
    // stand-in name that is NOT in KNOWN_PLAYER_IDS.)
    const prospectPlayer = { id: 99, name: "Cruz Testplayer", clubId: 1, apiFootballPlayerId: null, age: 20 };
    expect(KNOWN_PLAYER_IDS["Cruz Testplayer"]).toBeUndefined();

    const clubsById = new Map([
      [1, { id: 1, name: "FC Dallas", apiFootballTeamId: null, country: "USA" }],
    ]);

    // Search endpoint returns one candidate: same surname, same initial, but 5 years older.
    const interloper = makeCandidate({ id: 5001, firstname: "Carlos", lastname: "Testplayer", nationality: "Chile", birthDate: "2001-06-15" });
    mockAfFetch.mockImplementation((url: string) => {
      if (url.includes("/players/profiles")) return Promise.resolve([interloper]);
      return Promise.resolve(emptySquadResponse()); // squad lookup
    });

    const players = [prospectPlayer];
    await ensurePlayerApiFootballIds(players, clubsById);

    // The interloper is 5 years older — outside the ±3 window — so no match.
    expect(prospectPlayer.apiFootballPlayerId).toBeNull();
  });

  it("accepts a candidate whose age is exactly 3 years off (boundary)", async () => {
    const player = { id: 100, name: "Boundary Testplayer", clubId: 1, apiFootballPlayerId: null, age: 20 };
    expect(KNOWN_PLAYER_IDS["Boundary Testplayer"]).toBeUndefined();

    const clubsById = new Map([
      [1, { id: 1, name: "Portland Timbers", apiFootballTeamId: null, country: "USA" }],
    ]);

    // Candidate: same surname, same initial, exactly 3 years older and USA nationality.
    const rightPerson = makeCandidate({
      id: 6001,
      firstname: "Brandon",
      lastname: "Testplayer",
      nationality: "USA",
      birthDate: "2003-06-15", // 3 years older than our on-file age of 20 (born ~2006)
    });
    mockAfFetch.mockImplementation((url: string) => {
      if (url.includes("/players/profiles")) return Promise.resolve([rightPerson]);
      return Promise.resolve(emptySquadResponse());
    });

    const players = [player];
    await ensurePlayerApiFootballIds(players, clubsById);

    // Exactly ±3 is within tolerance — should be accepted.
    expect(player.apiFootballPlayerId).toBe(6001);
  });

  it("rejects a candidate whose age is exactly 4 years off (just outside)", async () => {
    const player = { id: 101, name: "Outside Testplayer", clubId: 1, apiFootballPlayerId: null, age: 20 };
    expect(KNOWN_PLAYER_IDS["Outside Testplayer"]).toBeUndefined();

    const clubsById = new Map([
      [1, { id: 1, name: "FC Cincinnati", apiFootballTeamId: null, country: "USA" }],
    ]);

    const interloper = makeCandidate({
      id: 7001,
      firstname: "Oscar",
      lastname: "Testplayer",
      nationality: "USA",
      birthDate: "2002-06-15", // 4 years older — just outside ±3
    });
    mockAfFetch.mockImplementation((url: string) => {
      if (url.includes("/players/profiles")) return Promise.resolve([interloper]);
      return Promise.resolve(emptySquadResponse());
    });

    const players = [player];
    await ensurePlayerApiFootballIds(players, clubsById);

    expect(player.apiFootballPlayerId).toBeNull();
  });
});

describe("resolvePlayerIdBySearch — USA-domestic nationality gate", () => {
  it("picks the USA-nationality candidate and rejects the non-USA candidate when both match surname + initial (USA-domestic club)", async () => {
    // Two candidates: both surname "Testgate", both initial "C", same age.
    // One is USA nationality (the correct match), one is Chilean (the interloper).
    const player = { id: 200, name: "Cruz Testgate", clubId: 2, apiFootballPlayerId: null, age: 20 };
    expect(KNOWN_PLAYER_IDS["Cruz Testgate"]).toBeUndefined();

    const clubsById = new Map([
      [2, { id: 2, name: "San Jose Earthquakes", apiFootballTeamId: null, country: "USA" }],
    ]);

    const usaCandidate = makeCandidate({ id: 8001, firstname: "Cruz", lastname: "Testgate", nationality: "USA", birthDate: "2006-04-01" });
    const chileCandidate = makeCandidate({ id: 8002, firstname: "Carlos", lastname: "Testgate", nationality: "Chile", birthDate: "2005-04-01" });

    mockAfFetch.mockImplementation((url: string) => {
      if (url.includes("/players/profiles")) return Promise.resolve([usaCandidate, chileCandidate]);
      return Promise.resolve(emptySquadResponse());
    });

    const players = [player];
    await ensurePlayerApiFootballIds(players, clubsById);

    // USA candidate wins; Chilean candidate is rejected by the nationality gate.
    expect(player.apiFootballPlayerId).toBe(8001);
  });

  it("accepts a non-USA candidate when no USA candidate exists (gate only fires when a USA alternative is present)", async () => {
    // Single candidate — non-USA, but no USA alternative exists — should be accepted.
    const player = { id: 201, name: "Kai Testforeign", clubId: 2, apiFootballPlayerId: null, age: 22 };
    expect(KNOWN_PLAYER_IDS["Kai Testforeign"]).toBeUndefined();

    const clubsById = new Map([
      [2, { id: 2, name: "San Jose Earthquakes", apiFootballTeamId: null, country: "USA" }],
    ]);

    const foreignCandidate = makeCandidate({ id: 9001, firstname: "Kai", lastname: "Testforeign", nationality: "Germany", birthDate: "2004-03-01" });

    mockAfFetch.mockImplementation((url: string) => {
      if (url.includes("/players/profiles")) return Promise.resolve([foreignCandidate]);
      return Promise.resolve(emptySquadResponse());
    });

    const players = [player];
    await ensurePlayerApiFootballIds(players, clubsById);

    // Gate doesn't fire — sole candidate accepted regardless of nationality.
    expect(player.apiFootballPlayerId).toBe(9001);
  });

  it("returns null when two USA-nationality candidates both match surname, initial, and age (ambiguous — must not guess)", async () => {
    // Scenario: two prospects share the surname "Testdupe" and first initial "A",
    // and both are within the ±3-year age window of our on-file player.
    // The resolver must leave the player unresolved rather than silently picking one.
    const player = { id: 300, name: "Alex Testdupe", clubId: 2, apiFootballPlayerId: null, age: 21 };
    expect(KNOWN_PLAYER_IDS["Alex Testdupe"]).toBeUndefined();

    const clubsById = new Map([
      [2, { id: 2, name: "San Jose Earthquakes", apiFootballTeamId: null, country: "USA" }],
    ]);

    // Two USA-nationality candidates — same surname, same initial "A", both age-consistent.
    const candidateA = makeCandidate({ id: 11001, firstname: "Alex", lastname: "Testdupe", nationality: "USA", birthDate: "2005-03-10" }); // age ~21 — within ±3
    const candidateB = makeCandidate({ id: 11002, firstname: "Aaron", lastname: "Testdupe", nationality: "USA", birthDate: "2003-07-22" }); // age ~23 — within ±3

    mockAfFetch.mockImplementation((url: string) => {
      if (url.includes("/players/profiles")) return Promise.resolve([candidateA, candidateB]);
      return Promise.resolve(emptySquadResponse());
    });

    const players = [player];
    await ensurePlayerApiFootballIds(players, clubsById);

    // Both candidates are USA-nationality, same initial, age-consistent — ambiguous.
    // Resolver must NOT pick either; player stays unresolved.
    expect(player.apiFootballPlayerId).toBeNull();
  });

  it("does NOT apply the nationality gate for a non-USA-domestic club", async () => {
    // Same two candidates as the gate test, but club is based in Germany —
    // both initial-match candidates are in play; the USA candidate still wins
    // (preferred), but the gate restriction isn't what decides it.
    const player = { id: 202, name: "Cruz Intltest", clubId: 3, apiFootballPlayerId: null, age: 20 };
    expect(KNOWN_PLAYER_IDS["Cruz Intltest"]).toBeUndefined();

    const clubsById = new Map([
      [3, { id: 3, name: "Eintracht Frankfurt", apiFootballTeamId: null, country: "Germany" }],
    ]);

    const usaCandidate = makeCandidate({ id: 10001, firstname: "Cruz", lastname: "Intltest", nationality: "USA", birthDate: "2006-04-01" });
    const chileCandidate = makeCandidate({ id: 10002, firstname: "Carlos", lastname: "Intltest", nationality: "Chile", birthDate: "2005-04-01" });

    mockAfFetch.mockImplementation((url: string) => {
      if (url.includes("/players/profiles")) return Promise.resolve([usaCandidate, chileCandidate]);
      return Promise.resolve(emptySquadResponse());
    });

    const players = [player];
    await ensurePlayerApiFootballIds(players, clubsById);

    // USA candidate is still preferred (existing logic), even without the gate.
    expect(player.apiFootballPlayerId).toBe(10001);
  });
});
