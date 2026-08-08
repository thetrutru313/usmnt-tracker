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
import { SearchResponse } from "@workspace/api-zod";

function fmtIssues(err: { issues: Array<{ path: unknown[]; message: string; code: string }> }): string {
  return err.issues.map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message} [${i.code}]`).join("\n");
}

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

});
// Note: the second test ("does not change the badge when players.performanceTrend is written
// directly") was removed when that column was dropped in Prompt 12 Task D. The badge is now
// computed exclusively from player_stats; no stored column can be written to produce a stale read.
