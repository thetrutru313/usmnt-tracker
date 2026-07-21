/**
 * Regression guard: confirms GET /api/players/:id returns a clean, populated
 * response for Cole Campbell (player id=47, SV Elversberg) after real
 * Bundesliga stats were synced for his player ID (328617).
 *
 * ## What & Why
 * Cole Campbell's api_football_player_id=328617 is now synced and the DB
 * holds real season_all rows for 2025 and 2024.  This guard verifies:
 *   - The profile returns HTTP 200 and parses against the Zod schema
 *   - Real club seasons are surfaced (not the N/A fallback)
 *   - avgRating is a non-null number (real data, not a fabricated value)
 *   - The response shape is stable — a future route change that breaks the
 *     season-all path would fail here before reaching users.
 *
 * ## What is asserted
 * 1. GET /api/players/47 returns HTTP 200.
 * 2. The response body parses cleanly against GetPlayerResponse (Zod schema).
 * 3. `availableClubSeasons` contains at least one real season (e.g. "2025").
 * 4. `clubSeasonStats.avgRating` is a positive number (real API-Football data).
 * 5. `clubSeasonStats.minutes` is > 0 (player actually appeared in matches).
 */

import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { GetPlayerResponse } from "@workspace/api-zod";

const COLE_CAMPBELL_ID = 47;

describe("GET /api/players/47 (Cole Campbell) — real stats response", () => {
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
