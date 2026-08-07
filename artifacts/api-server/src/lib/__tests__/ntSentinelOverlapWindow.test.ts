/**
 * Guards the ordering fix in promoteNtSentinelIds() that prevents silent data
 * corruption when two sentinel fixtures have overlapping ±2-day candidate windows.
 *
 * ## The problem it prevents
 * The Sept 26 and Sept 29 USMNT fixtures are 3 days apart; their ±2-day windows
 * overlap on Sept 27–28. If the query returns them in arbitrary order and the
 * Sept 29 sentinel is processed first, it claims a Sept 27 match log (which
 * falls in both windows), writes the wrong api_football_fixture_id, and the
 * correct Sept 26 fixture stays unbound right as its match goes live. The
 * per-fixture try/catch then catches the constraint on the correct fixture,
 * leaving wrong data silently in place.
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
 *   - Only the Sept 27 match log exists (apiFootballFixtureId = REAL_EARLY).
 *     Sept 27 falls inside BOTH ±2-day windows (Sept 24–28 and Sept 27–Oct 1).
 *   - After promoteNtSentinelIds():
 *       • Early sentinel → REAL_EARLY  ✓  (ORDER BY ASC + proximity score win)
 *       • Late sentinel  → unchanged (still negative)  ✓
 *
 * Phase 2 — the later match has also been played:
 *   - Sept 29 log (apiFootballFixtureId = REAL_LATE) is inserted.
 *   - After promoteNtSentinelIds():
 *       • Early sentinel still REAL_EARLY (already positive, filtered out)  ✓
 *       • Late sentinel → REAL_LATE  ✓ (date proximity breaks the tie)
 *
 * Reversed-case test — earlier sentinel must NOT claim a log that only exists
 * for the LATER match:
 *   - Only a Sept 29 log is present; early sentinel has kickoff Sept 26.
 *   - Sept 29 is 3 days after Sept 26 → outside the ±2-day window → no
 *     candidates → early sentinel stays unbound.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, fixturesTable } from "@workspace/db";
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

const LOG_DATE_EARLY = "2099-09-27"; // Sept 27: within BOTH ±2-day windows (Sept 24–28 and Sept 27–Oct 1)
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

describe("promoteNtSentinelIds — overlapping ±2-day windows", () => {
  it(
    "Phase 1: only the earlier match played — earlier sentinel promoted, later left unbound",
    async () => {
      // Insert only the Sept 27 log (1 day after early kickoff, 2 days before late kickoff).
      // Sept 27 falls inside BOTH ±2-day windows: early (Sept 24–28) and late (Sept 27–Oct 1).
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

// ─── reversed-case: earlier sentinel must not claim the later match's log ─────
//
// Scenario: only the Sept 29 log is present (REAL_LATE). The earlier sentinel
// has kickoff Sept 26. Sept 29 is 3 days away → outside the ±2-day window
// (Sept 24–28), so no candidates → early sentinel stays unbound.
//
// This guards against the forward-direction corruption risk: a sentinel claiming
// a log from a match that has not yet happened relative to its own kickoff.

const SENTINEL_REV_EARLY = -9821;
const REAL_REV_LATE      = 9_821_001;

const KICKOFF_REV_EARLY = "2099-09-26 20:30:00+00"; // ±2 window: Sept 24–28
const LOG_DATE_REV_LATE = "2099-09-29";              // 3 days after early kickoff — outside window

const CLUB_NAME_REV   = "__nt_overlap_rev_test_club__";
const PLAYER_SLUG_REV = "__nt-overlap-rev-test-player__";

let revClubId   = 0;
let revPlayerId = 0;
let revFixtureId = 0;
let revLogId     = 0;

describe("promoteNtSentinelIds — reversed case: earlier sentinel must not claim a later match's log", () => {
  beforeAll(async () => {
    // Pre-cleanup.
    await db.execute(sql`
      DELETE FROM match_logs WHERE player_id IN (
        SELECT id FROM players WHERE slug = ${PLAYER_SLUG_REV}
      )
    `).catch(() => {});
    await db.execute(sql`
      DELETE FROM fixture_players WHERE fixture_id IN (
        SELECT id FROM fixtures WHERE api_football_fixture_id = ${SENTINEL_REV_EARLY}
      )
    `).catch(() => {});
    await db.execute(sql`
      DELETE FROM fixtures WHERE api_football_fixture_id IN (${SENTINEL_REV_EARLY}, ${REAL_REV_LATE})
    `).catch(() => {});
    await db.execute(sql`DELETE FROM players WHERE slug = ${PLAYER_SLUG_REV}`).catch(() => {});
    await db.execute(sql`DELETE FROM clubs WHERE name = ${CLUB_NAME_REV}`).catch(() => {});

    const clubRows = await db.execute(sql`
      INSERT INTO clubs (name, league, country)
      VALUES (${CLUB_NAME_REV}, '__test_league__', '__test_country__')
      RETURNING id
    `);
    revClubId = (clubRows.rows[0] as { id: number }).id;

    const playerRows = await db.execute(sql`
      INSERT INTO players (name, slug, position, category, club_id, age)
      VALUES ('__Nt Rev Test Player__', ${PLAYER_SLUG_REV}, 'FW', 'current', ${revClubId}, 22)
      RETURNING id
    `);
    revPlayerId = (playerRows.rows[0] as { id: number }).id;

    const fxRows = await db.execute(sql`
      INSERT INTO fixtures (
        api_football_fixture_id, home_team, away_team,
        competition, kickoff, venue, is_national_team, status
      ) VALUES (
        ${SENTINEL_REV_EARLY}, 'USA', '__Rev Opponent__',
        'International Friendly', ${KICKOFF_REV_EARLY}::timestamptz,
        '__rev_venue__', true, 'scheduled'
      )
      RETURNING id
    `);
    revFixtureId = (fxRows.rows[0] as { id: number }).id;

    await db.execute(sql`
      INSERT INTO fixture_players (fixture_id, player_id)
      VALUES (${revFixtureId}, ${revPlayerId})
    `);

    // Insert ONLY the log for the LATER match (Sept 29) — no log for Sept 26.
    const logRows = await db.execute(sql`
      INSERT INTO match_logs (
        player_id, api_football_fixture_id, date,
        opponent, competition, result, minutes, goals, assists,
        is_national_team
      ) VALUES (
        ${revPlayerId}, ${REAL_REV_LATE}, ${LOG_DATE_REV_LATE},
        '__Rev Opponent__', 'International Friendly',
        'W', 90, 0, 0, true
      )
      RETURNING id
    `);
    revLogId = (logRows.rows[0] as { id: number }).id;
  });

  afterAll(async () => {
    if (revLogId) {
      await db.execute(sql`DELETE FROM match_logs WHERE id = ${revLogId}`).catch(() => {});
    }
    if (revFixtureId) {
      await db.execute(sql`DELETE FROM fixture_players WHERE fixture_id = ${revFixtureId}`).catch(() => {});
      await db.execute(sql`DELETE FROM fixtures WHERE id = ${revFixtureId}`).catch(() => {});
    }
    if (revPlayerId) {
      await db.execute(sql`DELETE FROM players WHERE id = ${revPlayerId}`).catch(() => {});
    }
    if (revClubId) {
      await db.execute(sql`DELETE FROM clubs WHERE id = ${revClubId}`).catch(() => {});
    }
  });

  it(
    "does not promote an earlier sentinel when only the later match's log is present (log is outside ±2-day window)",
    async () => {
      await promoteNtSentinelIds();

      const [row] = await db
        .select({ afId: fixturesTable.apiFootballFixtureId })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, revFixtureId));

      expect(
        row?.afId,
        `earlier sentinel should remain at ${SENTINEL_REV_EARLY} — Sept 29 log is 3 days out, outside the ±2-day window`,
      ).toBe(SENTINEL_REV_EARLY);
    },
  );
});
