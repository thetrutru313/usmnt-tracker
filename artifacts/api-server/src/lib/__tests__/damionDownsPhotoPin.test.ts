/**
 * Regression guard: confirms that `applyKnownPlayerIdOverrides` corrects
 * Damion Downs' API-Football id from the previously-wrong value (291521,
 * "Dylan Downs") to the verified value (334362), AND that
 * `syncResolvedPlayerPhotos` then writes a photo URL derived from the
 * correct id.
 *
 * ## Why this test exists (Task #414)
 * The KNOWN_PLAYER_IDS pin for Damion Downs (id 334362) was added after
 * the auto-resolver had stored id 291521 ("Dylan Downs", an English player
 * born 2002-01-07) — a surname-only collision that caused a wrong player's
 * photo to appear on his profile page. The pin is only enforced when
 * `applyKnownPlayerIdOverrides` runs as part of a sync sweep. This test
 * guards against two regression paths:
 *
 * 1. The sweep's early-exit or a future refactor bypasses
 *    `applyKnownPlayerIdOverrides` entirely, leaving the wrong id in place.
 * 2. The pin is applied but `syncResolvedPlayerPhotos` derives the photo URL
 *    from the OLD id instead of the newly-corrected one, so the wrong photo
 *    silently persists even though the id column is now correct.
 *
 * The test exercises both by checking:
 *   - `db.update().set({ apiFootballPlayerId: 334362 })` fires for the player
 *   - `db.update().set({ photoUrl: "…/334362.png" })` fires for the player
 *   - the wrong-id URL ("…/291521.png") never appears in any set() call
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared mock state — vi.hoisted so factories run before vi.mock calls.
// ---------------------------------------------------------------------------

const { mockDb, tPlayers, mockLogger } = vi.hoisted(() => {
  const tPlayers = { _table: "players" };

  const setCaptured: Array<{ fields: Record<string, unknown>; playerId: unknown }> = [];

  const mockDb = {
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((fields: Record<string, unknown>) => {
        // We capture the fields; the where() call carries the player id but
        // we do not need it for these assertions (only one player is in the
        // fixture). Store the fields directly for easy assertion.
        setCaptured.push({ fields, playerId: null });
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
    // resolvePlayerIdsViaSquads does a select; return empty to skip that path.
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue(Promise.resolve([])),
    }),
    insert: vi.fn().mockImplementation(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    delete: vi.fn().mockImplementation(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    _setCaptured: setCaptured,
  };

  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  return { mockDb, tPlayers, mockLogger };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: mockDb,
  playersTable: tPlayers,
  clubsTable: { _table: "clubs" },
  transfersTable: { _table: "transfers" },
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
  afFetch: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import { ensurePlayerApiFootballIds, KNOWN_PLAYER_IDS } from "../playerClubSync";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WRONG_ID = 291521; // "Dylan Downs" — the old false-positive id
const CORRECT_ID = 334362; // Damion Downs — verified via TheFishy cross-reference
const CORRECT_PHOTO = `https://media.api-sports.io/football/players/${CORRECT_ID}.png`;
const WRONG_PHOTO = `https://media.api-sports.io/football/players/${WRONG_ID}.png`;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockDb._setCaptured.length = 0;

  // Restore implementations after clearAllMocks.
  mockDb.update.mockImplementation(() => ({
    set: vi.fn().mockImplementation((fields: Record<string, unknown>) => {
      mockDb._setCaptured.push({ fields, playerId: null });
      return { where: vi.fn().mockResolvedValue(undefined) };
    }),
  }));
  mockDb.delete.mockImplementation(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
  mockDb.insert.mockImplementation(() => ({ values: vi.fn().mockResolvedValue(undefined) }));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capturedFields(): Array<Record<string, unknown>> {
  return mockDb._setCaptured.map((e) => e.fields);
}

// ---------------------------------------------------------------------------
// Sanity check: the pin must exist in the live map
// ---------------------------------------------------------------------------

describe("KNOWN_PLAYER_IDS — Damion Downs pin sanity check", () => {
  it("has Damion Downs pinned to 334362", () => {
    expect(KNOWN_PLAYER_IDS["Damion Downs"]).toBe(CORRECT_ID);
  });
});

// ---------------------------------------------------------------------------
// Core regression tests
// ---------------------------------------------------------------------------

describe("applyKnownPlayerIdOverrides — Damion Downs photo pin", () => {
  it("corrects the id from 291521 (Dylan Downs) to 334362 when the wrong id is stored", async () => {
    const player = {
      id: 77,
      name: "Damion Downs",
      clubId: 1,
      apiFootballPlayerId: WRONG_ID as number | null,
    };
    const clubsById = new Map([
      [1, { id: 1, name: "Hamburger SV", apiFootballTeamId: null, country: "DEU" }],
    ]);

    await ensurePlayerApiFootballIds([player], clubsById);

    const fields = capturedFields();

    const idFix = fields.find((f) => f.apiFootballPlayerId === CORRECT_ID);
    expect(
      idFix,
      [
        `Expected db.update().set({ apiFootballPlayerId: ${CORRECT_ID} }) for Damion Downs.`,
        "Captured set() payloads:",
        ...fields.map((f) => `  • ${JSON.stringify(f)}`),
      ].join("\n"),
    ).toBeDefined();
  });

  it("writes the photo URL for the correct id (334362.png) after the pin is applied", async () => {
    const player = {
      id: 77,
      name: "Damion Downs",
      clubId: 1,
      apiFootballPlayerId: WRONG_ID as number | null,
    };
    const clubsById = new Map([
      [1, { id: 1, name: "Hamburger SV", apiFootballTeamId: null, country: "DEU" }],
    ]);

    await ensurePlayerApiFootballIds([player], clubsById);

    const fields = capturedFields();

    const photoFix = fields.find((f) => f.photoUrl === CORRECT_PHOTO);
    expect(
      photoFix,
      [
        `Expected db.update().set({ photoUrl: "${CORRECT_PHOTO}" }) for Damion Downs.`,
        "Captured set() payloads:",
        ...fields.map((f) => `  • ${JSON.stringify(f)}`),
      ].join("\n"),
    ).toBeDefined();
  });

  it("never writes the wrong player's photo URL (291521.png)", async () => {
    const player = {
      id: 77,
      name: "Damion Downs",
      clubId: 1,
      apiFootballPlayerId: WRONG_ID as number | null,
    };
    const clubsById = new Map([
      [1, { id: 1, name: "Hamburger SV", apiFootballTeamId: null, country: "DEU" }],
    ]);

    await ensurePlayerApiFootballIds([player], clubsById);

    const fields = capturedFields();

    const wrongPhotoUpdate = fields.find((f) => f.photoUrl === WRONG_PHOTO);
    expect(
      wrongPhotoUpdate,
      [
        `Found db.update().set({ photoUrl: "${WRONG_PHOTO}" }) — the wrong player's photo URL should never be written.`,
        "Captured set() payloads:",
        ...fields.map((f) => `  • ${JSON.stringify(f)}`),
      ].join("\n"),
    ).toBeUndefined();
  });

  it("still corrects the id and photo when starting from an already-null id (re-entry safety)", async () => {
    // Simulates a scenario where a prior sync cleared the id to null but the
    // photo URL was not yet updated. Without the pin, the next auto-resolution
    // pass could re-resolve to Dylan Downs again.
    const player = {
      id: 77,
      name: "Damion Downs",
      clubId: 1,
      apiFootballPlayerId: null as number | null,
    };
    const clubsById = new Map([
      [1, { id: 1, name: "Hamburger SV", apiFootballTeamId: null, country: "DEU" }],
    ]);

    await ensurePlayerApiFootballIds([player], clubsById);

    const fields = capturedFields();

    // The pin must push the correct id even when starting from null.
    const idFix = fields.find((f) => f.apiFootballPlayerId === CORRECT_ID);
    expect(
      idFix,
      [
        `Expected db.update().set({ apiFootballPlayerId: ${CORRECT_ID} }) even when starting from null.`,
        "Captured set() payloads:",
        ...fields.map((f) => `  • ${JSON.stringify(f)}`),
      ].join("\n"),
    ).toBeDefined();

    // And the correct photo must follow.
    const photoFix = fields.find((f) => f.photoUrl === CORRECT_PHOTO);
    expect(
      photoFix,
      [
        `Expected db.update().set({ photoUrl: "${CORRECT_PHOTO}" }) even when starting from null id.`,
        "Captured set() payloads:",
        ...fields.map((f) => `  • ${JSON.stringify(f)}`),
      ].join("\n"),
    ).toBeDefined();
  });
});
