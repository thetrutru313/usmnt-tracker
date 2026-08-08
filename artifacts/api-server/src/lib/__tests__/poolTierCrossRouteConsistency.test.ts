/**
 * Tests 4 & 5 — poolTier cross-route consistency.
 *
 * ## Why this matters
 * Q7 found 8 players whose tier badge differed between the list page and
 * the profile page. The root cause was that GET /api/players/:id never
 * returned a `poolTier` field, forcing PlayerProfile.tsx to reimplement
 * the tier rule from `category` — a different rule that drifted.
 *
 * ## What is tested
 * Test 4: GET /api/players/:id returns a `poolTier` field.
 * Test 5: Its value equals the one GET /api/players returns for the same
 *         player — specifically for a player where category and poolTier
 *         would produce different results (e.g. Yunus Musah: category=
 *         'current' → 'core' under the old rule, but poolTier='inMix'
 *         under computePoolTier because worldCupRoster=false).
 *
 * ## Cross-route pattern
 * This is the first cross-route consistency test in the repository. It
 * establishes the pattern for catching "field missing from one route but
 * present in another" bugs before they reach users.
 */

import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { ListPlayersResponse } from "@workspace/api-zod";

describe("GET /api/players/:id — poolTier cross-route consistency (Tests 4 & 5)", () => {
  it(
    "Test 4: profile response includes a poolTier field",
    async () => {
      const listRes = await request(app).get("/api/players").expect(200);
      const parsed = ListPlayersResponse.safeParse(listRes.body);
      if (!parsed.success || !parsed.data || parsed.data.length === 0) {
        console.warn("[poolTierCrossRoute] No players in DB — skipping.");
        return;
      }

      const profileRes = await request(app)
        .get(`/api/players/${parsed.data[0].id}`)
        .expect(200);

      const profile = profileRes.body;

      // Before fix: poolTier is absent from the profile response → FAILS
      // After fix: poolTier is present → PASSES
      expect(profile.poolTier).toBeDefined();
      expect(["core", "inMix", "prospect"]).toContain(profile.poolTier);
    },
    30_000,
  );

  it(
    "Test 5: profile poolTier matches list poolTier for the same player (including mismatch players)",
    async () => {
      const listRes = await request(app).get("/api/players").expect(200);
      const parsed = ListPlayersResponse.safeParse(listRes.body);
      if (!parsed.success || !parsed.data || parsed.data.length === 0) {
        console.warn("[poolTierCrossRoute] No players in DB — skipping.");
        return;
      }

      const players = parsed.data;

      // Prefer a player where category and poolTier would disagree under the
      // old profile rule — e.g. category='current' but poolTier='inMix'.
      // This is the discriminating case that proved the bug.
      const mismatchPlayer =
        players.find((p) => p.category === "current" && p.poolTier === "inMix") ??
        players.find((p) => p.category === "fringe" && p.poolTier === "prospect") ??
        players[0];

      const profileRes = await request(app)
        .get(`/api/players/${mismatchPlayer.id}`)
        .expect(200);

      const profile = profileRes.body;

      // Test 4 pre-condition: poolTier must exist
      expect(profile.poolTier).toBeDefined();

      // Test 5: values must agree across routes
      // Before fix: profile.poolTier is undefined (missing) → toBe fails
      // After fix: both routes use computePoolTier → values match
      expect(profile.poolTier).toBe(mismatchPlayer.poolTier);
    },
    30_000,
  );
});
