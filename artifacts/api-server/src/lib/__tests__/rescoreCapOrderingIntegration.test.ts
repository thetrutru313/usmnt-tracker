/**
 * Integration test: confirms that `rescoreAllCandidates` respects the real
 * PostgreSQL sort order (`lastScoredAt ASC NULLS FIRST`) when choosing which
 * candidates to process within the cap.
 *
 * ## Why a mock-based unit test is not enough
 * Unit tests in rescoreCapAndSkipCount.test.ts verify cap behaviour but rely
 * on the mock returning rows in the order provided.  If the ORDER BY clause
 * in the function were changed (wrong column, wrong direction, secondary sort
 * key added), those tests would still pass because the mock always returns
 * whatever the test set up.  This integration test exercises the actual
 * PostgreSQL query so any ORDER BY change breaks it immediately.
 *
 * ## Isolation strategy
 * All reads and writes happen inside a single `db.transaction()` call that
 * throws a `RollbackSignal` at the end, rolling back every INSERT and UPDATE.
 * Production candidate rows and signal rows are never permanently mutated.
 *
 * Inside the transaction:
 *   1. All existing `player_candidates` rows that would appear in the rescore
 *      query are cleared (via DELETE within the transaction) so the function
 *      operates on a self-contained, predictable pool.
 *   2. Related `eligibility_signals` rows are cleared first to satisfy the FK.
 *   3. Seven test candidates are inserted with explicit `lastScoredAt` values:
 *        • 1 row  — NULL (NULLS FIRST → processed slot 1)
 *        • 3 rows — dates 2020-01-01, 2020-03-15, 2020-07-04 (oldest dated → slots 2–4)
 *        • 1 row  — manual-override (excluded before cap is applied)
 *        • 2 rows — 2099-01-01, 2099-06-15 (newest → deferred beyond cap = 4)
 *   4. The direct ORDER BY query (Part A) runs BEFORE rescoreAllCandidates.
 *   5. rescoreAllCandidates runs with cap = 4 and `_db = tx` so it uses
 *      the same transaction connection (Part B).
 *   6. The captured results and snapshots are stashed for assertions.
 *   7. RollbackSignal is thrown → all changes are rolled back.
 *
 * `rescoreAllCandidates` accepts an optional `_db` parameter (added for this
 * test) that lets callers inject a transaction-scoped Drizzle instance.
 *
 * Only afFetch, evaluateEligibility, the eligibility-config helpers, and the
 * logger are mocked — all DB operations (select, insert, update, delete) run
 * against the real PostgreSQL instance inside the transaction.
 */

import { vi, describe, it, expect, beforeAll } from "vitest";

// ---------------------------------------------------------------------------
// Mock only external / non-DB dependencies
// ---------------------------------------------------------------------------

const { mockAfFetch } = vi.hoisted(() => ({ mockAfFetch: vi.fn() }));

vi.mock("../apiFootballSync.js", () => ({
  afFetch: mockAfFetch,
  apiKey: vi.fn().mockReturnValue("test-key"),
  syncApiFootballFixtures: vi.fn().mockResolvedValue(undefined),
  syncNationalTeamFixtures: vi.fn().mockResolvedValue(undefined),
  syncYouthNtFixtures: vi.fn().mockResolvedValue(undefined),
  isFriendlyLeague: vi.fn().mockReturnValue(false),
}));

vi.mock("../playerStatsSync.js", () => ({
  isFriendlyLeague: vi.fn().mockReturnValue(false),
  syncPlayerStatsAndInjuries: vi.fn().mockResolvedValue(undefined),
  syncStatsForFinishedFixture: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../evaluateEligibility.js", () => ({
  evaluateEligibility: vi.fn().mockReturnValue({
    score: 60,
    status: "US_ELIGIBLE_PROSPECT",
    signals: [], // empty → persistSignals is a no-op; no eligibility_signals writes
  }),
  detectSeniorNonUsCaps: vi.fn().mockReturnValue(false),
  countNationalTeamCaps: vi.fn().mockReturnValue({ seniorCaps: 0, youthCaps: 0 }),
}));

vi.mock("../eligibilitySignalsConfig.js", () => ({
  getMinEligibilityScore: vi.fn().mockReturnValue(30),
  getMaxCandidateAge: vi.fn().mockReturnValue(99),
  getWeightFingerprint: vi.fn().mockReturnValue("test-fingerprint"),
  getResolvedWeights: vi.fn().mockReturnValue({}),
  SIGNAL_REGISTRY: [],
}));

// ---------------------------------------------------------------------------
// Real DB imports — NOT mocked
// ---------------------------------------------------------------------------

import { db, playerCandidatesTable, eligibilitySignalsTable, clubsTable } from "@workspace/db";
import { or, eq, isNull, sql } from "drizzle-orm";
import { rescoreAllCandidates } from "../playerDiscovery.js";

// ---------------------------------------------------------------------------
// Sentinel thrown to force a transaction rollback
// ---------------------------------------------------------------------------

class RollbackSignal extends Error {
  constructor() {
    super("integration-test rollback");
    this.name = "RollbackSignal";
  }
}

// ---------------------------------------------------------------------------
// Test-candidate definitions
// ---------------------------------------------------------------------------

/**
 * Club id used for the FK constraint on player_candidates.club_id.
 * Resolved inside the rolled-back transaction — no seed row required.
 */
let testClubId: number;

/**
 * Seven candidates seeded inside the transaction (apiFootballPlayerId values
 * are in the 999_001_xxx range, reserved for integration tests).
 *
 * The cap is 4.  Expected outcomes:
 *   999_001_100  lastScoredAt = NULL          → processed 1st  (NULLS FIRST)
 *   999_001_101  lastScoredAt = 2020-01-01    → processed 2nd  (oldest dated)
 *   999_001_102  lastScoredAt = 2020-03-15    → processed 3rd
 *   999_001_103  lastScoredAt = 2020-07-04    → processed 4th
 *   999_001_104  isManualOverride = true       → excluded before cap; never processed
 *   999_001_105  lastScoredAt = 2099-01-01    → deferred (beyond cap)
 *   999_001_106  lastScoredAt = 2099-06-15    → deferred (beyond cap)
 */
const SEED_ROWS = [
  {
    apiFootballPlayerId: 999_001_100,
    lastScoredAt: null,
    isManualOverride: false,
    label: "NULL lastScoredAt",
  },
  {
    apiFootballPlayerId: 999_001_101,
    lastScoredAt: new Date("2020-01-01T00:00:00Z"),
    isManualOverride: false,
    label: "2020-01-01 (oldest dated)",
  },
  {
    apiFootballPlayerId: 999_001_102,
    lastScoredAt: new Date("2020-03-15T00:00:00Z"),
    isManualOverride: false,
    label: "2020-03-15",
  },
  {
    apiFootballPlayerId: 999_001_103,
    lastScoredAt: new Date("2020-07-04T00:00:00Z"),
    isManualOverride: false,
    label: "2020-07-04",
  },
  {
    apiFootballPlayerId: 999_001_104,
    lastScoredAt: new Date("2020-02-01T00:00:00Z"),
    isManualOverride: true, // excluded before cap
    label: "manual-override (excluded pre-cap)",
  },
  {
    apiFootballPlayerId: 999_001_105,
    lastScoredAt: new Date("2099-01-01T00:00:00Z"),
    isManualOverride: false,
    label: "2099-01-01 (far future, deferred)",
  },
  {
    apiFootballPlayerId: 999_001_106,
    lastScoredAt: new Date("2099-06-15T00:00:00Z"),
    isManualOverride: false,
    label: "2099-06-15 (far future, deferred)",
  },
] as const;

const CAP = 4; // smaller than the 5-row rescorable pool (excludes manual-override)

/** apiFootballPlayerIds that must be processed (null + 3 oldest dated) */
const PROCESSED_API_IDS = [999_001_100, 999_001_101, 999_001_102, 999_001_103] as const;

/** apiFootballPlayerIds that must be deferred (2 far-future rows) */
const DEFERRED_API_IDS = [999_001_105, 999_001_106] as const;

/** Minimal API-Football stats payload that passes the re-fetch guard. */
const MOCK_STATS = [
  {
    player: {
      nationality: "USA",
      birth: { country: "USA", date: "2001-04-10", place: "Portland, Oregon" },
    },
    statistics: [
      {
        team: { id: 6, name: "Portland FC" },
        league: { name: "MLS", season: 2026 },
        games: { lineups: 18, minutes: 1620, position: "MF", rating: "7.20" },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Shared state captured during the rolled-back transaction
// ---------------------------------------------------------------------------

/** Rows returned by the direct ORDER BY query (Part A) — captured before rescoreAllCandidates runs. */
let orderedRows: Array<{ apiFootballPlayerId: number | null; lastScoredAt: Date | null }>;

/** Return value from rescoreAllCandidates (Part B). */
let runResult: Awaited<ReturnType<typeof rescoreAllCandidates>>;

/** Snapshot of the seven test rows taken AFTER rescoreAllCandidates ran, still inside the transaction. */
let rowsAfterRun: Array<{ apiFootballPlayerId: number | null; lastScoredAt: Date | null }>;

/** Timestamp captured just before the function call so we can detect writes from this run. */
let beforeRunTime: Date;
/** Timestamp captured just after the function call. */
let afterRunTime: Date;

// ---------------------------------------------------------------------------
// One-time setup: run everything inside a rolled-back transaction
// ---------------------------------------------------------------------------

beforeAll(async () => {
  mockAfFetch.mockResolvedValue(MOCK_STATS);

  try {
    await db.transaction(async (tx) => {
      // 0. Insert a sentinel club row to satisfy player_candidates.club_id FK.
      //    The transaction rollback removes it automatically — no afterAll needed.
      const [sentinelClub] = await tx
        .insert(clubsTable)
        .values({ name: "CI Sentinel Club [rescore-ordering-test]", league: "MLS", country: "USA" })
        .returning({ id: clubsTable.id });
      if (!sentinelClub) throw new Error("Failed to insert sentinel club for rescore ordering test");
      testClubId = sentinelClub.id;

      // 1. Delete eligibility_signals first (FK → player_candidates).
      //    These are production rows, but the rollback will restore them.
      await tx.delete(eligibilitySignalsTable);

      // 2. Clear all player_candidates rows that would match the rescore
      //    query (status = 'pending' OR eligibility_confidence IS NULL).
      //    Rows with status = 'dismissed' / 'promoted' AND a non-null
      //    confidence score are left alone — they are invisible to the
      //    function anyway.
      //    Because this runs inside the transaction, production data is
      //    fully restored when we roll back.
      await tx.delete(playerCandidatesTable).where(
        or(
          eq(playerCandidatesTable.status, "pending"),
          isNull(playerCandidatesTable.eligibilityConfidence),
        ),
      );

      // 3. Insert the seven test candidates.
      for (const row of SEED_ROWS) {
        await tx.insert(playerCandidatesTable).values({
          name: `Integration Test Candidate ${row.apiFootballPlayerId}`,
          eligibilityBasis: "nationality",
          status: "pending" as const,
          apiFootballPlayerId: row.apiFootballPlayerId,
          clubId: testClubId,
          isManualOverride: row.isManualOverride,
          ...(row.lastScoredAt != null ? { lastScoredAt: row.lastScoredAt } : {}),
        });
      }

      // -----------------------------------------------------------------------
      // Part A — capture ordering BEFORE rescoreAllCandidates touches anything.
      // -----------------------------------------------------------------------
      const allTestApiIds = SEED_ROWS.map((r) => r.apiFootballPlayerId);
      orderedRows = await tx
        .select({
          apiFootballPlayerId: playerCandidatesTable.apiFootballPlayerId,
          lastScoredAt: playerCandidatesTable.lastScoredAt,
        })
        .from(playerCandidatesTable)
        .orderBy(sql`${playerCandidatesTable.lastScoredAt} ASC NULLS FIRST`);

      // Keep only our test rows for ordering assertions (extra safety in case
      // any non-rescorable production rows survived the delete above).
      orderedRows = orderedRows.filter((r) =>
        allTestApiIds.includes(r.apiFootballPlayerId as (typeof allTestApiIds)[number]),
      );

      // -----------------------------------------------------------------------
      // Part B — call rescoreAllCandidates with the transaction-scoped DB.
      // -----------------------------------------------------------------------
      await new Promise((r) => setTimeout(r, 30));
      beforeRunTime = new Date();
      await new Promise((r) => setTimeout(r, 30));

      // Pass `tx` as the DB so all reads and writes use the same transaction.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runResult = await rescoreAllCandidates({ maxCandidates: CAP, _db: tx as any });

      afterRunTime = new Date();

      // 4. Snapshot the test rows to check which were updated.
      rowsAfterRun = await tx
        .select({
          apiFootballPlayerId: playerCandidatesTable.apiFootballPlayerId,
          lastScoredAt: playerCandidatesTable.lastScoredAt,
        })
        .from(playerCandidatesTable)
        .where(sql`${playerCandidatesTable.apiFootballPlayerId} >= 999001100 AND ${playerCandidatesTable.apiFootballPlayerId} <= 999001199`);

      // 5. Roll back ALL changes — production data fully restored.
      throw new RollbackSignal();
    });
  } catch (err) {
    // Swallow only our deliberate rollback sentinel; re-throw real errors.
    if (!(err instanceof RollbackSignal)) throw err;
  }
});

// ---------------------------------------------------------------------------
// Helper: was the test row for the given apiId updated by rescoreAllCandidates?
// ---------------------------------------------------------------------------

function wasProcessed(apiId: number): boolean {
  const row = rowsAfterRun.find((r) => r.apiFootballPlayerId === apiId);
  if (!row?.lastScoredAt) return false;
  const t = row.lastScoredAt.getTime();
  return t > beforeRunTime.getTime() && t <= afterRunTime.getTime();
}

// ===========================================================================
// Part A — DB SELECT ordering
// ===========================================================================

describe("DB SELECT ordering: lastScoredAt ASC NULLS FIRST", () => {
  it("returns all seven seeded rows", () => {
    expect(orderedRows).toHaveLength(7);
  });

  it("places the NULL-lastScoredAt row first (NULLS FIRST)", () => {
    expect(orderedRows[0]!.lastScoredAt).toBeNull();
    expect(orderedRows[0]!.apiFootballPlayerId).toBe(999_001_100);
  });

  it("places the four 2020-dated rows before the two 2099-dated rows", () => {
    const ids = orderedRows.map((r) => r.apiFootballPlayerId);

    // All 2020 IDs must appear before any 2099 ID
    const past2020Ids = [999_001_101, 999_001_102, 999_001_103, 999_001_104];
    const future2099Ids = [999_001_105, 999_001_106];

    const lastPastIndex = Math.max(...past2020Ids.map((id) => ids.indexOf(id)));
    const firstFutureIndex = Math.min(...future2099Ids.map((id) => ids.indexOf(id)));

    expect(lastPastIndex).toBeLessThan(firstFutureIndex);
  });

  it("sorts the 2020-dated rows in ascending chronological order", () => {
    const past2020Ids = [999_001_101, 999_001_102, 999_001_103, 999_001_104];
    const pastRows = orderedRows.filter((r) =>
      past2020Ids.includes(r.apiFootballPlayerId as number),
    );
    expect(pastRows).toHaveLength(4);
    for (let i = 1; i < pastRows.length; i++) {
      expect(pastRows[i - 1]!.lastScoredAt!.getTime()).toBeLessThanOrEqual(
        pastRows[i]!.lastScoredAt!.getTime(),
      );
    }
  });

  it("sorts the 2099-dated rows in ascending chronological order", () => {
    const future2099Ids = [999_001_105, 999_001_106];
    const futureRows = orderedRows.filter((r) =>
      future2099Ids.includes(r.apiFootballPlayerId as number),
    );
    expect(futureRows).toHaveLength(2);
    expect(futureRows[0]!.lastScoredAt!.getTime()).toBeLessThanOrEqual(
      futureRows[1]!.lastScoredAt!.getTime(),
    );
  });
});

// ===========================================================================
// Part B — rescoreAllCandidates cap behaviour (isolated pool, real DB)
// ===========================================================================

describe("rescoreAllCandidates — cap defers far-future rows (isolated real DB)", () => {
  it("returns processed = 4 (cap) and skipped = 2 for the 6-row rescorable pool", () => {
    // Rescorable pool = 5 non-override rows (manual-override is excluded pre-cap).
    // cap = 4 → processed = 4, skipped = 1 (the 5th rescorable row after slicing).
    // Wait: the pool has 5 rescorable rows (IDs 100, 101, 102, 103, 105, 106 minus
    // the override 104 = 6 rows). skipped = 6 - 4 = 2.
    expect(runResult.processed).toBe(4);
    expect(runResult.skipped).toBe(2);
  });

  it("processes the NULL-lastScoredAt row (NULLS FIRST makes it 1st)", () => {
    expect(wasProcessed(999_001_100)).toBe(true);
  });

  it("processes the three oldest-dated rows (2020-01-01, 2020-03-15, 2020-07-04)", () => {
    expect(wasProcessed(999_001_101)).toBe(true); // 2020-01-01
    expect(wasProcessed(999_001_102)).toBe(true); // 2020-03-15
    expect(wasProcessed(999_001_103)).toBe(true); // 2020-07-04
  });

  it("does NOT process the manual-override row (excluded before cap is applied)", () => {
    expect(wasProcessed(999_001_104)).toBe(false);
  });

  it("defers both far-future rows (2099 dates are beyond the cap window)", () => {
    expect(wasProcessed(999_001_105)).toBe(false); // 2099-01-01
    expect(wasProcessed(999_001_106)).toBe(false); // 2099-06-15
  });

  it("assigns a fresh lastScoredAt to each processed row", () => {
    for (const apiId of PROCESSED_API_IDS) {
      const row = rowsAfterRun.find((r) => r.apiFootballPlayerId === apiId);
      expect(row?.lastScoredAt, `candidate ${apiId} lastScoredAt should be set`).toBeDefined();
      expect(
        row!.lastScoredAt!.getTime() > beforeRunTime.getTime(),
        `candidate ${apiId} lastScoredAt should be after the run started`,
      ).toBe(true);
    }
  });

  it("leaves far-future lastScoredAt unchanged on deferred rows", () => {
    for (const apiId of DEFERRED_API_IDS) {
      const row = rowsAfterRun.find((r) => r.apiFootballPlayerId === apiId);
      expect(row?.lastScoredAt?.getFullYear()).toBe(2099);
    }
  });
});
