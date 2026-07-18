/**
 * Regression guard: confirms that GET /api/search returns `performanceTrend`
 * and `trending` on every player result, computed live from `player_stats`
 * rather than read from the stale `players.performanceTrend` column.
 *
 * If the badge overlay is ever dropped from search.ts, the SearchResponse Zod
 * parse will throw a runtime error for any search that returns players.
 */

import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { db, playersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { SearchResponse } from "@workspace/api-zod";

function fmtIssues(err: { issues: Array<{ path: unknown[]; message: string; code: string }> }): string {
  return err.issues.map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message} [${i.code}]`).join("\n");
}

const TIERS = ["on_fire", "rising", "steady", "falling", "ice_cold"] as const;
type Tier = (typeof TIERS)[number];

describe("GET /search — player results include computed form badge", () => {
  it("returns performanceTrend and trending on every player result", async () => {
    const [firstPlayer] = await db
      .select({ name: playersTable.name })
      .from(playersTable)
      .limit(1);

    if (!firstPlayer) {
      console.warn("[searchBadgeOverlay] No players in DB — skipping.");
      return;
    }

    const prefix = firstPlayer.name.slice(0, 3);
    const res = await request(app).get(`/api/search?q=${encodeURIComponent(prefix)}`).expect(200);

    const parsed = SearchResponse.safeParse(res.body);
    expect(
      parsed.success,
      `/search did not parse:\n${parsed.success ? "" : fmtIssues(parsed.error)}`,
    ).toBe(true);

    if (!parsed.data || parsed.data.players.length === 0) {
      console.warn("[searchBadgeOverlay] Search returned no players — skipping per-item check.");
      return;
    }

    for (const player of parsed.data.players) {
      expect(
        player.performanceTrend,
        `performanceTrend missing on search result player id=${player.id} (${player.name})`,
      ).toBeTruthy();
      expect(
        typeof player.trending,
        `trending must be a boolean on search result player id=${player.id}`,
      ).toBe("boolean");
    }
  });

  it("does not change the badge when players.performanceTrend is written directly", async () => {
    const [firstPlayer] = await db
      .select({ id: playersTable.id, name: playersTable.name, performanceTrend: playersTable.performanceTrend })
      .from(playersTable)
      .limit(1);

    if (!firstPlayer) {
      console.warn("[searchBadgeOverlay] No players in DB — skipping isolation check.");
      return;
    }

    const prefix = firstPlayer.name.slice(0, 3);

    const initialRes = await request(app).get(`/api/search?q=${encodeURIComponent(prefix)}`).expect(200);
    const initialData = SearchResponse.safeParse(initialRes.body);
    expect(initialData.success).toBe(true);

    const initialPlayer = initialData.data!.players.find((p) => p.id === firstPlayer.id);
    if (!initialPlayer) {
      console.warn("[searchBadgeOverlay] Player not in search results — skipping isolation check.");
      return;
    }
    const initialBadge = initialPlayer.performanceTrend;

    const currentIdx = TIERS.indexOf((firstPlayer.performanceTrend ?? "steady") as Tier);
    const writtenTier: Tier = TIERS[(currentIdx + 2) % TIERS.length];

    await db.update(playersTable).set({ performanceTrend: writtenTier }).where(eq(playersTable.id, firstPlayer.id));

    try {
      const updatedRes = await request(app).get(`/api/search?q=${encodeURIComponent(prefix)}`).expect(200);
      const updatedData = SearchResponse.safeParse(updatedRes.body);
      expect(updatedData.success).toBe(true);

      const updatedPlayer = updatedData.data!.players.find((p) => p.id === firstPlayer.id);
      if (!updatedPlayer) return;

      // Core: badge must equal the initial computed value, not the tier we wrote.
      expect(
        updatedPlayer.performanceTrend,
        "Badge changed after writing to players.performanceTrend — search is reading the stale column",
      ).toBe(initialBadge);
    } finally {
      await db
        .update(playersTable)
        .set({ performanceTrend: (firstPlayer.performanceTrend ?? "steady") as Tier })
        .where(eq(playersTable.id, firstPlayer.id));
    }
  });
});
