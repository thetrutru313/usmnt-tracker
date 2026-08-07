/**
 * Guards the sentinel fixture ID promotion logic in promoteNtSentinelIds().
 *
 * ## Why this matters
 * Four USMNT friendlies (Sept/Oct 2026) were seeded with negative sentinel
 * api_football_fixture_id values before API-Football published them. The
 * promotion function is the only mechanism that replaces those sentinels with
 * real positive IDs once match logs exist. Under a Reserved VM the server
 * restarts only on deploy, so without an hourly schedule the sentinels could
 * stay negative for weeks after matches are played.
 *
 * ## What is tested
 * 1. A sentinel row (negative ID) with a linked player and a matching match log
 *    is promoted to the real positive api_football_fixture_id.
 * 2. A sentinel row with a linked player but NO match log is left alone.
 * 3. A fixture with a positive ID (already bound) is not touched.
 *
 * ## How it works
 * - Inserts a throwaway club and player for FK integrity.
 * - Each test case inserts its own fixture (and optionally fixture_players /
 *   match_logs rows), calls promoteNtSentinelIds(), then asserts the result.
 * - afterAll removes all inserted rows regardless of test outcome.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, fixturesTable, fixturePlayersTable, matchLogsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { promoteNtSentinelIds } from "../usmntSync.js";

// ─── test identifiers ─────────────────────────────────────────────────────────

// Sentinel IDs: negative, unique to this test suite.
const SENTINEL_WITH_LOG    = -9801;
const SENTINEL_WITHOUT_LOG = -9802;
const POSITIVE_ID          = 9_800_003; // already bound — must not change

// The real API-Football ID that match logs carry for the first fixture.
const REAL_AF_ID = 9_800_001;

// Kickoff dates far in the future to avoid colliding with real fixtures.
// KICKOFF_WITHOUT_LOG is 20+ days after KICKOFF_WITH_LOG so the match log
// date (2099-09-26) is outside its ±7-day window (2099-10-08 → 2099-10-22),
// which is the scenario under test: "no matching log in window".
const KICKOFF_WITH_LOG    = "2099-09-26 20:30:00+00";
const KICKOFF_WITHOUT_LOG = "2099-10-15 02:00:00+00";
const KICKOFF_POSITIVE    = "2099-10-22 00:00:00+00";

// Match log date — within the ±7-day window of KICKOFF_WITH_LOG only.
const LOG_DATE = "2099-09-26";

// Unique strings so we can clean up by name even if IDs shift.
const CLUB_NAME   = "__nt_sentinel_promo_test_club__";
const PLAYER_SLUG = "__nt-sentinel-promo-test-player__";

// ─── state shared across tests ────────────────────────────────────────────────

let clubId   = 0;
let playerId = 0;

// Fixture DB ids (assigned at insert time).
let fixtureWithLogId    = 0;
let fixtureWithoutLogId = 0;
let fixturePositiveId   = 0;

// ─── setup & teardown ────────────────────────────────────────────────────────

beforeAll(async () => {
  // ── pre-cleanup: remove any rows left from a previous crashed run ──────────
  await db.execute(sql`
    DELETE FROM match_logs
    WHERE player_id IN (
      SELECT id FROM players WHERE slug = ${PLAYER_SLUG}
    )
  `).catch(() => {});
  await db.execute(sql`
    DELETE FROM fixture_players
    WHERE fixture_id IN (
      SELECT id FROM fixtures
      WHERE api_football_fixture_id IN (
        ${SENTINEL_WITH_LOG}, ${SENTINEL_WITHOUT_LOG}, ${POSITIVE_ID}
      )
    )
  `).catch(() => {});
  await db.execute(sql`
    DELETE FROM fixtures
    WHERE api_football_fixture_id IN (
      ${SENTINEL_WITH_LOG}, ${SENTINEL_WITHOUT_LOG}, ${POSITIVE_ID}
    )
  `).catch(() => {});
  await db.execute(sql`
    DELETE FROM players WHERE slug = ${PLAYER_SLUG}
  `).catch(() => {});
  await db.execute(sql`
    DELETE FROM clubs WHERE name = ${CLUB_NAME}
  `).catch(() => {});

  // ── insert throwaway club ──────────────────────────────────────────────────
  const clubRows = await db.execute(sql`
    INSERT INTO clubs (name, league, country)
    VALUES (${CLUB_NAME}, '__test_league__', '__test_country__')
    RETURNING id
  `);
  clubId = (clubRows.rows[0] as { id: number }).id;

  // ── insert throwaway player ────────────────────────────────────────────────
  const playerRows = await db.execute(sql`
    INSERT INTO players (name, slug, position, category, club_id, age)
    VALUES (
      '__Nt Sentinel Promo Test Player__',
      ${PLAYER_SLUG},
      'MF', 'current', ${clubId}, 25
    )
    RETURNING id
  `);
  playerId = (playerRows.rows[0] as { id: number }).id;

  // ── insert the three test fixtures ────────────────────────────────────────

  const fxWithLog = await db.execute(sql`
    INSERT INTO fixtures (
      api_football_fixture_id, home_team, away_team,
      competition, kickoff, venue, is_national_team, status
    ) VALUES (
      ${SENTINEL_WITH_LOG}, 'USA', '__Sentinel Promo Opponent A__',
      'International Friendly', ${KICKOFF_WITH_LOG}::timestamptz,
      '__test_venue__', true, 'finished'
    )
    RETURNING id
  `);
  fixtureWithLogId = (fxWithLog.rows[0] as { id: number }).id;

  const fxWithoutLog = await db.execute(sql`
    INSERT INTO fixtures (
      api_football_fixture_id, home_team, away_team,
      competition, kickoff, venue, is_national_team, status
    ) VALUES (
      ${SENTINEL_WITHOUT_LOG}, 'USA', '__Sentinel Promo Opponent B__',
      'International Friendly', ${KICKOFF_WITHOUT_LOG}::timestamptz,
      '__test_venue__', true, 'scheduled'
    )
    RETURNING id
  `);
  fixtureWithoutLogId = (fxWithoutLog.rows[0] as { id: number }).id;

  const fxPositive = await db.execute(sql`
    INSERT INTO fixtures (
      api_football_fixture_id, home_team, away_team,
      competition, kickoff, venue, is_national_team, status
    ) VALUES (
      ${POSITIVE_ID}, 'USA', '__Sentinel Promo Opponent C__',
      'International Friendly', ${KICKOFF_POSITIVE}::timestamptz,
      '__test_venue__', true, 'scheduled'
    )
    RETURNING id
  `);
  fixturePositiveId = (fxPositive.rows[0] as { id: number }).id;

  // ── link player to both sentinel fixtures (not to the positive-ID fixture) ─
  await db.execute(sql`
    INSERT INTO fixture_players (fixture_id, player_id)
    VALUES (${fixtureWithLogId}, ${playerId}),
           (${fixtureWithoutLogId}, ${playerId})
  `);

  // ── insert a match log only for the first sentinel ────────────────────────
  await db.execute(sql`
    INSERT INTO match_logs (
      player_id, api_football_fixture_id, date,
      opponent, competition, result, minutes, goals, assists,
      is_national_team
    ) VALUES (
      ${playerId}, ${REAL_AF_ID}, ${LOG_DATE},
      '__Sentinel Promo Opponent A__', 'International Friendly',
      'W', 90, 0, 0, true
    )
  `);
});

afterAll(async () => {
  // Tear down in FK order: logs → fixture_players → fixtures → player → club
  await db.execute(sql`
    DELETE FROM match_logs
    WHERE player_id = ${playerId}
      AND api_football_fixture_id = ${REAL_AF_ID}
  `).catch(() => {});

  for (const fxId of [fixtureWithLogId, fixtureWithoutLogId, fixturePositiveId]) {
    if (!fxId) continue;
    await db.execute(sql`
      DELETE FROM fixture_players WHERE fixture_id = ${fxId}
    `).catch(() => {});
  }

  await db.execute(sql`
    DELETE FROM fixtures
    WHERE id IN (
      ${fixtureWithLogId}, ${fixtureWithoutLogId}, ${fixturePositiveId}
    )
  `).catch(() => {});

  if (playerId) {
    await db.execute(sql`DELETE FROM players WHERE id = ${playerId}`).catch(() => {});
  }
  if (clubId) {
    await db.execute(sql`DELETE FROM clubs WHERE id = ${clubId}`).catch(() => {});
  }
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe("promoteNtSentinelIds", () => {
  it(
    "promotes a sentinel row to the real api_football_fixture_id when a matching match log exists",
    async () => {
      await promoteNtSentinelIds();

      const [row] = await db
        .select({ apiFootballFixtureId: fixturesTable.apiFootballFixtureId })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, fixtureWithLogId));

      expect(
        row?.apiFootballFixtureId,
        `fixture ${fixtureWithLogId} should be promoted from ${SENTINEL_WITH_LOG} to ${REAL_AF_ID}`,
      ).toBe(REAL_AF_ID);
    },
  );

  it(
    "leaves a sentinel row untouched when no match log exists for the linked player",
    async () => {
      await promoteNtSentinelIds();

      const [row] = await db
        .select({ apiFootballFixtureId: fixturesTable.apiFootballFixtureId })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, fixtureWithoutLogId));

      expect(
        row?.apiFootballFixtureId,
        `fixture ${fixtureWithoutLogId} should remain at sentinel ${SENTINEL_WITHOUT_LOG}`,
      ).toBe(SENTINEL_WITHOUT_LOG);
    },
  );

  it(
    "does not touch a fixture that already has a positive api_football_fixture_id",
    async () => {
      await promoteNtSentinelIds();

      const [row] = await db
        .select({ apiFootballFixtureId: fixturesTable.apiFootballFixtureId })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, fixturePositiveId));

      expect(
        row?.apiFootballFixtureId,
        `fixture ${fixturePositiveId} should remain at positive ID ${POSITIVE_ID}`,
      ).toBe(POSITIVE_ID);
    },
  );
});
