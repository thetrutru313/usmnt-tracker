/**
 * Tests 6 & 7 — Rankings reads season_all for the current season year.
 *
 * ## Why this matters (Task C)
 * Q8 found players like Zavier Gozo who played 2,108 minutes in the 2025
 * season across two clubs, but whose Rankings page stats showed 90 minutes
 * (only the current club's `season` row). The root cause: rankings.ts queried
 * periodType='season' (current-club-only) instead of 'season_all' (all clubs).
 *
 * Additionally, Q8 showed Matai Akinmboni's row was from 2024 while others
 * were 2025 — the query applied no year filter, so one leaderboard mixed
 * different seasons.
 *
 * ## What is tested
 * Test 6 (C1): Seeds a player with a mid-season transfer shape:
 *   - `season` row  = 90 min / 0 goals  (current club only)
 *   - `season_all` = 2108 min / 999 goals (all clubs, current year)
 *   Asserts the player appears in mostGoalContributions.
 *   Before fix (reads season → 0 goals): NOT in contributions → FAILS.
 *   After fix (reads season_all → 999 goals): IN contributions → PASSES.
 *
 * Test 7 (C2): Seeds two players, each with only a season_all row:
 *   - Player A: season_all for the current year  (should appear)
 *   - Player B: season_all for two years ago     (should NOT appear)
 *   Before fix (periodType='season', no year filter): neither player has a
 *     `season` row → neither appears → assertion on A fails → FAILS.
 *   After fix (periodType='season_all', year=currentYear):
 *     A appears, B does not → PASSES.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { db, playersTable, playerStatsTable, clubsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const currentSeasonStr = String(new Date().getUTCFullYear());
const oldSeasonStr = String(new Date().getUTCFullYear() - 2);

let clubId: number;
let gozoPlayerId: number;
let playerAId: number;
let playerBId: number;

beforeAll(async () => {
  // One shared test club for all seeded players
  const [club] = await db
    .insert(clubsTable)
    .values({ name: "Test Club Season Filter", league: "Test League", country: "US" })
    .returning();
  clubId = club.id;

  // ── Test 6: Gozo shape ─────────────────────────────────────────────────────
  const [gozo] = await db
    .insert(playersTable)
    .values({
      name: "Test Gozo Season Filter",
      slug: `test-gozo-sf-${Date.now()}`,
      position: "MID",
      category: "prospect",
      clubId,
      age: 23,
    })
    .returning();
  gozoPlayerId = gozo.id;

  // season row — current-club only, small numbers (mirrors the pre-transfer stint)
  await db.insert(playerStatsTable).values({
    playerId: gozoPlayerId,
    periodType: "season",
    season: currentSeasonStr,
    minutes: 90,
    goals: 0,
    starts: 1,
    assists: 0,
    shots: 0,
    keyPasses: 0,
    tackles: 0,
    interceptions: 0,
  });

  // season_all row — all clubs combined, big numbers, guaranteed top-8
  await db.insert(playerStatsTable).values({
    playerId: gozoPlayerId,
    periodType: "season_all",
    season: currentSeasonStr,
    minutes: 2108,
    goals: 999, // unrealistically high to guarantee top-8 ranking
    starts: 20,
    assists: 5,
    shots: 0,
    keyPasses: 0,
    tackles: 0,
    interceptions: 0,
  });

  // ── Test 7: current-year player (A) ────────────────────────────────────────
  const suffix = Date.now();
  const [playerA] = await db
    .insert(playersTable)
    .values({
      name: "Test PlayerA Season Filter",
      slug: `test-player-a-sf-${suffix}`,
      position: "FWD",
      category: "prospect",
      clubId,
      age: 22,
    })
    .returning();
  playerAId = playerA.id;

  await db.insert(playerStatsTable).values({
    playerId: playerAId,
    periodType: "season_all",
    season: currentSeasonStr, // current year — should appear after fix
    minutes: 9999,             // very high to guarantee top-8
    goals: 0,
    starts: 90,
    assists: 0,
    shots: 0,
    keyPasses: 0,
    tackles: 0,
    interceptions: 0,
  });

  // ── Test 7: old-year player (B) ─────────────────────────────────────────────
  const [playerB] = await db
    .insert(playersTable)
    .values({
      name: "Test PlayerB Season Filter",
      slug: `test-player-b-sf-${suffix}`,
      position: "FWD",
      category: "prospect",
      clubId,
      age: 21,
    })
    .returning();
  playerBId = playerB.id;

  await db.insert(playerStatsTable).values({
    playerId: playerBId,
    periodType: "season_all",
    season: oldSeasonStr, // two years ago — should NOT appear after fix
    minutes: 9999,
    goals: 0,
    starts: 90,
    assists: 0,
    shots: 0,
    keyPasses: 0,
    tackles: 0,
    interceptions: 0,
  });
}, 30_000);

afterAll(async () => {
  // Delete stats before players (FK), players before club (FK)
  for (const pid of [gozoPlayerId, playerAId, playerBId].filter(Boolean)) {
    await db.delete(playerStatsTable).where(eq(playerStatsTable.playerId, pid));
    await db.delete(playersTable).where(eq(playersTable.id, pid));
  }
  if (clubId) {
    await db.delete(clubsTable).where(eq(clubsTable.id, clubId));
  }
}, 30_000);

describe("Rankings — season_all filter (Tests 6 & 7)", () => {
  it(
    "Test 6 (C1): mostGoalContributions ranks on season_all totals (all clubs), not season totals (current club only)",
    async () => {
      const res = await request(app).get("/api/rankings").expect(200);
      const inContributions = res.body.mostGoalContributions.some(
        (p: { id: number }) => p.id === gozoPlayerId,
      );
      // Before fix (reads periodType='season' → 0 goals → not in top 8): FAILS
      // After fix (reads periodType='season_all' → 999 goals → in top 8): PASSES
      expect(inContributions).toBe(true);
    },
    30_000,
  );

  it(
    "Test 7 (C2): mostMinutes only includes players with a season_all row for the current season year",
    async () => {
      const res = await request(app).get("/api/rankings").expect(200);
      const playerAInRankings = res.body.mostMinutes.some(
        (p: { id: number }) => p.id === playerAId,
      );
      const playerBInRankings = res.body.mostMinutes.some(
        (p: { id: number }) => p.id === playerBId,
      );
      // Before fix (periodType='season', no year filter):
      //   neither A nor B has a `season` row → neither in mostMinutes
      //   → playerAInRankings = false → assertion FAILS
      // After fix (periodType='season_all', year=currentSeasonStr):
      //   A has currentYear row → in rankings
      //   B has oldYear row    → NOT in rankings
      expect(playerAInRankings).toBe(true);
      expect(playerBInRankings).toBe(false);
    },
    30_000,
  );
});
