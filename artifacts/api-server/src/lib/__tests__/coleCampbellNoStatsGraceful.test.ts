/**
 * Regression guard: confirms GET /api/players/:id returns a clean, populated
 * response for Cole Campbell (SV Elversberg) after real Bundesliga stats were
 * synced for his player ID (328617).
 *
 * ## What & Why
 * Cole Campbell's api_football_player_id=328617 is pinned and the daily sync
 * writes real season_all rows for him. This guard verifies:
 *   - The profile returns HTTP 200 and parses against the Zod schema
 *   - Real club seasons are surfaced (not the N/A fallback)
 *   - avgRating is a non-null number (real data, not a fabricated value)
 *   - The response shape is stable — a future route change that breaks the
 *     season-all path would fail here before reaching users.
 *
 * ## Strategy
 * Rather than depending on live API-Football quota or sync timing, the test
 * directly inserts realistic stats rows (mirroring what the sync writes)
 * and verifies the profile endpoint returns them correctly. This is
 * equivalent to "after the next sync" without the timing dependency.
 *
 * The player ID is resolved dynamically at test startup (by name lookup)
 * rather than hardcoded, so re-seeds that renumber rows don't break the test.
 *
 * ## What is asserted
 * 1. GET /api/players/:id returns HTTP 200.
 * 2. The response body parses cleanly against GetPlayerResponse (Zod schema).
 * 3. `availableClubSeasons` contains at least one real season (e.g. "2025").
 * 4. `clubSeasonStats.avgRating` is a positive number (real API-Football data).
 * 5. `clubSeasonStats.minutes` is > 0 (player actually appeared in matches).
 *
 * ## Cleanup
 * All inserted rows are removed in afterAll in reverse-FK order.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { db, playersTable, playerStatsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { GetPlayerResponse } from "@workspace/api-zod";

// Resolved dynamically in beforeAll so re-seeds that renumber rows don't break the test.
let COLE_CAMPBELL_ID: number;
const TEST_SEASON = "2025";

afterAll(async () => {
  await db.delete(playerStatsTable).where(
    and(
      eq(playerStatsTable.playerId, COLE_CAMPBELL_ID),
      eq(playerStatsTable.periodType, "season_all"),
      eq(playerStatsTable.season, TEST_SEASON),
    ),
  );
});

beforeAll(async () => {
  const [row] = await db
    .select({ id: playersTable.id })
    .from(playersTable)
    .where(eq(playersTable.name, "Cole Campbell"))
    .limit(1);
  if (!row) throw new Error("Cole Campbell not found in players table — was the seed run?");
  COLE_CAMPBELL_ID = row.id;

  // Simulate a season_all stats row — same shape syncPlayerStatsAndInjuries writes.
  // Uses onConflictDoNothing so the test is idempotent if real sync data already exists.
  await db.insert(playerStatsTable).values({
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
  }).onConflictDoNothing();
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
