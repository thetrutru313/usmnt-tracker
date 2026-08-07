/**
 * Guards the ordering fix in promoteNtSentinelIds() that prevents silent data
 * corruption when two sentinel fixtures have overlapping ±7-day candidate windows.
 *
 * ## The problem it prevents
 * The Sept 26 and Sept 29 USMNT fixtures are 3 days apart; their ±7-day windows
 * overlap almost completely. If the query returns them in arbitrary order and
 * the Sept 29 sentinel is processed first, it claims the Sept 26 match log,
 * writes the wrong api_football_fixture_id, and the correct Sept 26 fixture
 * stays unbound right as its match goes live. The per-fixture try/catch then
 * catches the constraint on the correct fixture, leaving wrong data silently in
 * place.
 *
 * ## Fix
 * The initial query now uses ORDER BY kickoff ASC so the earlier fixture always
 * wins the shared candidate log. The later fixture then hits a unique-constraint
 * collision and stays unbound — which is correct, since its match has not yet
 * been played.
 *
 * ## What is tested
 * Phase 1 — only the earlier match has been played:
 *   - Early sentinel (Sept 26) and late sentinel (Sept 29) are both unbound.
 *   - Only the Sept 26 match log exists (apiFootballFixtureId = REAL_EARLY).
 *   - Both sentinels find it as their only candidate (windows overlap).
 *   - After promoteNtSentinelIds():
 *       • Early sentinel → REAL_EARLY  ✓
 *       • Late sentinel  → unchanged (still negative)  ✓
 *
 * Phase 2 — the later match has also been played:
 *   - Sept 29 log (apiFootballFixtureId = REAL_LATE) is inserted.
 *   - After promoteNtSentinelIds():
 *       • Early sentinel still REAL_EARLY (already positive, filtered out)  ✓
 *       • Late sentinel → REAL_LATE  ✓ (date proximity breaks the tie)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, fixturesTable, fixturePlayersTable, matchLogsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { promoteNtSentinelIds } from "../usmntSync.js";

// ─── test identifiers ─────────────────────────────────────────────────────────

// Sentinel IDs: unique to this test suite, non-colliding with ntSentinelPromotion.test.ts
const SENTINEL_EARLY = -9811; // Sept 26 fixture (earlier kickoff)
const SENTINEL_LATE  = -9812; // Sept 29 fixture (later kickoff, overlapping window)

const REAL_EARLY = 9_811_001; // real API-Football ID for the Sept 26 match
const REAL_LATE  = 9_811_002; // real API-Football ID for the Sept 29 match

// Sept 26 and Sept 29 — 3 days apart so ±7-day windows overlap maximally.
const KICKOFF_EARLY = "2099-09-26 20:30:00+00";
const KICKOFF_LATE  = "2099-09-29 22:30:00+00";

const LOG_DATE_EARLY = "2099-09-26"; // within early window; also within late window
const LOG_DATE_LATE  = "2099-09-29"; // within late window; also within early window

const CLUB_NAME   = "__nt_overlap_test_club__";
const PLAYER_SLUG = "__nt-overlap-test-player__";

// ─── shared state ─────────────────────────────────────────────────────────────

let clubId        = 0;
let playerId      = 0;
let fixtureEarlyId = 0;
let fixtureLateId  = 0;
let earlyLogId     = 0;
let lateLogId      = 0;

// ─── setup & teardown ────────────────────────────────────────────────────────

beforeAll(async () => {
  // Pre-cleanup in case a previous run crashed.
  await db.execute(sql`
    DELETE FROM match_logs WHERE player_id IN (
      SELECT id FROM players WHERE slug = ${PLAYER_SLUG}
    )
  `).catch(() => {});
  await db.execute(sql`
    DELETE FROM fixture_players WHERE fixture_id IN (
      SELECT id FROM fixtures WHERE api_football_fixture_id IN (
        ${SENTINEL_EARLY}, ${SENTINEL_LATE}
      )
    )
  `).catch(() => {});
  await db.execute(sql`
    DELETE FROM fixtures WHERE api_football_fixture_id IN (
      ${SENTINEL_EARLY}, ${SENTINEL_LATE}, ${REAL_EARLY}, ${REAL_LATE}
    )
  `).catch(() => {});
  await db.execute(sql`DELETE FROM players WHERE slug = ${PLAYER_SLUG}`).catch(() => {});
  await db.execute(sql`DELETE FROM clubs WHERE name = ${CLUB_NAME}`).catch(() => {});

  // Throwaway club and player for FK integrity.
  const clubRows = await db.execute(sql`
    INSERT INTO clubs (name, league, country)
    VALUES (${CLUB_NAME}, '__test_league__', '__test_country__')
    RETURNING id
  `);
  clubId = (clubRows.rows[0] as { id: number }).id;

  const playerRows = await db.execute(sql`
    INSERT INTO players (name, slug, position, category, club_id, age)
    VALUES ('__Nt Overlap Test Player__', ${PLAYER_SLUG}, 'MF', 'current', ${clubId}, 24)
    RETURNING id
  `);
  playerId = (playerRows.rows[0] as { id: number }).id;

  // Two sentinel fixtures 3 days apart.
  const fxEarly = await db.execute(sql`
    INSERT INTO fixtures (
      api_football_fixture_id, home_team, away_team,
      competition, kickoff, venue, is_national_team, status
    ) VALUES (
      ${SENTINEL_EARLY}, 'USA', '__Overlap Opponent A__',
      'International Friendly', ${KICKOFF_EARLY}::timestamptz,
      '__overlap_venue__', true, 'scheduled'
    )
    RETURNING id
  `);
  fixtureEarlyId = (fxEarly.rows[0] as { id: number }).id;

  const fxLate = await db.execute(sql`
    INSERT INTO fixtures (
      api_football_fixture_id, home_team, away_team,
      competition, kickoff, venue, is_national_team, status
    ) VALUES (
      ${SENTINEL_LATE}, 'USA', '__Overlap Opponent B__',
      'International Friendly', ${KICKOFF_LATE}::timestamptz,
      '__overlap_venue__', true, 'scheduled'
    )
    RETURNING id
  `);
  fixtureLateId = (fxLate.rows[0] as { id: number }).id;

  // Link the same player to both fixtures (mimics a player appearing in both games).
  await db.execute(sql`
    INSERT INTO fixture_players (fixture_id, player_id)
    VALUES (${fixtureEarlyId}, ${playerId}),
           (${fixtureLateId},  ${playerId})
  `);
});

afterAll(async () => {
  // Tear down in FK order.
  if (earlyLogId) {
    await db.execute(sql`DELETE FROM match_logs WHERE id = ${earlyLogId}`).catch(() => {});
  }
  if (lateLogId) {
    await db.execute(sql`DELETE FROM match_logs WHERE id = ${lateLogId}`).catch(() => {});
  }

  for (const fxId of [fixtureEarlyId, fixtureLateId]) {
    if (fxId) {
      await db.execute(sql`DELETE FROM fixture_players WHERE fixture_id = ${fxId}`).catch(() => {});
    }
  }

  // Fixtures may have been updated to REAL_EARLY/REAL_LATE — delete by DB id.
  if (fixtureEarlyId) {
    await db.execute(sql`DELETE FROM fixtures WHERE id = ${fixtureEarlyId}`).catch(() => {});
  }
  if (fixtureLateId) {
    await db.execute(sql`DELETE FROM fixtures WHERE id = ${fixtureLateId}`).catch(() => {});
  }

  if (playerId) {
    await db.execute(sql`DELETE FROM players WHERE id = ${playerId}`).catch(() => {});
  }
  if (clubId) {
    await db.execute(sql`DELETE FROM clubs WHERE id = ${clubId}`).catch(() => {});
  }
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe("promoteNtSentinelIds — overlapping ±7-day windows", () => {
  it(
    "Phase 1: only the earlier match played — earlier sentinel promoted, later left unbound",
    async () => {
      // Insert only the Sept 26 log. Both sentinels' windows include this date.
      const logRows = await db.execute(sql`
        INSERT INTO match_logs (
          player_id, api_football_fixture_id, date,
          opponent, competition, result, minutes, goals, assists,
          is_national_team
        ) VALUES (
          ${playerId}, ${REAL_EARLY}, ${LOG_DATE_EARLY},
          '__Overlap Opponent A__', 'International Friendly',
          'W', 90, 1, 0, true
        )
        RETURNING id
      `);
      earlyLogId = (logRows.rows[0] as { id: number }).id;

      await promoteNtSentinelIds();

      const [early] = await db
        .select({ afId: fixturesTable.apiFootballFixtureId })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, fixtureEarlyId));

      const [late] = await db
        .select({ afId: fixturesTable.apiFootballFixtureId })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, fixtureLateId));

      expect(
        early?.afId,
        "earlier sentinel (Sept 26) should be promoted to REAL_EARLY",
      ).toBe(REAL_EARLY);

      expect(
        late?.afId,
        "later sentinel (Sept 29) should remain at its negative sentinel — no log for its match yet",
      ).toBe(SENTINEL_LATE);
    },
  );

  it(
    "Phase 2: later match also played — later sentinel promoted using its own log",
    async () => {
      // Insert the Sept 29 log. Both windows overlap, but date proximity
      // should resolve REAL_LATE as the winner for the Sept 29 kickoff.
      const logRows = await db.execute(sql`
        INSERT INTO match_logs (
          player_id, api_football_fixture_id, date,
          opponent, competition, result, minutes, goals, assists,
          is_national_team
        ) VALUES (
          ${playerId}, ${REAL_LATE}, ${LOG_DATE_LATE},
          '__Overlap Opponent B__', 'International Friendly',
          'D', 80, 0, 1, true
        )
        RETURNING id
      `);
      lateLogId = (logRows.rows[0] as { id: number }).id;

      await promoteNtSentinelIds();

      const [early] = await db
        .select({ afId: fixturesTable.apiFootballFixtureId })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, fixtureEarlyId));

      const [late] = await db
        .select({ afId: fixturesTable.apiFootballFixtureId })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, fixtureLateId));

      expect(
        early?.afId,
        "earlier sentinel should still hold REAL_EARLY — already positive, not re-processed",
      ).toBe(REAL_EARLY);

      expect(
        late?.afId,
        "later sentinel (Sept 29) should now be promoted to REAL_LATE",
      ).toBe(REAL_LATE);
    },
  );
});
