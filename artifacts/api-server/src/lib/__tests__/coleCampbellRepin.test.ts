/**
 * Regression guard: confirms that Cole Campbell's API-Football player id is
 * pinned to 328617 (SV Elversberg, correct) rather than 102301 (Houston Dash
 * W, false-positive from the automated squad-search path).
 *
 * ## Why this test exists
 * The automated player-id resolver searched the Houston Dash squad (Cole
 * Campbell's old club row), matched "C. Campbell" to a female Houston Dash
 * player (id=102301), and wrote that id to the DB.  A `" W" suffix guard` was
 * added to the national-team check to prevent women's sides from being
 * assigned as a primary club, but without this pin the player would remain
 * stuck on the wrong api_football_player_id indefinitely because the old id was
 * already stored and the resolver skips players that already have one.
 *
 * The fix: `KNOWN_PLAYER_IDS["Cole Campbell"] = 328617`.
 * `applyKnownPlayerIdOverrides` enforces this even when a different id is
 * already stored — this test confirms that guarantee is intact.
 *
 * ## What is tested
 * 1. KNOWN_PLAYER_IDS contains "Cole Campbell" mapped to 328617 (not null,
 *    not 102301).
 * 2. `applyKnownPlayerIdOverrides` (via `ensurePlayerApiFootballIds`) updates
 *    the DB from the old false-positive id (102301) to the correct id (328617)
 *    in a single sync pass — confirming the pin overrides an already-stored id.
 * 3. The correct photo URL uses the new id (media.api-sports.io/...328617.png).
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared mock state — vi.hoisted so factories run before vi.mock calls.
// ---------------------------------------------------------------------------

const CORRECT_PLAYER_ID = 328617;
const OLD_WRONG_ID = 102301; // Houston Dash W false-positive

const { mockDb, tPlayers, setCaptured, mockLogger } = vi.hoisted(() => {
  const tPlayers = { _table: "players" };

  const setCaptured: Array<Record<string, unknown>> = [];

  const mockDb = {
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((fields: Record<string, unknown>) => {
        setCaptured.push(fields);
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

  return { mockDb, tPlayers, setCaptured, mockLogger };
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
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  setCaptured.length = 0;

  mockDb.update.mockImplementation(() => ({
    set: vi.fn().mockImplementation((fields: Record<string, unknown>) => {
      setCaptured.push(fields);
      return { where: vi.fn().mockResolvedValue(undefined) };
    }),
  }));
  mockDb.delete.mockImplementation(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
  mockDb.insert.mockImplementation(() => ({ values: vi.fn().mockResolvedValue(undefined) }));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Cole Campbell re-pin guard", () => {
  it("KNOWN_PLAYER_IDS pins Cole Campbell to the SV Elversberg id (328617), not the Houston Dash W id", () => {
    expect(KNOWN_PLAYER_IDS["Cole Campbell"]).toBe(CORRECT_PLAYER_ID);
    expect(KNOWN_PLAYER_IDS["Cole Campbell"]).not.toBe(OLD_WRONG_ID);
    expect(KNOWN_PLAYER_IDS["Cole Campbell"]).not.toBeNull();
  });

  it("applyKnownPlayerIdOverrides updates api_football_player_id from the old false-positive (102301) to the correct id (328617)", async () => {
    const player = {
      id: 47, // Cole Campbell's real player row id
      name: "Cole Campbell",
      clubId: 1883, // Houston Dash W — old wrong club
      apiFootballPlayerId: OLD_WRONG_ID as number | null,
    };
    const clubsById = new Map([
      [1883, { id: 1883, name: "Houston Dash W", apiFootballTeamId: 2998, country: "Unknown" }],
    ]);

    await ensurePlayerApiFootballIds([player], clubsById);

    // The player object should have been mutated to the correct id in memory.
    expect(player.apiFootballPlayerId).toBe(CORRECT_PLAYER_ID);

    // A db.update().set({ apiFootballPlayerId: 328617 }) call must have fired.
    const idUpdatePayload = setCaptured.find(
      (p) => p.apiFootballPlayerId === CORRECT_PLAYER_ID,
    );
    expect(
      idUpdatePayload,
      [
        `Expected a db.update().set({ apiFootballPlayerId: ${CORRECT_PLAYER_ID} }) call`,
        `to correct the Houston Dash W false-positive (${OLD_WRONG_ID}).`,
        "Captured set() payloads:",
        ...setCaptured.map((p) => `  • ${JSON.stringify(p)}`),
      ].join("\n"),
    ).toBeDefined();
  });

  it("applyKnownPlayerIdOverrides also fires when the old id is already correct (idempotent re-pin)", async () => {
    // Simulate the DB already having the correct id — the override should be a no-op
    // (applyKnownPlayerIdOverrides skips players whose stored id already matches).
    const player = {
      id: 47,
      name: "Cole Campbell",
      clubId: 41, // SV Elversberg — correct club
      apiFootballPlayerId: CORRECT_PLAYER_ID as number | null,
    };
    const clubsById = new Map([
      [41, { id: 41, name: "SV Elversberg", apiFootballTeamId: 1660, country: "Germany" }],
    ]);

    await ensurePlayerApiFootballIds([player], clubsById);

    // Player object is still correct after the call.
    expect(player.apiFootballPlayerId).toBe(CORRECT_PLAYER_ID);

    // No incorrect id must have been written.
    const wrongIdUpdate = setCaptured.find(
      (p) => p.apiFootballPlayerId === OLD_WRONG_ID,
    );
    expect(
      wrongIdUpdate,
      `applyKnownPlayerIdOverrides must never write the old Houston Dash W id (${OLD_WRONG_ID}) back.`,
    ).toBeUndefined();
  });

  it("photo URL is set to the SV Elversberg player id path, not the Houston Dash W path", async () => {
    const player = {
      id: 47,
      name: "Cole Campbell",
      clubId: 1883,
      apiFootballPlayerId: OLD_WRONG_ID as number | null,
    };
    const clubsById = new Map([
      [1883, { id: 1883, name: "Houston Dash W", apiFootballTeamId: 2998, country: "Unknown" }],
    ]);

    await ensurePlayerApiFootballIds([player], clubsById);

    // syncResolvedPlayerPhotos should set the photo URL using the NEW id.
    const photoUpdate = setCaptured.find(
      (p) => typeof p.photoUrl === "string" && (p.photoUrl as string).includes(String(CORRECT_PLAYER_ID)),
    );
    expect(
      photoUpdate,
      [
        `Expected photo URL to use the correct player id (${CORRECT_PLAYER_ID}).`,
        "Captured set() payloads:",
        ...setCaptured.map((p) => `  • ${JSON.stringify(p)}`),
      ].join("\n"),
    ).toBeDefined();

    // The old Houston Dash W photo URL must not have been written.
    const oldPhotoUpdate = setCaptured.find(
      (p) => typeof p.photoUrl === "string" && (p.photoUrl as string).includes(String(OLD_WRONG_ID)),
    );
    expect(
      oldPhotoUpdate,
      `Photo URL must not reference the old Houston Dash W player id (${OLD_WRONG_ID}).`,
    ).toBeUndefined();
  });
});
