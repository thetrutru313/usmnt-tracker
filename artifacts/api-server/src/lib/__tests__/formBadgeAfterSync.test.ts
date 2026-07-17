/**
 * Regression guard: confirms that after a player's `performanceTrend` value
 * changes in the database (simulating what a fresh sync run would do), the
 * next call to GET /injuries and GET /transfers returns the updated trend.
 *
 * Why this matters: `injuryWithPlayerColumns` and `transferWithPlayerColumns`
 * both join from the `players` table to pull `performanceTrend`. If that join
 * were ever dropped or the column omitted from the SELECT, the badge on the
 * Injuries and Transfers pages would silently show a stale or missing value.
 * This test catches that regression before it reaches users.
 *
 * How it works:
 *  1. Boots the Express app in-process via supertest (no separate server needed).
 *  2. Fetches the live injuries list; skips gracefully if the DB is empty.
 *  3. Writes a known `performanceTrend` value for the first player in that list.
 *  4. Re-fetches /injuries and /transfers, asserting the new value is reflected.
 *  5. Restores the original trend value (cleanup runs even if assertions fail).
 *
 * The test also verifies that `performanceTrend` is present and non-null in
 * both response schemas as parsed by the generated Zod validators.
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

// Track which player (if any) we modified so afterAll can restore the original.
let restoredPlayerId: number | null = null;
let originalTrend: string | null = null;

afterAll(async () => {
  if (restoredPlayerId !== null && originalTrend !== null) {
    await db
      .update(playersTable)
      .set({ performanceTrend: originalTrend as "on_fire" | "rising" | "steady" | "falling" | "ice_cold" })
      .where(eq(playersTable.id, restoredPlayerId));
  }
});

// ─── suite ──────────────────────────────────────────────────────────────────

describe("GET /injuries — performanceTrend reflects latest DB value", () => {
  it(
    "returns updated performanceTrend after a player row is written",
    async () => {
      // Step 1: fetch the injury list and bail early if no data is seeded.
      const initialRes = await request(app).get("/api/injuries").expect(200);

      const initial = ListInjuriesResponse.safeParse(initialRes.body);
      expect(
        initial.success,
        `Initial /injuries did not parse:\n${initial.success ? "" : fmtIssues(initial.error)}`,
      ).toBe(true);

      if (!initial.data || initial.data.length === 0) {
        console.warn("[formBadgeAfterSync] No injuries in DB — skipping trend-update check.");
        return;
      }

      // Step 2: pick the first injury's player and remember the current trend.
      const firstInjury = initial.data[0];
      const playerId = firstInjury.player.id;

      const [playerRow] = await db
        .select({ performanceTrend: playersTable.performanceTrend })
        .from(playersTable)
        .where(eq(playersTable.id, playerId));

      expect(playerRow, `Player ${playerId} not found in DB`).toBeDefined();

      restoredPlayerId = playerId;
      originalTrend = playerRow.performanceTrend;

      // Step 3: write a new trend value that differs from the current one.
      // Cycle through the five possible tiers so the test always writes
      // something different regardless of the seed state.
      const TIERS = ["on_fire", "rising", "steady", "falling", "ice_cold"] as const;
      type Tier = (typeof TIERS)[number];
      const currentTier = TIERS.includes(originalTrend as Tier)
        ? (originalTrend as Tier)
        : "steady";
      const newTrend: Tier = TIERS[(TIERS.indexOf(currentTier) + 1) % TIERS.length];

      await db
        .update(playersTable)
        .set({ performanceTrend: newTrend })
        .where(eq(playersTable.id, playerId));

      // Step 4: re-fetch /injuries and confirm the new trend is present.
      const updatedRes = await request(app).get("/api/injuries").expect(200);

      const updated = ListInjuriesResponse.safeParse(updatedRes.body);
      expect(
        updated.success,
        `Updated /injuries did not parse:\n${updated.success ? "" : fmtIssues(updated.error)}`,
      ).toBe(true);

      // The injury list is ordered by startDate desc; find the row for our player.
      const injuryForPlayer = updated.data!.find((row) => row.player.id === playerId);
      expect(
        injuryForPlayer,
        `Injury for player ${playerId} not found in updated /injuries response`,
      ).toBeDefined();

      // Core assertion: the route must reflect the newly written trend.
      expect(injuryForPlayer!.performanceTrend).toBe(newTrend);

      // Also confirm performanceTrend is non-null (not stripped by the route).
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

describe("GET /transfers — performanceTrend reflects latest DB value", () => {
  it(
    "returns updated performanceTrend after a player row is written",
    async () => {
      // Step 1: fetch the transfer list; skip if empty.
      const initialRes = await request(app).get("/api/transfers").expect(200);

      const initial = ListTransfersResponse.safeParse(initialRes.body);
      expect(
        initial.success,
        `Initial /transfers did not parse:\n${initial.success ? "" : fmtIssues(initial.error)}`,
      ).toBe(true);

      if (!initial.data || initial.data.length === 0) {
        console.warn("[formBadgeAfterSync] No transfers in DB — skipping trend-update check.");
        return;
      }

      // Step 2: pick the first transfer's player.
      const firstTransfer = initial.data[0];
      const playerId = firstTransfer.player.id;

      const [playerRow] = await db
        .select({ performanceTrend: playersTable.performanceTrend })
        .from(playersTable)
        .where(eq(playersTable.id, playerId));

      expect(playerRow, `Player ${playerId} not found in DB`).toBeDefined();

      // If afterAll for injuries already registered this player, reuse it;
      // otherwise register now for cleanup.
      if (restoredPlayerId === null) {
        restoredPlayerId = playerId;
        originalTrend = playerRow.performanceTrend;
      }

      // Step 3: write a distinct trend value.
      const TIERS = ["on_fire", "rising", "steady", "falling", "ice_cold"] as const;
      type Tier = (typeof TIERS)[number];
      const currentTier: Tier = TIERS.includes(playerRow.performanceTrend as Tier)
        ? (playerRow.performanceTrend as Tier)
        : "steady";
      const newTrend: Tier = TIERS[(TIERS.indexOf(currentTier) + 2) % TIERS.length]; // +2 so injuries and transfers tests use a different value

      await db
        .update(playersTable)
        .set({ performanceTrend: newTrend })
        .where(eq(playersTable.id, playerId));

      // Step 4: re-fetch /transfers and check the updated trend is reflected.
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

      expect(transferForPlayer!.performanceTrend).toBe(newTrend);
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
// Confirms that performanceTrend written to the players table is returned
// correctly by GET /api/players/:id. This is the API surface the player
// profile page reads from — if the route ever dropped the column from its
// join or response shape, the form badge would silently vanish from the UI.

describe("GET /players/:id — performanceTrend reflects latest DB value", () => {
  let savedPlayerId: number | null = null;
  let savedOriginalTrend: string | null = null;

  afterAll(async () => {
    if (savedPlayerId !== null && savedOriginalTrend !== null) {
      await db
        .update(playersTable)
        .set({ performanceTrend: savedOriginalTrend as "on_fire" | "rising" | "steady" | "falling" | "ice_cold" })
        .where(eq(playersTable.id, savedPlayerId));
    }
  });

  it(
    "returns the updated performanceTrend after a direct DB write",
    async () => {
      // Step 1: find any player in the DB.
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

      // Step 2: write a known trend that differs from the current one.
      const TIERS = ["on_fire", "rising", "steady", "falling", "ice_cold"] as const;
      type Tier = (typeof TIERS)[number];
      const currentTier: Tier = TIERS.includes(playerRow.performanceTrend as Tier)
        ? (playerRow.performanceTrend as Tier)
        : "steady";
      const newTrend: Tier = TIERS[(TIERS.indexOf(currentTier) + 1) % TIERS.length];

      await db
        .update(playersTable)
        .set({ performanceTrend: newTrend })
        .where(eq(playersTable.id, playerRow.id));

      // Step 3: fetch the player profile and confirm the trend is reflected.
      const res = await request(app).get(`/api/players/${playerRow.id}`).expect(200);

      expect(res.body).toBeDefined();
      expect(
        res.body.performanceTrend,
        `GET /api/players/${playerRow.id} must return performanceTrend='${newTrend}' after DB write`,
      ).toBe(newTrend);
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
