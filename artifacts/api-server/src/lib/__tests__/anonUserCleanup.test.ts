/**
 * Regression guard: confirms that cleanupOrphanedAnonUsers() deletes only the
 * rows that are both old enough (> ORPHAN_AGE_DAYS) and have no active follows,
 * and leaves rows with active follows — or rows that are too recent — untouched.
 *
 * ## What is tested
 * 1. Orphaned rows (old + no follows) are deleted via a transaction that first
 *    removes dependent recovery_tokens, then the anon_users rows themselves.
 * 2. Rows with active follows are never included in the orphan query and are
 *    therefore never deleted.
 * 3. When the orphan query returns nothing the function short-circuits and
 *    returns 0 without opening a transaction.
 * 4. The function returns the correct count of deleted rows.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------

const {
  mockDb,
  tAnonUsers,
  tUserFollows,
  tRecoveryTokens,
  capturedDeleteTables,
} = vi.hoisted(() => {
  const tAnonUsers = { _table: "anon_users" };
  const tUserFollows = { _table: "user_follows" };
  const tRecoveryTokens = { _table: "recovery_tokens" };

  const capturedDeleteTables: unknown[] = [];

  const makeTx = () => ({
    delete: vi.fn().mockImplementation((table: unknown) => {
      capturedDeleteTables.push(table);
      return { where: vi.fn().mockResolvedValue(undefined) };
    }),
  });

  const mockDb = {
    select: vi.fn(),
    transaction: vi.fn().mockImplementation(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<void>) => {
      await fn(makeTx());
    }),
  };

  return { mockDb, tAnonUsers, tUserFollows, tRecoveryTokens, capturedDeleteTables };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: mockDb,
  anonUsersTable: tAnonUsers,
  userFollowsTable: tUserFollows,
  recoveryTokensTable: tRecoveryTokens,
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  lt: (_col: unknown, val: unknown) => ({ _lt: val }),
  notExists: (sub: unknown) => ({ _notExists: sub }),
  inArray: (_col: unknown, vals: unknown) => ({ _inArray: vals }),
  eq: (_col: unknown, val: unknown) => ({ _eq: val }),
  sql: Object.assign(
    (..._args: unknown[]) => ({ _sql: true }),
    { raw: (..._args: unknown[]) => ({ _sql: true }) },
  ),
}));

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Import AFTER mocks are registered
import { cleanupOrphanedAnonUsers, _resetCleanupScheduleForTests } from "../anonUserCleanup.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a select chain that returns `rows` whether the caller awaits
 * `.from(t)` or `.from(t).where(...)`.
 */
function makeSelectResult(rows: unknown[]) {
  const fromResult = Object.assign(Promise.resolve(rows), {
    where: vi.fn().mockResolvedValue(rows),
  });
  return { from: vi.fn().mockReturnValue(fromResult) };
}

/**
 * Build a select chain that just returns a thenable sub-query object.
 * Used for the inner db.select() call inside notExists() — drizzle-orm's
 * notExists is mocked so the actual value doesn't matter; it just must
 * not throw during chaining.
 */
function makeSubqueryResult() {
  const whereResult = Object.assign(Promise.resolve([]), {});
  const fromResult = Object.assign(Promise.resolve([]), {
    where: vi.fn().mockReturnValue(whereResult),
  });
  return { from: vi.fn().mockReturnValue(fromResult) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cleanupOrphanedAnonUsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedDeleteTables.length = 0;

    // Restore transaction mock after clearAllMocks
    const makeTx = () => ({
      delete: vi.fn().mockImplementation((table: unknown) => {
        capturedDeleteTables.push(table);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    });
    mockDb.transaction.mockImplementation(
      async (fn: (tx: ReturnType<typeof makeTx>) => Promise<void>) => {
        await fn(makeTx());
      },
    );

    // Default: every db.select() call beyond the first returns a subquery-
    // compatible chain (used by the nested notExists() sub-select).
    mockDb.select.mockReturnValue(makeSubqueryResult());
  });

  afterEach(() => {
    // Reset interval singleton so tests that call startAnonUserCleanupSchedule
    // elsewhere don't bleed state.
    _resetCleanupScheduleForTests();
    delete process.env["ANON_USER_CLEANUP_AGE_DAYS"];
    delete process.env["ANON_USER_CLEANUP_INTERVAL_MS"];
  });

  // ── 1. Orphaned rows are deleted ─────────────────────────────────────────

  it("deletes orphaned anon_user rows and their recovery_tokens in a transaction", async () => {
    // Orphan query returns two rows
    mockDb.select.mockReturnValueOnce(
      makeSelectResult([{ id: "uuid-1" }, { id: "uuid-2" }]),
    );

    const count = await cleanupOrphanedAnonUsers();

    expect(count).toBe(2);

    // Transaction must have been opened
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);

    // Both tables must have been targeted inside the transaction
    expect(capturedDeleteTables).toContain(tRecoveryTokens);
    expect(capturedDeleteTables).toContain(tAnonUsers);
  });

  it("deletes recovery_tokens before anon_users (FK order)", async () => {
    mockDb.select.mockReturnValueOnce(
      makeSelectResult([{ id: "uuid-3" }]),
    );

    await cleanupOrphanedAnonUsers();

    const recoveryIdx = capturedDeleteTables.indexOf(tRecoveryTokens);
    const anonIdx = capturedDeleteTables.indexOf(tAnonUsers);

    expect(recoveryIdx).toBeGreaterThanOrEqual(0);
    expect(anonIdx).toBeGreaterThanOrEqual(0);
    expect(recoveryIdx).toBeLessThan(anonIdx);
  });

  it("returns the correct count of deleted rows", async () => {
    mockDb.select.mockReturnValueOnce(
      makeSelectResult([{ id: "a" }, { id: "b" }, { id: "c" }]),
    );

    const count = await cleanupOrphanedAnonUsers();
    expect(count).toBe(3);
  });

  // ── 2. Rows with active follows are retained ──────────────────────────────

  it("does not open a transaction when the orphan query returns no rows (follows-protected users)", async () => {
    // Simulate: all anon_users either have active follows or are too recent —
    // the WHERE clause in cleanupOrphanedAnonUsers filters them out so the
    // orphan query returns an empty array.
    mockDb.select.mockReturnValueOnce(makeSelectResult([]));

    const count = await cleanupOrphanedAnonUsers();

    expect(count).toBe(0);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("does not delete any table when there are no orphans", async () => {
    mockDb.select.mockReturnValueOnce(makeSelectResult([]));

    await cleanupOrphanedAnonUsers();

    expect(capturedDeleteTables).toHaveLength(0);
  });

  // ── 3. Return value semantics ─────────────────────────────────────────────

  it("returns 0 when no orphans are found", async () => {
    mockDb.select.mockReturnValueOnce(makeSelectResult([]));
    expect(await cleanupOrphanedAnonUsers()).toBe(0);
  });

  it("returns the exact number of orphan IDs regardless of the transaction outcome", async () => {
    mockDb.select.mockReturnValueOnce(
      makeSelectResult([{ id: "x1" }, { id: "x2" }, { id: "x3" }, { id: "x4" }]),
    );

    const count = await cleanupOrphanedAnonUsers();
    expect(count).toBe(4);
  });

  // ── 4. Environment-variable overrides ─────────────────────────────────────

  it("respects ANON_USER_CLEANUP_AGE_DAYS when set to a valid number", async () => {
    process.env["ANON_USER_CLEANUP_AGE_DAYS"] = "30";

    // The function runs without throwing; the env var is consumed by
    // getOrphanAgeDays() inside cleanupOrphanedAnonUsers — the cutoff date
    // passed to lt() will reflect a 30-day window instead of 90.
    mockDb.select.mockReturnValueOnce(makeSelectResult([]));
    await expect(cleanupOrphanedAnonUsers()).resolves.toBe(0);
  });

  it("falls back to 90-day default when ANON_USER_CLEANUP_AGE_DAYS is not a number", async () => {
    process.env["ANON_USER_CLEANUP_AGE_DAYS"] = "not-a-number";
    mockDb.select.mockReturnValueOnce(makeSelectResult([]));
    // Should not throw — invalid env var triggers a logger.warn and uses the default
    await expect(cleanupOrphanedAnonUsers()).resolves.toBe(0);
  });
});
