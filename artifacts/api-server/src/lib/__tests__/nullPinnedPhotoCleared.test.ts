/**
 * Unit guard: confirms that `applyKnownPlayerIdOverrides` clears BOTH
 * `apiFootballPlayerId` AND `photoUrl` when a player is null-pinned in
 * KNOWN_PLAYER_IDS.
 *
 * ## Why this test exists (Task #170)
 * A null-pinned player's id is correctly cleared, but if a stale photo URL
 * had already been written before the null pin landed it would remain visible
 * on the profile page even though the id was nulled out. The fix clears both
 * fields in the same `db.update()` call. This test confirms:
 *
 * 1. Both fields are cleared when the player already has a wrong id stored.
 * 2. Both fields are cleared even when `apiFootballPlayerId` is already null
 *    (i.e. the update is idempotent — a stale photo can exist even without an id).
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared mock state — vi.hoisted so factories run before vi.mock calls.
// ---------------------------------------------------------------------------

const { mockDb, tPlayers, mockLogger } = vi.hoisted(() => {
  const tPlayers = { _table: "players" };

  const setCaptured: Array<Record<string, unknown>> = [];

  const mockDb = {
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((fields: Record<string, unknown>) => {
        setCaptured.push(fields);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
    // ensurePlayerApiFootballIds also calls resolvePlayerIdsViaSquads which
    // does a select; return empty to skip that path cleanly.
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
// Helpers
// ---------------------------------------------------------------------------

/** Pick any null-pinned name from the live KNOWN_PLAYER_IDS map. */
function nullPinnedName(): string {
  const entry = Object.entries(KNOWN_PLAYER_IDS).find(([, v]) => v === null);
  if (!entry) throw new Error("No null-pinned entry found in KNOWN_PLAYER_IDS — add one to run this test.");
  return entry[0];
}

/** Extract all `.set(...)` payloads captured across all db.update() chains. */
function capturedSetPayloads(): Array<Record<string, unknown>> {
  return mockDb._setCaptured;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockDb._setCaptured.length = 0; // reset captured payloads

  // Restore implementations after clearAllMocks.
  mockDb.update.mockImplementation(() => ({
    set: vi.fn().mockImplementation((fields: Record<string, unknown>) => {
      mockDb._setCaptured.push(fields);
      return { where: vi.fn().mockResolvedValue(undefined) };
    }),
  }));
  mockDb.delete.mockImplementation(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
  mockDb.insert.mockImplementation(() => ({ values: vi.fn().mockResolvedValue(undefined) }));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("applyKnownPlayerIdOverrides — null-pinned player clears both id and photo", () => {
  it("clears apiFootballPlayerId AND photoUrl together when a stale id is already stored", async () => {
    const name = nullPinnedName();
    const player = {
      id: 999,
      name,
      clubId: 1,
      apiFootballPlayerId: 171435 as number | null, // simulate a previously-resolved wrong id
    };
    const clubsById = new Map([
      [1, { id: 1, name: "Test Club", apiFootballTeamId: null, country: "USA" }],
    ]);

    await ensurePlayerApiFootballIds([player], clubsById);

    const payloads = capturedSetPayloads();

    // There must be at least one update that clears both fields at once.
    const clearingUpdate = payloads.find(
      (p) => p.apiFootballPlayerId === null && p.photoUrl === null,
    );

    expect(
      clearingUpdate,
      [
        `Expected a db.update().set({ apiFootballPlayerId: null, photoUrl: null }) call for null-pinned player "${name}".`,
        "Captured set() payloads:",
        ...payloads.map((p) => `  • ${JSON.stringify(p)}`),
      ].join("\n"),
    ).toBeDefined();
  });

  it("clears photoUrl even when apiFootballPlayerId is already null (idempotent)", async () => {
    const name = nullPinnedName();
    const player = {
      id: 999,
      name,
      clubId: 1,
      apiFootballPlayerId: null as number | null, // id already cleared — photo might still be stale
    };
    const clubsById = new Map([
      [1, { id: 1, name: "Test Club", apiFootballTeamId: null, country: "USA" }],
    ]);

    await ensurePlayerApiFootballIds([player], clubsById);

    const payloads = capturedSetPayloads();

    // The clearing update must still fire even when the id was already null.
    const clearingUpdate = payloads.find(
      (p) => p.apiFootballPlayerId === null && p.photoUrl === null,
    );

    expect(
      clearingUpdate,
      [
        `Expected a db.update().set({ apiFootballPlayerId: null, photoUrl: null }) call for null-pinned player "${name}" even when apiFootballPlayerId was already null.`,
        "Captured set() payloads:",
        ...payloads.map((p) => `  • ${JSON.stringify(p)}`),
      ].join("\n"),
    ).toBeDefined();
  });
});
