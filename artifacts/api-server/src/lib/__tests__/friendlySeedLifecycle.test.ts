/**
 * Regression guard: confirms that the Sept/Oct 2026 USMNT friendly fixture
 * seed is idempotent across the full lifecycle:
 *
 *   seed → bind real positive ID → restart/reseed → exactly one row survives
 *
 * ## Why this matters
 * Earlier implementations used ON CONFLICT (api_football_fixture_id), which
 * fails after the sync binds a real positive ID to a sentinel row: the next
 * restart can't find the sentinel (-2001) and re-inserts it, leaving two rows
 * for the same match.  This test locks in the WHERE NOT EXISTS (match-identity)
 * approach that remains safe regardless of the api_football_fixture_id value.
 *
 * ## What is tested
 * 1. **Pre-seed** — no fixture row exists for the test match.
 * 2. **After first seed** — exactly one row with the sentinel ID is present.
 * 3. **After bind** — sync updates the row: sentinel → real positive ID.
 * 4. **After re-seed (restart simulation)** — still exactly one row, now with
 *    the positive ID; no new sentinel row was inserted.
 * 5. **Dedup sweep** — if a second sentinel is force-inserted alongside the
 *    bound row, the dedup sweep removes it.
 *
 * ## How it works
 * - Uses raw db queries to simulate the seed logic (INSERT … WHERE NOT EXISTS)
 *   and the NT sync bind (UPDATE api_football_fixture_id to a positive value).
 * - Does not call the actual startup seed function (it is embedded in the
 *   server entry point); instead it reproduces the SQL semantics so the test
 *   stays fast and isolated.
 * - afterAll removes all inserted rows.
 */

import { describe, it, expect, afterAll } from "vitest";
import { db, fixturesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

// ─── test parameters ──────────────────────────────────────────────────────────

const SENTINEL_ID   = -9903; // unique sentinel for this test
const REAL_POSITIVE = 9_903_001; // simulated API-Football ID
const HOME          = "USA";
const AWAY          = "__Lifecycle Test Opponent__";
const COMPETITION   = "International Friendly";
const KICKOFF_UTC   = "2026-09-26 20:30:00+00";
const WINDOW_START  = "2026-09-24 00:00:00+00";
const WINDOW_END    = "2026-09-28 23:59:59+00";

// ─── cleanup ─────────────────────────────────────────────────────────────────

afterAll(async () => {
  // Belt-and-suspenders: remove any rows that survived (normal cases clean up
  // in test assertions; this guard handles unexpected failures).
  await db.execute(sql`
    DELETE FROM fixtures
    WHERE (api_football_fixture_id = ${SENTINEL_ID}
        OR api_football_fixture_id = ${REAL_POSITIVE})
      AND home_team   = ${HOME}
      AND away_team   = ${AWAY}
      AND competition = ${COMPETITION}
  `).catch(() => {});
});

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Simulate one run of the seed INSERT … WHERE NOT EXISTS logic. */
async function runSeedInsert(): Promise<number> {
  const result = await db.execute(sql`
    INSERT INTO fixtures (
      api_football_fixture_id, home_team, away_team,
      competition, kickoff, venue, city, is_national_team, status
    )
    SELECT ${SENTINEL_ID}, ${HOME}, ${AWAY},
           ${COMPETITION}, ${KICKOFF_UTC}::timestamptz,
           '__Lifecycle Venue__', '__Lifecycle City, LC__', true, 'scheduled'
    WHERE NOT EXISTS (
      SELECT 1 FROM fixtures
      WHERE home_team        = ${HOME}
        AND away_team        = ${AWAY}
        AND is_national_team = true
        AND competition      = ${COMPETITION}
        AND kickoff BETWEEN ${WINDOW_START}::timestamptz
                        AND ${WINDOW_END}::timestamptz
    )
  `);
  return (result as unknown as { rowCount?: number }).rowCount ?? 0;
}

/** Simulate the dedup sweep (removes sentinel if a bound row exists for the same match). */
async function runDedupSweep(): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM fixtures
    WHERE api_football_fixture_id = ${SENTINEL_ID}
      AND EXISTS (
        SELECT 1 FROM fixtures f2
        WHERE f2.home_team        = ${HOME}
          AND f2.away_team        = ${AWAY}
          AND f2.is_national_team = true
          AND f2.competition      = ${COMPETITION}
          AND f2.api_football_fixture_id > 0
          AND f2.kickoff BETWEEN ${WINDOW_START}::timestamptz
                          AND ${WINDOW_END}::timestamptz
      )
  `);
  return (result as unknown as { rowCount?: number }).rowCount ?? 0;
}

/** Count rows matching the test match identity. */
async function countMatchRows(): Promise<number> {
  const rows = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt
    FROM fixtures
    WHERE home_team        = ${HOME}
      AND away_team        = ${AWAY}
      AND is_national_team = true
      AND competition      = ${COMPETITION}
      AND kickoff BETWEEN ${WINDOW_START}::timestamptz
                      AND ${WINDOW_END}::timestamptz
  `);
  return (rows.rows[0] as { cnt: number } | undefined)?.cnt ?? 0;
}

// ─── suite ───────────────────────────────────────────────────────────────────

describe("USMNT friendly seed — bind → restart lifecycle produces exactly one row", () => {
  it(
    "seed → bind positive ID → re-seed → 1 row only (no duplicate sentinel)",
    async () => {
      // ── Phase 0: pre-condition ─────────────────────────────────────────────
      // Remove any leftover rows from a previous test run.
      await db.execute(sql`
        DELETE FROM fixtures
        WHERE (api_football_fixture_id = ${SENTINEL_ID}
            OR api_football_fixture_id = ${REAL_POSITIVE})
          AND home_team = ${HOME} AND away_team = ${AWAY}
      `);

      expect(await countMatchRows()).toBe(0);

      // ── Phase 1: first seed run ────────────────────────────────────────────
      const inserted = await runSeedInsert();
      expect(inserted, "first seed should insert 1 row").toBe(1);
      expect(await countMatchRows()).toBe(1);

      const [row1] = await db
        .select({ id: fixturesTable.id, afId: fixturesTable.apiFootballFixtureId })
        .from(fixturesTable)
        .where(eq(fixturesTable.apiFootballFixtureId, SENTINEL_ID));
      expect(row1, "sentinel row should exist").toBeDefined();
      const rowId = row1!.id;

      // ── Phase 2: second seed run (idempotency before bind) ─────────────────
      const reInserted = await runSeedInsert();
      expect(reInserted, "second seed should be a no-op (row already exists)").toBe(0);
      expect(await countMatchRows()).toBe(1);

      // ── Phase 3: simulate sync binding the real positive ID ────────────────
      await db
        .update(fixturesTable)
        .set({ apiFootballFixtureId: REAL_POSITIVE })
        .where(eq(fixturesTable.id, rowId));

      const [bound] = await db
        .select({ afId: fixturesTable.apiFootballFixtureId })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, rowId));
      expect(bound?.afId).toBe(REAL_POSITIVE);
      expect(await countMatchRows()).toBe(1); // still 1 row, now with positive ID

      // ── Phase 4: third seed run (restart after bind) ───────────────────────
      const postBindInsert = await runSeedInsert();
      expect(
        postBindInsert,
        "seed after bind should be a no-op — the WHERE NOT EXISTS should find " +
          "the bound row by match identity and not insert a new sentinel",
      ).toBe(0);
      expect(
        await countMatchRows(),
        "there must be exactly 1 row after re-seeding a bound fixture",
      ).toBe(1);

      // Verify the remaining row is the bound one, not a new sentinel.
      const [remaining] = await db
        .select({ afId: fixturesTable.apiFootballFixtureId })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, rowId));
      expect(remaining?.afId, "surviving row should have the real positive ID").toBe(REAL_POSITIVE);

      // ── Phase 5: dedup sweep removes sentinel when bound row coexists ───────
      // Force-insert a sentinel alongside the bound row (simulates a legacy
      // ON CONFLICT–based restart creating a duplicate).
      await db.execute(sql`
        INSERT INTO fixtures (
          api_football_fixture_id, home_team, away_team,
          competition, kickoff, venue, city, is_national_team, status
        ) VALUES (
          ${SENTINEL_ID}, ${HOME}, ${AWAY},
          ${COMPETITION}, ${KICKOFF_UTC}::timestamptz,
          '__Lifecycle Venue__', '__Lifecycle City, LC__', true, 'scheduled'
        )
      `);
      expect(await countMatchRows()).toBe(2); // now 2 rows

      const deduped = await runDedupSweep();
      expect(deduped, "dedup sweep should remove the sentinel row").toBe(1);
      expect(await countMatchRows()).toBe(1); // back to 1

      // Cleanup this test's rows
      await db.execute(sql`
        DELETE FROM fixtures
        WHERE (api_football_fixture_id = ${SENTINEL_ID}
            OR api_football_fixture_id = ${REAL_POSITIVE})
          AND home_team = ${HOME} AND away_team = ${AWAY}
      `);
      expect(await countMatchRows()).toBe(0);
    },
    60_000,
  );
});
