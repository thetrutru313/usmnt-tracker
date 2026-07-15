/**
 * Integration guard: confirms that the live `/api/players/:id` response shape
 * matches the `GetPlayerResponse` Zod schema generated from the OpenAPI spec.
 *
 * Why this matters: the codegen drift check only confirms that the generated
 * Zod schema matches the spec YAML.  Nothing else catches the case where a
 * field is quietly removed (or renamed) inside the Express route handler
 * without a matching spec change.  This test closes that gap by hitting the
 * actual route and asserting the JSON body parses cleanly.
 *
 * How it works:
 *  1. Boots the Express app in-process via supertest (no separate server needed).
 *  2. Fetches the player list to obtain a real numeric ID (skips if the DB is empty).
 *  3. Calls GET /api/players/:id and runs the raw JSON body through
 *     GetPlayerResponse.safeParse().
 *  4. Fails loudly — printing every Zod issue — if any required field is
 *     missing or has the wrong type.
 */

import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { GetPlayerResponse, ListPlayersResponse } from "@workspace/api-zod";

describe("GET /api/players/:id — response shape matches GetPlayerResponse schema", () => {
  it("returns a body that satisfies every field in GetPlayerResponse", async () => {
    // ── Step 1: discover a real player ID ──────────────────────────────────
    const listRes = await request(app).get("/api/players").expect(200);

    const players = ListPlayersResponse.safeParse(listRes.body);
    expect(
      players.success,
      `Player list did not parse: ${players.success ? "" : JSON.stringify(players.error.issues, null, 2)}`,
    ).toBe(true);

    if (!players.data || players.data.length === 0) {
      // No players seeded — nothing to validate against; skip rather than
      // give a false green or a confusing failure.
      console.warn(
        "[getPlayerResponseShape] No players in DB — skipping shape check.",
      );
      return;
    }

    const playerId = players.data[0].id;

    // ── Step 2: fetch the full profile ─────────────────────────────────────
    const profileRes = await request(app)
      .get(`/api/players/${playerId}`)
      .expect(200);

    // ── Step 3: validate against the Zod schema ────────────────────────────
    const result = GetPlayerResponse.safeParse(profileRes.body);

    if (!result.success) {
      // Pretty-print every issue so the failure message is immediately useful.
      const issues = result.error.issues
        .map(
          (iss) =>
            `  • ${iss.path.join(".") || "(root)"}: ${iss.message} [${iss.code}]`,
        )
        .join("\n");

      throw new Error(
        `GET /api/players/${playerId} response did not satisfy GetPlayerResponse schema.\n` +
          `Schema violations (${result.error.issues.length}):\n${issues}\n\n` +
          `Fix the route handler or regenerate the schema with:\n` +
          `  pnpm --filter @workspace/api-spec run codegen`,
      );
    }

    // Sanity-check a handful of top-level required fields to make the intent
    // explicit in the test output.
    expect(typeof result.data.id).toBe("number");
    expect(typeof result.data.name).toBe("string");
    expect(typeof result.data.slug).toBe("string");
    expect(Array.isArray(result.data.matchLog)).toBe(true);
    expect(Array.isArray(result.data.injuries)).toBe(true);
    expect(Array.isArray(result.data.transfers)).toBe(true);
    expect(Array.isArray(result.data.upcomingFixtures)).toBe(true);
    expect(result.data.seasonStats).toBeDefined();
    expect(result.data.last5Stats).toBeDefined();
    expect(result.data.nationalTeamStats).toBeDefined();
  }, 30_000 /* generous timeout — first request may wait for the DB pool */);
});
