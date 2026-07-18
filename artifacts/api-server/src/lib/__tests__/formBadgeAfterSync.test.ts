/**
 * Regression guard: confirms that the `performanceTrend` badge on GET /injuries,
 * GET /transfers, and GET /players/:id is computed live from `player_stats`
 * rather than read from the stale `players.performanceTrend` column.
 *
 * Why this matters: `recomputeFormTrends` was removed because it silently threw
 * after every sync, leaving all 76 players showing "steady" indefinitely. Badges
 * are now derived at query time via `computeFormBadgesForPlayerIds`. If a future
 * change accidentally re-introduces a read of the stored column, these tests will
 * catch it by demonstrating that writing an arbitrary tier to
 * `players.performanceTrend` does NOT change the API response.
 *
 * How it works:
 *  1. Boots the Express app in-process via supertest (no separate server needed).
 *  2. Fetches the live injuries/transfers/player list; skips gracefully if empty.
 *  3. Records the initial computed badge for the first player in that list.
 *  4. Writes a DIFFERENT tier value directly to `players.performanceTrend`.
 *  5. Re-fetches the endpoint and asserts the badge is UNCHANGED — proving it
 *     is computed from stats, not the stored column.
 *  6. Also verifies `performanceTrend` is present and non-null on every row.
 *  7. Restores the original column value (cleanup runs even if assertions fail).
 */

import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { db, playersTable, injuriesTable, transfersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ListInjuriesResponse, ListTransfersResponse } from "@workspace/api-zod";

// ─── helpers ────────────────────────────────────────────────────────────────

/** Safe pretty-printer for Zod issues — keeps assertion messages readable. */
function fmtIssues(err: { issues: Array<{ path: unknown[]; message: string; code: string }> }): string {
  return err.issues.map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message} [${i.code}]`).join("\n");
}

const TIERS = ["on_fire", "rising", "steady", "falling", "ice_cold"] as const;
type Tier = (typeof TIERS)[number];

/** Pick a tier that is guaranteed to differ from `current`. */
function differentTier(current: string): Tier {
  const idx = TIERS.indexOf(current as Tier);
  return TIERS[(idx === -1 ? 0 : idx + 2) % TIERS.length];
}

// Track which player (if any) we modified so afterAll can restore the original.
let restoredPlayerId: number | null = null;
let originalTrend: string | null = null;

afterAll(async () => {
  if (restoredPlayerId !== null && originalTrend !== null) {
    await db
      .update(playersTable)
      .set({ performanceTrend: originalTrend as Tier })
      .where(eq(playersTable.id, restoredPlayerId));
  }
});

// ─── GET /injuries ───────────────────────────────────────────────────────────

describe("GET /injuries — performanceTrend is computed from stats, not the stored column", () => {
  it(
    "badge does not change when players.performanceTrend is written with a different value",
    async () => {
      const initialRes = await request(app).get("/api/injuries").expect(200);

      const initial = ListInjuriesResponse.safeParse(initialRes.body);
      expect(
        initial.success,
        `Initial /injuries did not parse:\n${initial.success ? "" : fmtIssues(initial.error)}`,
      ).toBe(true);

      if (!initial.data || initial.data.length === 0) {
        console.warn("[formBadgeAfterSync] No injuries in DB — skipping trend-isolation check.");
        return;
      }

      const firstInjury = initial.data[0];
      const playerId = firstInjury.player.id;
      const initialComputedBadge = firstInjury.performanceTrend;

      const [playerRow] = await db
        .select({ performanceTrend: playersTable.performanceTrend })
        .from(playersTable)
        .where(eq(playersTable.id, playerId));

      expect(playerRow, `Player ${playerId} not found in DB`).toBeDefined();

      restoredPlayerId = playerId;
      originalTrend = playerRow.performanceTrend;

      // Write a DIFFERENT tier to the stored column to prove it has no effect.
      const writtenTier = differentTier(playerRow.performanceTrend ?? "steady");
      await db
        .update(playersTable)
        .set({ performanceTrend: writtenTier })
        .where(eq(playersTable.id, playerId));

      const updatedRes = await request(app).get("/api/injuries").expect(200);
      const updated = ListInjuriesResponse.safeParse(updatedRes.body);
      expect(
        updated.success,
        `Updated /injuries did not parse:\n${updated.success ? "" : fmtIssues(updated.error)}`,
      ).toBe(true);

      const injuryForPlayer = updated.data!.find((row) => row.player.id === playerId);
      expect(
        injuryForPlayer,
        `Injury for player ${playerId} not found in updated /injuries response`,
      ).toBeDefined();

      // Core: badge must equal the initial computed value, not the tier we wrote.
      expect(
        injuryForPlayer!.performanceTrend,
        `Badge changed after writing to players.performanceTrend — route is reading the stale column instead of computing from stats`,
      ).toBe(initialComputedBadge);

      expect(injuryForPlayer!.performanceTrend).not.toBeNull();
    },
    30_000,
  );

  it(
    "performanceTrend is present on every item in the /injuries response",
    async () => {
      const res = await request(app).get("/api/injuries").expect(200);

      const parsed = ListInjuriesResponse.safeParse(res.body);
      expect(
        parsed.success,
        `/injuries did not parse:\n${parsed.success ? "" : fmtIssues(parsed.error)}`,
      ).toBe(true);

      if (!parsed.data || parsed.data.length === 0) {
        console.warn("[formBadgeAfterSync] No injuries in DB — skipping per-item check.");
        return;
      }

      for (const item of parsed.data) {
        expect(
          item.performanceTrend,
          `performanceTrend missing or null on injury id=${item.id} (player=${item.player.name})`,
        ).toBeTruthy();
      }
    },
    30_000,
  );
});

// ─── GET /transfers ──────────────────────────────────────────────────────────

describe("GET /transfers — performanceTrend is computed from stats, not the stored column", () => {
  it(
    "badge does not change when players.performanceTrend is written with a different value",
    async () => {
      const initialRes = await request(app).get("/api/transfers").expect(200);

      const initial = ListTransfersResponse.safeParse(initialRes.body);
      expect(
        initial.success,
        `Initial /transfers did not parse:\n${initial.success ? "" : fmtIssues(initial.error)}`,
      ).toBe(true);

      if (!initial.data || initial.data.length === 0) {
        console.warn("[formBadgeAfterSync] No transfers in DB — skipping trend-isolation check.");
        return;
      }

      const firstTransfer = initial.data[0];
      const playerId = firstTransfer.player.id;
      const initialComputedBadge = firstTransfer.performanceTrend;

      const [playerRow] = await db
        .select({ performanceTrend: playersTable.performanceTrend })
        .from(playersTable)
        .where(eq(playersTable.id, playerId));

      expect(playerRow, `Player ${playerId} not found in DB`).toBeDefined();

      if (restoredPlayerId === null) {
        restoredPlayerId = playerId;
        originalTrend = playerRow.performanceTrend;
      }

      // +2 steps so injuries and transfers tests write to a different tier.
      const writtenTier = differentTier(differentTier(playerRow.performanceTrend ?? "steady"));
      await db
        .update(playersTable)
        .set({ performanceTrend: writtenTier })
        .where(eq(playersTable.id, playerId));

      const updatedRes = await request(app).get("/api/transfers").expect(200);
      const updated = ListTransfersResponse.safeParse(updatedRes.body);
      expect(
        updated.success,
        `Updated /transfers did not parse:\n${updated.success ? "" : fmtIssues(updated.error)}`,
      ).toBe(true);

      const transferForPlayer = updated.data!.find((row) => row.player.id === playerId);
      expect(
        transferForPlayer,
        `Transfer for player ${playerId} not found in updated /transfers response`,
      ).toBeDefined();

      // Core: badge must equal the initial computed value, not the tier we wrote.
      expect(
        transferForPlayer!.performanceTrend,
        `Badge changed after writing to players.performanceTrend — route is reading the stale column instead of computing from stats`,
      ).toBe(initialComputedBadge);

      expect(transferForPlayer!.performanceTrend).not.toBeNull();
    },
    30_000,
  );

  it(
    "performanceTrend is present on every item in the /transfers response",
    async () => {
      const res = await request(app).get("/api/transfers").expect(200);

      const parsed = ListTransfersResponse.safeParse(res.body);
      expect(
        parsed.success,
        `/transfers did not parse:\n${parsed.success ? "" : fmtIssues(parsed.error)}`,
      ).toBe(true);

      if (!parsed.data || parsed.data.length === 0) {
        console.warn("[formBadgeAfterSync] No transfers in DB — skipping per-item check.");
        return;
      }

      for (const item of parsed.data) {
        expect(
          item.performanceTrend,
          `performanceTrend missing or null on transfer id=${item.id} (player=${item.player.name})`,
        ).toBeTruthy();
      }
    },
    30_000,
  );
});

// ─── GET /players/:id round-trip ────────────────────────────────────────────
//
// Confirms that performanceTrend on the player profile is computed from stats,
// not the stored column. If the route ever reads players.performanceTrend directly
// again, writing a different tier will change the response and the test will fail.

describe("GET /players/:id — performanceTrend is computed from stats, not the stored column", () => {
  let savedPlayerId: number | null = null;
  let savedOriginalTrend: string | null = null;

  afterAll(async () => {
    if (savedPlayerId !== null && savedOriginalTrend !== null) {
      await db
        .update(playersTable)
        .set({ performanceTrend: savedOriginalTrend as Tier })
        .where(eq(playersTable.id, savedPlayerId));
    }
  });

  it(
    "badge does not change when players.performanceTrend is written with a different value",
    async () => {
      const [playerRow] = await db
        .select({ id: playersTable.id, performanceTrend: playersTable.performanceTrend })
        .from(playersTable)
        .limit(1);

      if (!playerRow) {
        console.warn("[formBadgeAfterSync] No players in DB — skipping player profile trend check.");
        return;
      }

      savedPlayerId = playerRow.id;
      savedOriginalTrend = playerRow.performanceTrend;

      // Record the initial computed badge from the API.
      const initialRes = await request(app).get(`/api/players/${playerRow.id}`).expect(200);
      const initialComputedBadge = initialRes.body.performanceTrend;

      // Write a DIFFERENT tier to the stored column.
      const writtenTier = differentTier(playerRow.performanceTrend ?? "steady");
      await db
        .update(playersTable)
        .set({ performanceTrend: writtenTier })
        .where(eq(playersTable.id, playerRow.id));

      // Re-fetch and confirm badge is UNCHANGED (computed from stats).
      const res = await request(app).get(`/api/players/${playerRow.id}`).expect(200);

      expect(res.body).toBeDefined();
      expect(
        res.body.performanceTrend,
        `Badge changed after writing to players.performanceTrend — GET /players/:id is reading the stale column instead of computing from stats`,
      ).toBe(initialComputedBadge);
    },
    30_000,
  );

  it(
    "performanceTrend is present and non-null on the player profile response",
    async () => {
      const [playerRow] = await db
        .select({ id: playersTable.id })
        .from(playersTable)
        .limit(1);

      if (!playerRow) {
        console.warn("[formBadgeAfterSync] No players in DB — skipping player profile field presence check.");
        return;
      }

      const res = await request(app).get(`/api/players/${playerRow.id}`).expect(200);
      expect(res.body.performanceTrend).toBeDefined();
      expect(res.body.performanceTrend).not.toBeNull();
    },
    30_000,
  );
});

// ─── Schema-level guard ─────────────────────────────────────────────────────
//
// The Zod parse calls above already enforce that `performanceTrend` is present
// on every row (the schema marks it required). The tests below make that
// contract explicit and give a clear failure message if the schema ever changes
// to make the field optional.

describe("ListInjuriesResponse schema — performanceTrend is required, not optional", () => {
  it("rejects an item where performanceTrend is missing", () => {
    const badItem = {
      id: 1,
      player: { id: 10, name: "Test Player", slug: "test-player", position: "MF", photoUrl: null },
      clubName: "Test Club",
      bodyPart: "Hamstring",
      status: "active",
      expectedReturn: null,
      daysMissed: 14,
      matchesMissed: 2,
      latestUpdate: "Day-to-day",
      startDate: new Date().toISOString(),
      // performanceTrend intentionally omitted
    };

    const result = ListInjuriesResponse.safeParse([badItem]);
    expect(result.success).toBe(false);
  });

  it("accepts an item where performanceTrend is a valid tier string", () => {
    const goodItem = {
      id: 1,
      player: { id: 10, name: "Test Player", slug: "test-player", position: "MF", photoUrl: null },
      clubName: "Test Club",
      bodyPart: "Hamstring",
      status: "active",
      expectedReturn: null,
      daysMissed: 14,
      matchesMissed: 2,
      latestUpdate: "Day-to-day",
      startDate: new Date().toISOString(),
      performanceTrend: "rising",
    };

    const result = ListInjuriesResponse.safeParse([goodItem]);
    expect(result.success).toBe(true);
  });
});

describe("ListTransfersResponse schema — performanceTrend is required, not optional", () => {
  it("rejects an item where performanceTrend is missing", () => {
    const badItem = {
      id: 1,
      player: { id: 10, name: "Test Player", slug: "test-player", position: "MF", photoUrl: null },
      fromClub: "Club A",
      toClub: "Club B",
      transferType: "permanent",
      fee: null,
      status: "confirmed",
      probabilityScore: null,
      announcedAt: new Date().toISOString(),
      summary: null,
      // performanceTrend intentionally omitted
    };

    const result = ListTransfersResponse.safeParse([badItem]);
    expect(result.success).toBe(false);
  });

  it("accepts an item where performanceTrend is a valid tier string", () => {
    const goodItem = {
      id: 1,
      player: { id: 10, name: "Test Player", slug: "test-player", position: "MF", photoUrl: null },
      fromClub: "Club A",
      toClub: "Club B",
      transferType: "transfer",
      fee: null,
      status: "confirmed",
      probabilityScore: null,
      announcedAt: new Date().toISOString(),
      summary: "Player moves to Club B on a permanent deal.",
      performanceTrend: "on_fire",
    };

    const result = ListTransfersResponse.safeParse([goodItem]);
    expect(result.success).toBe(true);
  });
});
