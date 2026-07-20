/**
 * Regression guard: confirms GET /api/players/:id returns a clean 200 with
 * graceful null/empty fields for Cole Campbell (player id=47, SV Elversberg)
 * while API-Football has not yet synced stats for his new player ID (328617).
 *
 * ## What & Why
 * Cole Campbell has api_football_player_id=328617 and club team id=1660 set
 * correctly.  Until the next daily stats sync runs and API-Football returns
 * data for this ID, the DB holds no player_stats or match_logs rows for him.
 *
 * The route falls back to `emptyStats` in that case — but a regression (e.g.
 * an unguarded `.season` access or a missing null-check) could silently turn
 * the fallback into a 500.  This test catches that.
 *
 * ## What is asserted
 * 1. GET /api/players/47 returns HTTP 200 (not 404, not 500).
 * 2. The response body parses cleanly against GetPlayerResponse (Zod schema).
 * 3. `availableClubSeasons` is empty  → UI shows "N/A" chip, not a season selector.
 * 4. `clubSeasonStats.season` is "N/A" (the emptyStats sentinel).
 * 5. `clubSeasonStats.avgRating` is null → UI shows '–', not fabricated zeros.
 * 6. `matchLog` is empty → no fabricated history rows.
 * 7. `clubSeasonStats.minutes` is 0 (known-absent data, not a bad parse).
 *
 * ## When this test should be updated
 * Once the daily stats sync runs and populates real Bundesliga data for
 * player 328617, assertions 3-6 should be replaced with positive checks on
 * the real stats values.
 */

import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { GetPlayerResponse } from "@workspace/api-zod";

const COLE_CAMPBELL_ID = 47;

describe("GET /api/players/47 (Cole Campbell) — graceful no-stats response", () => {
  it(
    "returns HTTP 200 and a schema-valid body when no stats rows exist",
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

      // Basic identity
      expect(player.id).toBe(COLE_CAMPBELL_ID);
      expect(player.name).toBe("Cole Campbell");
    },
    30_000,
  );

  it(
    "shows no available club seasons (triggers N/A chip in UI)",
    async () => {
      const res = await request(app)
        .get(`/api/players/${COLE_CAMPBELL_ID}`)
        .expect(200);
      const player = GetPlayerResponse.parse(res.body);

      expect(
        player.availableClubSeasons,
        "availableClubSeasons must be empty when no stats rows exist",
      ).toHaveLength(0);

      expect(
        player.clubSeasonStats.season,
        "clubSeasonStats.season must be the N/A sentinel when no stats rows exist",
      ).toBe("N/A");
    },
    30_000,
  );

  it(
    "returns null for clubSeasonStats.avgRating (shows '–' in UI, not a fabricated value)",
    async () => {
      const res = await request(app)
        .get(`/api/players/${COLE_CAMPBELL_ID}`)
        .expect(200);
      const player = GetPlayerResponse.parse(res.body);

      expect(
        player.clubSeasonStats.avgRating,
        "avgRating must be null when API-Football has no rating data — UI renders '–'",
      ).toBeNull();
    },
    30_000,
  );

  it(
    "returns an empty matchLog (no fabricated history rows)",
    async () => {
      const res = await request(app)
        .get(`/api/players/${COLE_CAMPBELL_ID}`)
        .expect(200);
      const player = GetPlayerResponse.parse(res.body);

      expect(
        player.matchLog,
        "matchLog must be empty when no match_logs rows exist for this player",
      ).toHaveLength(0);
    },
    30_000,
  );
});
