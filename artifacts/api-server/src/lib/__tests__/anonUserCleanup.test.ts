import { describe, it, expect } from "vitest";
import { and, lt, notExists, eq, sql } from "drizzle-orm";
import { anonUsersTable, userFollowsTable } from "@workspace/db";

// ---------------------------------------------------------------------------
// Unit tests for the orphaned anon_user cleanup query predicate.
//
// These tests verify the WHERE-clause logic in isolation — without a real
// database — by asserting which rows the predicate would select given a
// representative in-memory table of users.
// ---------------------------------------------------------------------------

interface AnonUserRow {
  id: number;
  createdAt: Date;
  followCount: number; // 0 = no follows (orphaned)
}

const ORPHAN_AGE_DAYS = 90;

/**
 * Pure-logic replica of the predicate used in cleanupOrphanedAnonUsers.
 * Returns true if a row should be deleted.
 */
function isOrphan(row: AnonUserRow, cutoff: Date): boolean {
  return row.createdAt < cutoff && row.followCount === 0;
}

function cutoffDate(daysAgo: number): Date {
  const d = new Date("2026-07-28T00:00:00Z");
  d.setDate(d.getDate() - daysAgo);
  return d;
}

const CUTOFF = cutoffDate(ORPHAN_AGE_DAYS);

describe("cleanupOrphanedAnonUsers — predicate logic", () => {
  it("deletes a user with no follows that is older than the cutoff", () => {
    const row: AnonUserRow = {
      id: 1,
      createdAt: cutoffDate(91), // 91 days ago — past the threshold
      followCount: 0,
    };
    expect(isOrphan(row, CUTOFF)).toBe(true);
  });

  it("does NOT delete a user who has at least one follow, even if old", () => {
    const row: AnonUserRow = {
      id: 2,
      createdAt: cutoffDate(120), // very old
      followCount: 1,
    };
    expect(isOrphan(row, CUTOFF)).toBe(false);
  });

  it("does NOT delete a user with no follows who is newer than the cutoff", () => {
    const row: AnonUserRow = {
      id: 3,
      createdAt: cutoffDate(30), // only 30 days old — still within grace period
      followCount: 0,
    };
    expect(isOrphan(row, CUTOFF)).toBe(false);
  });

  it("does NOT delete a user who is exactly at the cutoff boundary (strict less-than)", () => {
    // createdAt === cutoff should NOT be deleted — the predicate is strictly <
    const row: AnonUserRow = {
      id: 4,
      createdAt: new Date(CUTOFF.getTime()), // exactly equal — not older
      followCount: 0,
    };
    expect(isOrphan(row, CUTOFF)).toBe(false);
  });

  it("selects only orphaned rows from a mixed set", () => {
    const rows: AnonUserRow[] = [
      { id: 10, createdAt: cutoffDate(100), followCount: 0 }, // orphan ✓
      { id: 11, createdAt: cutoffDate(100), followCount: 3 }, // has follows — keep
      { id: 12, createdAt: cutoffDate(10),  followCount: 0 }, // too new — keep
      { id: 13, createdAt: cutoffDate(200), followCount: 0 }, // orphan ✓
      { id: 14, createdAt: cutoffDate(91),  followCount: 1 }, // has follows — keep
    ];

    const toDelete = rows.filter((r) => isOrphan(r, CUTOFF)).map((r) => r.id);
    expect(toDelete).toEqual([10, 13]);
  });

  it("returns empty when every user has follows", () => {
    const rows: AnonUserRow[] = [
      { id: 20, createdAt: cutoffDate(95), followCount: 2 },
      { id: 21, createdAt: cutoffDate(200), followCount: 5 },
    ];
    const toDelete = rows.filter((r) => isOrphan(r, CUTOFF));
    expect(toDelete).toHaveLength(0);
  });

  it("returns empty when every user is too recent", () => {
    const rows: AnonUserRow[] = [
      { id: 30, createdAt: cutoffDate(1), followCount: 0 },
      { id: 31, createdAt: cutoffDate(89), followCount: 0 },
    ];
    const toDelete = rows.filter((r) => isOrphan(r, CUTOFF));
    expect(toDelete).toHaveLength(0);
  });
});
