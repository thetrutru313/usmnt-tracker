/**
 * Regression guard: confirms that `resolvePlayerIdBySearch` treats candidates
 * with no reported birth date as lower-confidence than candidates with an
 * age-consistent birth date.
 *
 * ## Background (Task #155)
 * The Manu Romero case: "G. Romero USA, birth=None" passed the age gate
 * (candidateAge == null → return true) and later passed the USA-domestic
 * initial gate (added in #148). But the same gap exists for non-USA-domestic
 * clubs where a dateless candidate can still win the initial-match tie-break
 * over a candidate with a confirmed, age-consistent birth date.
 *
 * ## What is tested
 * 1. When a confident candidate (has birth date, age-consistent) and a dateless
 *    candidate both match surname + initial, the confident candidate wins and the
 *    dateless one is excluded from the pool.
 * 2. When our player has an on-file age and the ONLY matching candidate is
 *    dateless, the resolver leaves the player unresolved and emits a
 *    DATELESS warning (surname fallback path, non-USA-domestic club).
 * 3. A dateless candidate IS accepted via the initial-match path when our
 *    player has NO on-file age (no age to verify — dateless is not a
 *    disqualifier on its own).
 * 4. The surname fallback path (nickname case) also applies the confidence
 *    preference: a confident unambiguous surname match wins over a dateless one.
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
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { ensurePlayerApiFootballIds, KNOWN_PLAYER_IDS } from "../playerClubSync";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function emptySquadResponse(): object[] {
  return [];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAfFetch.mockResolvedValue(emptySquadResponse());
  mockDb.update.mockImplementation(() => ({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  }));
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("resolvePlayerIdBySearch — dateless candidate confidence preference", () => {
  it("picks the age-confirmed candidate and excludes the dateless candidate when both match surname + initial", async () => {
    // Two candidates: same surname "Testdateless", same initial "M".
    // candidateA has a confirmed birth date (age-consistent).
    // candidateB has no birth date on file.
    // The resolver must prefer candidateA (confident) and not match candidateB.
    const player = {
      id: 700,
      name: "Marco Testdateless",
      clubId: 10,
      apiFootballPlayerId: null as number | null,
      age: 22,
    };
    expect(KNOWN_PLAYER_IDS["Marco Testdateless"]).toBeUndefined();

    const clubsById = new Map([
      [10, { id: 10, name: "Eintracht Frankfurt", apiFootballTeamId: null, country: "Germany" }],
    ]);

    const confidentCandidate = makeCandidate({
      id: 12001,
      firstname: "Marco",
      lastname: "Testdateless",
      nationality: "Germany",
      birthDate: "2004-03-01", // age ~22 — within ±3 tolerance
    });
    const datelessCandidate = makeCandidate({
      id: 12002,
      firstname: "Matteo",
      lastname: "Testdateless",
      nationality: "Germany",
      birthDate: null, // no birth date on file
    });

    mockAfFetch.mockImplementation((url: string) => {
      if (url.includes("/players/profiles")) return Promise.resolve([confidentCandidate, datelessCandidate]);
      return Promise.resolve(emptySquadResponse());
    });

    await ensurePlayerApiFootballIds([player], clubsById);

    // Confident candidate wins; dateless candidate was excluded from the pool.
    expect(player.apiFootballPlayerId).toBe(12001);
  });

  it("leaves player unresolved and emits a DATELESS warning when only dateless candidate exists and our player has an on-file age (non-USA-domestic, surname fallback path)", async () => {
    // Scenario: one unambiguous surname match via the SURNAME FALLBACK path
    // (the candidate's firstname initial does NOT match our stored initial, so
    // the initial-match pool is empty and the resolver falls through to the
    // unambiguous-surname check). The candidate has no birth date on file and
    // our player has an on-file age — the resolver must reject it and warn.
    //
    // Player: "Toni Testnosurname" (initial "t").
    // Candidate: firstname "Alessandro" (initial "a" ≠ "t") — forces the
    // surname fallback path. Non-USA-domestic club so the USA initial gate
    // doesn't apply; only the dateless check gates it.
    const player = {
      id: 701,
      name: "Toni Testnosurname",
      clubId: 20,
      apiFootballPlayerId: null as number | null,
      age: 19,
    };
    expect(KNOWN_PLAYER_IDS["Toni Testnosurname"]).toBeUndefined();

    // Non-USA-domestic club — tests the gap that existed before this fix.
    const clubsById = new Map([
      [20, { id: 20, name: "AS Roma", apiFootballTeamId: null, country: "Italy" }],
    ]);

    // Single candidate: initial "a" ≠ player initial "t" → initial-match pool
    // is empty → falls to the unambiguous-surname fallback. No birth date.
    const datelessOnlyCandidate = makeCandidate({
      id: 13001,
      firstname: "Alessandro",  // initial "a" ≠ "t" → forces surname fallback path
      lastname: "Testnosurname",
      nationality: "Italy",
      birthDate: null,           // no birth date
    });

    mockAfFetch.mockImplementation((url: string) => {
      if (url.includes("/players/profiles")) return Promise.resolve([datelessOnlyCandidate]);
      return Promise.resolve(emptySquadResponse());
    });

    await ensurePlayerApiFootballIds([player], clubsById);

    // Player has an on-file age + candidate is dateless → must stay unresolved.
    expect(player.apiFootballPlayerId).toBeNull();

    // A DATELESS warning must be emitted.
    const warnCalls: unknown[][] = mockLogger.warn.mock.calls;
    const datelessWarning = warnCalls.find((args) =>
      typeof args[1] === "string" && args[1].toUpperCase().includes("DATELESS"),
    );
    expect(datelessWarning).toBeDefined();
  });

  it("accepts a dateless candidate via the initial-match path when our player has NO on-file age", async () => {
    // When there is no on-file age, a dateless candidate cannot be rejected on
    // age grounds — it should still be accepted as the sole unambiguous match.
    const player = {
      id: 702,
      name: "Paolo Testnobirth",
      clubId: 30,
      apiFootballPlayerId: null as number | null,
      age: undefined, // no on-file age
    };
    expect(KNOWN_PLAYER_IDS["Paolo Testnobirth"]).toBeUndefined();

    const clubsById = new Map([
      [30, { id: 30, name: "Juventus", apiFootballTeamId: null, country: "Italy" }],
    ]);

    const datelessCandidate = makeCandidate({
      id: 14001,
      firstname: "Paolo",
      lastname: "Testnobirth",
      nationality: "Italy",
      birthDate: null, // no birth date — but we have no age to check against
    });

    mockAfFetch.mockImplementation((url: string) => {
      if (url.includes("/players/profiles")) return Promise.resolve([datelessCandidate]);
      return Promise.resolve(emptySquadResponse());
    });

    await ensurePlayerApiFootballIds([player], clubsById);

    // No on-file age means dateless is not a disqualifier — should match.
    expect(player.apiFootballPlayerId).toBe(14001);
  });

  it("prefers a confident surname-fallback candidate over a dateless one when two candidates exist (surname fallback path)", async () => {
    // Two candidates for surname "Testprefer": both have nickname mismatch (no
    // initial-match pool fires). One has a birth date (confident), one does not.
    // The confident candidate must be chosen over the dateless one.
    const player = {
      id: 703,
      name: "Gio Testprefer",
      clubId: 40,
      apiFootballPlayerId: null as number | null,
      age: 21,
    };
    expect(KNOWN_PLAYER_IDS["Gio Testprefer"]).toBeUndefined();

    const clubsById = new Map([
      [40, { id: 40, name: "Ajax", apiFootballTeamId: null, country: "Netherlands" }],
    ]);

    // Both candidates: initial "g" matches our "Gio" initial.
    // Initial-match pool will fire for the confident one.
    // The dateless one also matches initial — but it should be excluded from the
    // pool because the confident one is present.
    const confidentCandidate = makeCandidate({
      id: 15001,
      firstname: "Giovanni",
      lastname: "Testprefer",
      nationality: "Netherlands",
      birthDate: "2005-01-15", // age ~21 — within ±3
    });
    const datelessCandidate = makeCandidate({
      id: 15002,
      firstname: "Giorgio",
      lastname: "Testprefer",
      nationality: "Netherlands",
      birthDate: null,
    });

    mockAfFetch.mockImplementation((url: string) => {
      if (url.includes("/players/profiles")) return Promise.resolve([confidentCandidate, datelessCandidate]);
      return Promise.resolve(emptySquadResponse());
    });

    await ensurePlayerApiFootballIds([player], clubsById);

    // Confident candidate wins (dateless excluded from the pool when a confident one exists).
    expect(player.apiFootballPlayerId).toBe(15001);
  });

  it("emits DATELESS CANDIDATE MATCHED warning when a dateless candidate wins the initial-match path and our player has an on-file age", async () => {
    // This tests the case where a dateless candidate wins the initial-match pool
    // (no confident candidate with the same initial exists) but our player has
    // an on-file age. The match proceeds but a warning must be logged.
    const player = {
      id: 704,
      name: "Alex Testwarn",
      clubId: 50,
      apiFootballPlayerId: null as number | null,
      age: 23,
    };
    expect(KNOWN_PLAYER_IDS["Alex Testwarn"]).toBeUndefined();

    const clubsById = new Map([
      [50, { id: 50, name: "Benfica", apiFootballTeamId: null, country: "Portugal" }],
    ]);

    // Single candidate: matching initial "A", no birth date.
    // No age-confirmed alternative exists — dateless wins the pool.
    const datelessOnly = makeCandidate({
      id: 16001,
      firstname: "Alexandre",
      lastname: "Testwarn",
      nationality: "Portugal",
      birthDate: null,
    });

    mockAfFetch.mockImplementation((url: string) => {
      if (url.includes("/players/profiles")) return Promise.resolve([datelessOnly]);
      return Promise.resolve(emptySquadResponse());
    });

    await ensurePlayerApiFootballIds([player], clubsById);

    // Match proceeds (only candidate available).
    expect(player.apiFootballPlayerId).toBe(16001);

    // Warning must be emitted.
    const warnCalls: unknown[][] = mockLogger.warn.mock.calls;
    const datelessWarning = warnCalls.find((args) =>
      typeof args[1] === "string" && args[1].toUpperCase().includes("DATELESS CANDIDATE MATCHED"),
    );
    expect(datelessWarning).toBeDefined();
  });
});
