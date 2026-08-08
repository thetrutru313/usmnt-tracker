/**
 * Regression guard: confirms the form badge on GET /api/players/:id reflects
 * real stats after a player's api_football_player_id is resolved for the first
 * time — not the STEADY placeholder that fires when no stats exist yet.
 *
 * ## What & Why
 * When a new player is seeded their api_football_player_id starts as NULL and
 * no player_stats rows exist. The form-badge logic correctly returns "steady"
 * in that state. The risk is that after the first sync runs and both the id
 * AND stats rows are written, the badge computation somehow still returns
 * "steady" (e.g. because a cache layer or a stale read of players.performanceTrend
 * is used rather than the fresh player_stats rows). This test closes that gap.
 *
 * ## Strategy
 * The test is fully seed-independent: it inserts a dedicated test player and
 * all required stats rows, then deletes them in afterAll. No real player id or
 * specific seed row is required.
 *
 * ## Scenario tested
 * Phase 1 — pre-resolution (null api_football_player_id, no stats):
 *   • GET /api/players/:id returns performanceTrend = "steady" (null-guard path)
 *
 * Phase 2 — post-resolution (id written, stats written):
 *   • last5 avgRating=8.0, season avgRating=7.0 → score = 50*(8.0−7.0) = 50 ≥ 25
 *   • no prev5 → trajectoryIsDown = false → expected badge: "on_fire"
 *   • GET /api/players/:id returns performanceTrend = "on_fire", NOT "steady"
 *
 * ## Cleanup
 * All inserted rows (player_stats, players, clubs) are removed in afterAll in
 * reverse-FK order even if assertions fail.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { db, playersTable, playerStatsTable, clubsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ─── Test state ──────────────────────────────────────────────────────────────

let testPlayerId: number | null = null;
let testClubId: number | null = null;
let insertedClub = false;

// A fake numeric id — not a real API-Football id, just non-null to represent
// a resolved state. The form badge computation only reads player_stats rows
// keyed by player.id, so the api_football_player_id value itself doesn't matter
// for badge derivation.
const FAKE_API_FOOTBALL_ID = 999999999;

// ─── Setup & teardown ────────────────────────────────────────────────────────

beforeAll(async () => {
  // Reuse the first existing club to avoid extra FK complexity.
  const [existingClub] = await db
    .select({ id: clubsTable.id })
    .from(clubsTable)
    .limit(1);

  if (existingClub) {
    testClubId = existingClub.id;
  } else {
    const [club] = await db
      .insert(clubsTable)
      .values({ name: "Test Club (form-badge-id-resolution)", league: "Test League", country: "USA" })
      .returning({ id: clubsTable.id });
    testClubId = club.id;
    insertedClub = true;
  }

  // Insert a dedicated test player with null api_football_player_id (pre-resolution state).
  // Timestamped slug prevents collisions when the suite runs in parallel.
  const [player] = await db
    .insert(playersTable)
    .values({
      name: `Test Badge ID-Resolution Player (${Date.now()})`,
      slug: `__test-badge-id-resolution-${Date.now()}`,
      position: "MF",
      category: "fringe",
      clubId: testClubId!,
      age: 22,
      apiFootballPlayerId: null,   // ← pre-resolution: no id yet
      bio: "",
    })
    .returning({ id: playersTable.id });

  testPlayerId = player.id;
}, 30_000);

afterAll(async () => {
  if (testPlayerId !== null) {
    // Remove stats before player (FK constraint).
    await db.delete(playerStatsTable).where(eq(playerStatsTable.playerId, testPlayerId));
    await db.delete(playersTable).where(eq(playersTable.id, testPlayerId));
  }
  if (insertedClub && testClubId !== null) {
    await db.delete(clubsTable).where(eq(clubsTable.id, testClubId));
  }
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Form badge after api_football_player_id is resolved for the first time", () => {
  it(
    "Phase 1 — before resolution: badge is 'steady' because no stats exist yet",
    async () => {
      if (testPlayerId === null) {
        console.warn("[formBadgeAfterIdResolution] Test player not created — skipping Phase 1.");
        return;
      }

      // No player_stats rows exist. computeFormBadge should hit the null-guard
      // (last5 == null) and return STEADY.
      const res = await request(app)
        .get(`/api/players/${testPlayerId}`)
        .expect(200);

      expect(
        res.body.performanceTrend,
        `Expected 'steady' before any stats exist (null id + no rows) but got '${res.body.performanceTrend}'`,
      ).toBe("steady");
    },
    30_000,
  );

  it(
    "Phase 2 — after resolution: badge reflects real stats ('on_fire'), not the STEADY placeholder",
    async () => {
      if (testPlayerId === null) {
        console.warn("[formBadgeAfterIdResolution] Test player not created — skipping Phase 2.");
        return;
      }

      // Simulate the sync resolving the player id and writing real stats.
      // Step A: write the resolved api_football_player_id.
      await db
        .update(playersTable)
        .set({ apiFootballPlayerId: FAKE_API_FOOTBALL_ID })
        .where(eq(playersTable.id, testPlayerId));

      // Step B: write player_stats rows that produce "on_fire".
      //   score = 50 * (last5.avgRating − season.avgRating)
      //         = 50 * (8.0 − 7.0) = 50 ≥ 25
      //   no prev5 → trajectoryIsDown = false → "on_fire"
      await db.insert(playerStatsTable).values([
        {
          playerId: testPlayerId,
          periodType: "last5",
          season: "2025",
          minutes: 450,
          avgRating: 8.0,
        },
        {
          playerId: testPlayerId,
          periodType: "season",
          season: "2025",
          minutes: 1800,
          avgRating: 7.0,
        },
      ]);

      // Core assertion: the badge must now reflect the real stats, NOT "steady".
      const res = await request(app)
        .get(`/api/players/${testPlayerId}`)
        .expect(200);

      expect(
        res.body.performanceTrend,
        `Expected 'on_fire' after id resolution + stats write but got '${res.body.performanceTrend}'. ` +
        `The badge computation is returning the STEADY placeholder instead of reading the real player_stats rows.`,
      ).toBe("on_fire");
    },
    30_000,
  );

  // Note: the third test ("badge is not derived from the stored players.performanceTrend column")
  // was removed when that column was dropped in Prompt 12 Task D. The two remaining tests
  // already prove the badge is computed from stats: Phase 1 shows "steady" with no stats,
  // Phase 2 shows "on_fire" after stats are written — without any column to read from.
});
