/**
 * Regression guard: confirms GET /api/players/:id returns a clean, populated
 * response after realistic stats are synced for a player.
 *
 * ## What & Why
 * This guard verifies:
 *   - The profile returns HTTP 200 and parses against the Zod schema
 *   - Real club seasons are surfaced (not the N/A fallback)
 *   - avgRating is a non-null number
 *   - The response shape is stable — a future route change that breaks the
 *     season-all path would fail here before reaching users.
 *
 * ## Strategy
 * The test inserts its own disposable club, player, and season_all stats rows
 * in beforeAll and removes them in afterAll (reverse-FK order). This makes
 * the test runnable on a schema-only CI database with no seed data.
 *
 * Player name "Cole Campbell" and the stats values mirror what the real sync
 * produces, so the test still serves as a true regression guard.
 *
 * ## What is asserted
 * 1. GET /api/players/:id returns HTTP 200.
 * 2. The response body parses cleanly against GetPlayerResponse (Zod schema).
 * 3. `availableClubSeasons` contains at least one real season (e.g. "2025").
 * 4. `clubSeasonStats.avgRating` is a positive number.
 * 5. `clubSeasonStats.minutes` is > 0.
 *
 * ## Cleanup
 * All inserted rows are removed in afterAll in reverse-FK order:
 *   playerStatsTable → playersTable → clubsTable
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { db, playersTable, playerStatsTable, clubsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { GetPlayerResponse } from "@workspace/api-zod";

const TEST_SEASON = "2025";

let sentinelClubId: number;
let sentinelPlayerId: number;
/** Alias used throughout the describe block for readability. */
let COLE_CAMPBELL_ID: number;

afterAll(async () => {
  // Delete in reverse FK order.
  if (COLE_CAMPBELL_ID) {
    await db.delete(playerStatsTable).where(
      and(
        eq(playerStatsTable.playerId, COLE_CAMPBELL_ID),
        eq(playerStatsTable.periodType, "season_all"),
        eq(playerStatsTable.season, TEST_SEASON),
      ),
    );
  }
  if (sentinelPlayerId) {
    await db.delete(playersTable).where(eq(playersTable.id, sentinelPlayerId));
  }
  if (sentinelClubId) {
    await db.delete(clubsTable).where(eq(clubsTable.id, sentinelClubId));
  }
});

beforeAll(async () => {
  // 1. Insert a disposable club row (no real club required).
  const [club] = await db
    .insert(clubsTable)
    .values({
      name: "CI Test Club [cole-campbell-sentinel]",
      league: "Bundesliga 2",
      country: "Germany",
    })
    .returning({ id: clubsTable.id });
  if (!club) throw new Error("Failed to insert sentinel club for Cole Campbell test");
  sentinelClubId = club.id;

  // 2. Insert a disposable player row using the name the assertions expect.
  const [player] = await db
    .insert(playersTable)
    .values({
      name: "Cole Campbell",
      slug: "cole-campbell-ci-sentinel",
      position: "MF",
      category: "prospect",
      clubId: sentinelClubId,
      age: 22,
    })
    .returning({ id: playersTable.id });
  if (!player) throw new Error("Failed to insert sentinel player for Cole Campbell test");
  sentinelPlayerId = player.id;
  COLE_CAMPBELL_ID = sentinelPlayerId;

  // 3. Insert a season_all stats row — same shape syncPlayerStatsAndInjuries writes.
  //    onConflictDoNothing keeps the test idempotent if a previous crashed run left rows.
  await db
    .insert(playerStatsTable)
    .values({
      playerId: COLE_CAMPBELL_ID,
      periodType: "season_all",
      season: TEST_SEASON,
      minutes: 512,
      starts: 6,
      goals: 1,
      assists: 2,
      shots: 11,
      keyPasses: 9,
      avgRating: 7.12,
    })
    .onConflictDoNothing();
}, 30_000);

describe("GET /api/players/:id (Cole Campbell) — real stats response", () => {
  it(
    "returns HTTP 200 and a schema-valid body",
    async () => {
      const res = await request(app)
        .get(`/api/players/${COLE_CAMPBELL_ID}`)
        .expect(200);

      const result = GetPlayerResponse.safeParse(res.body);
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message} [${i.code}]`)
          .join("\n");
        throw new Error(
          `GET /api/players/${COLE_CAMPBELL_ID} response did not satisfy GetPlayerResponse schema.\n${issues}`,
        );
      }

      const player = result.data;
      expect(player.id).toBe(COLE_CAMPBELL_ID);
      expect(player.name).toBe("Cole Campbell");
    },
    30_000,
  );

  it(
    "surfaces real club seasons (not the N/A fallback)",
    async () => {
      const res = await request(app)
        .get(`/api/players/${COLE_CAMPBELL_ID}`)
        .expect(200);
      const player = GetPlayerResponse.parse(res.body);

      expect(
        player.availableClubSeasons.length,
        "availableClubSeasons must be non-empty now that real season_all rows exist",
      ).toBeGreaterThan(0);

      expect(
        player.clubSeasonStats.season,
        "clubSeasonStats.season must be a real year, not the N/A sentinel",
      ).not.toBe("N/A");
    },
    30_000,
  );

  it(
    "returns a positive avgRating from real API-Football data",
    async () => {
      const res = await request(app)
        .get(`/api/players/${COLE_CAMPBELL_ID}`)
        .expect(200);
      const player = GetPlayerResponse.parse(res.body);

      expect(
        player.clubSeasonStats.avgRating,
        "avgRating must be a positive number now that real stats exist",
      ).not.toBeNull();
      expect(player.clubSeasonStats.avgRating!).toBeGreaterThan(0);
    },
    30_000,
  );

  it(
    "returns minutes > 0 (player appeared in real matches)",
    async () => {
      const res = await request(app)
        .get(`/api/players/${COLE_CAMPBELL_ID}`)
        .expect(200);
      const player = GetPlayerResponse.parse(res.body);

      expect(
        player.clubSeasonStats.minutes,
        "minutes must be > 0 now that real season stats exist",
      ).toBeGreaterThan(0);
    },
    30_000,
  );
});
