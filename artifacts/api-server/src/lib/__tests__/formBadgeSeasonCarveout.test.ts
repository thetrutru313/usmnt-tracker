/**
 * Test 8 — Regression guard: form badge baseline stays on the `season` row
 * (current-club-only stats), NOT `season_all` (all-clubs aggregate).
 *
 * ## Why this carve-out matters
 * `computeFormBadgesForPlayerIds` reads periodType='season' as the season
 * average-rating baseline. This is intentional: for a player who just
 * transferred clubs, mixing in their old-club data would inflate or deflate
 * the baseline and produce a wrong badge tier.
 *
 * Task C changes the RANKINGS queries to use 'season_all'. It must NOT
 * change the form badge query. This test proves they remain separate by
 * seeding a player whose 'season' and 'season_all' avgRating values produce
 * DIFFERENT badge outcomes:
 *
 *   last5.avgRating  = 7.6  (above season baseline, below season_all baseline)
 *   season.avgRating = 7.0  → delta = +0.6 → score = 30 → "on_fire"
 *   season_all.avgRating = 8.5 → delta = −0.9 → score = −45 → "ice_cold"
 *
 * If a future refactor accidentally switches the badge to read 'season_all',
 * the badge becomes "ice_cold" and this test fails.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, playersTable, playerStatsTable, clubsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { computeFormBadgesForPlayerIds } from "../queries.js";

const currentSeasonStr = String(new Date().getUTCFullYear());

let clubId: number;
let playerId: number;

beforeAll(async () => {
  const [club] = await db
    .insert(clubsTable)
    .values({ name: "Test Club Badge Carveout", league: "Test League", country: "US" })
    .returning();
  clubId = club.id;

  const [player] = await db
    .insert(playersTable)
    .values({
      name: "Test Badge Carveout Player",
      slug: `test-badge-carveout-${Date.now()}`,
      position: "MID",
      category: "prospect",
      clubId,
      age: 23,
    })
    .returning();
  playerId = player.id;

  // season row: moderate baseline (current-club only after a mid-season transfer)
  await db.insert(playerStatsTable).values({
    playerId,
    periodType: "season",
    season: currentSeasonStr,
    minutes: 600,
    goals: 0,
    starts: 6,
    assists: 0,
    shots: 0,
    keyPasses: 0,
    tackles: 0,
    interceptions: 0,
    avgRating: 7.0,
  });

  // season_all row: inflated by prior-club appearances — would give a worse
  // badge if accidentally used as the baseline
  await db.insert(playerStatsTable).values({
    playerId,
    periodType: "season_all",
    season: currentSeasonStr,
    minutes: 2108,
    goals: 0,
    starts: 20,
    assists: 0,
    shots: 0,
    keyPasses: 0,
    tackles: 0,
    interceptions: 0,
    avgRating: 8.5,
  });

  // last5 row: above season baseline, below season_all baseline
  // With season  (7.0): delta = 7.6 - 7.0 = +0.6, score = 50*0.6 = 30 → "on_fire"
  // With season_all (8.5): delta = 7.6 - 8.5 = −0.9, score = 50*(−0.9) = −45 → "ice_cold"
  await db.insert(playerStatsTable).values({
    playerId,
    periodType: "last5",
    season: currentSeasonStr,
    minutes: 450, // > 270 minimum-minutes gate
    goals: 0,
    starts: 5,
    assists: 0,
    shots: 0,
    keyPasses: 0,
    tackles: 0,
    interceptions: 0,
    avgRating: 7.6,
  });
}, 30_000);

afterAll(async () => {
  if (playerId) {
    await db.delete(playerStatsTable).where(eq(playerStatsTable.playerId, playerId));
    await db.delete(playersTable).where(eq(playersTable.id, playerId));
  }
  if (clubId) {
    await db.delete(clubsTable).where(eq(clubsTable.id, clubId));
  }
}, 30_000);

describe("Form badge baseline is periodType='season' (not 'season_all') — regression guard", () => {
  it(
    "computeFormBadgesForPlayerIds returns 'on_fire' when season baseline=7.0 and last5=7.6 (would be 'ice_cold' if season_all=8.5 were used instead)",
    async () => {
      const badges = await computeFormBadgesForPlayerIds([playerId]);
      const badge = badges.get(playerId);
      expect(badge).toBeDefined();
      // on_fire: uses season row (7.0) as baseline → delta = +0.6 → score = 30 ≥ 25 → on_fire
      // ice_cold: would use season_all (8.5) → delta = −0.9 → score = −45 ≤ −25 → ice_cold
      expect(badge!.performanceTrend).toBe("on_fire");
      // trending=true: computeFormBadgesForPlayerIds sets trending whenever
      // performanceTrend is "on_fire" or "rising" — this is correct behaviour.
      // The key assertion above (on_fire, not ice_cold) is the regression guard.
      expect(badge!.trending).toBe(true);
    },
    30_000,
  );
});
