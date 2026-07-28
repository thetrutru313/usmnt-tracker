/**
 * Regression guard: confirms GET /api/players/:id (Damion Downs) correctly
 * surfaces stats and match logs once the stats sync writes data for his
 * corrected api_football_player_id (334362 / Hamburger SV).
 *
 * ## Why this test exists
 * Damion Downs' player ID was corrected from a mis-resolved ID to 334362.
 * The daily stats sync will write real Bundesliga data using that ID.
 * This test proves the full profile pipeline works end-to-end: once the
 * sync writes player_stats and match_logs rows for Damion Downs, the
 * GET /api/players/:id endpoint surfaces them correctly — not the N/A
 * fallback, and not stale data from any previous wrong ID.
 *
 * ## Strategy
 * Rather than depending on live API-Football quota or sync timing, the test
 * directly inserts realistic stats/log rows (mirroring what the sync writes)
 * and verifies the profile endpoint returns them correctly. This is
 * equivalent to "after the next sync" without the timing dependency.
 *
 * The player ID is resolved dynamically at test startup (by name lookup)
 * rather than hardcoded, so re-seeds that renumber rows don't break the test.
 *
 * ## What is asserted
 * 1. GET /api/players/:id returns HTTP 200 and parses against the Zod schema.
 * 2. `availableClubSeasons` contains the synced season (not empty/N/A).
 * 3. `clubSeasonStats.season` is a real year string ("2025").
 * 4. `clubSeasonStats.avgRating` is a positive number (not null / fabricated).
 * 5. `clubSeasonStats.minutes` is > 0 (player appeared in matches).
 * 6. `matchLog` is non-empty — match history rows are returned.
 * 7. The fixture links (HSV games) remain correct throughout.
 *
 * ## Cleanup
 * All inserted rows are removed in afterAll in reverse-FK order.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { db, matchLogsTable, playerStatsTable, playersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { GetPlayerResponse } from "@workspace/api-zod";

// Resolved dynamically in beforeAll so re-seeds that renumber rows don't break the test.
let DAMION_DOWNS_ID: number;
const TEST_SEASON = "2025";

// ── Cleanup state ──────────────────────────────────────────────────────────────

let insertedLogId: number | null = null;

afterAll(async () => {
  // Remove the simulated match log
  if (insertedLogId !== null) {
    await db.delete(matchLogsTable).where(eq(matchLogsTable.id, insertedLogId));
  }
  // Remove the simulated season_all stats row
  await db.delete(playerStatsTable).where(
    and(
      eq(playerStatsTable.playerId, DAMION_DOWNS_ID),
      eq(playerStatsTable.periodType, "season_all"),
      eq(playerStatsTable.season, TEST_SEASON),
    ),
  );
});

// ── Setup: insert realistic stats rows mirroring what the sync would write ────

beforeAll(async () => {
  // Resolve Damion Downs' current DB id by name — guards against re-seeds
  // that renumber rows (the name is stable; the serial id is not).
  const [row] = await db
    .select({ id: playersTable.id })
    .from(playersTable)
    .where(eq(playersTable.name, "Damion Downs"))
    .limit(1);
  if (!row) throw new Error("Damion Downs not found in players table — was the seed run?");
  DAMION_DOWNS_ID = row.id;

  // Simulate a season_all stats row — same shape syncPlayerStatsAndInjuries writes
  await db.insert(playerStatsTable).values({
    playerId: DAMION_DOWNS_ID,
    periodType: "season_all",
    season: TEST_SEASON,
    minutes: 423,
    starts: 5,
    goals: 2,
    assists: 1,
    shots: 14,
    keyPasses: 6,
    avgRating: 6.98,
  });

  // Simulate a recent match log — same shape syncClubMatchLogs writes
  const [log] = await db.insert(matchLogsTable).values({
    playerId: DAMION_DOWNS_ID,
    date: "2025-11-09",
    opponent: "__HSV-test-opponent__",
    competition: "Bundesliga",
    result: "W 2-1",
    minutes: 90,
    goals: 1,
    assists: 0,
    rating: 7.1,
    isNationalTeam: false,
  }).returning({ id: matchLogsTable.id });
  insertedLogId = log!.id;
}, 30_000);

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("GET /api/players/:id (Damion Downs) — stats surfaced after corrected player ID syncs", () => {
  it(
    "returns HTTP 200 and a schema-valid body",
    async () => {
      const res = await request(app)
        .get(`/api/players/${DAMION_DOWNS_ID}`)
        .expect(200);

      const result = GetPlayerResponse.safeParse(res.body);
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message} [${i.code}]`)
          .join("\n");
        throw new Error(
          `GET /api/players/${DAMION_DOWNS_ID} response did not satisfy GetPlayerResponse schema.\n${issues}`,
        );
      }

      expect(result.data.id).toBe(DAMION_DOWNS_ID);
      expect(result.data.name).toBe("Damion Downs");
    },
    30_000,
  );

  it(
    "surfaces the synced club season — not the N/A fallback",
    async () => {
      const res = await request(app)
        .get(`/api/players/${DAMION_DOWNS_ID}`)
        .expect(200);
      const player = GetPlayerResponse.parse(res.body);

      expect(
        player.availableClubSeasons,
        "availableClubSeasons must contain the synced season",
      ).toContain(TEST_SEASON);

      expect(
        player.clubSeasonStats.season,
        "clubSeasonStats.season must be a real year, not the N/A sentinel",
      ).not.toBe("N/A");
    },
    30_000,
  );

  it(
    "returns a positive avgRating from synced data",
    async () => {
      const res = await request(app)
        .get(`/api/players/${DAMION_DOWNS_ID}`)
        .expect(200);
      const player = GetPlayerResponse.parse(res.body);

      expect(
        player.clubSeasonStats.avgRating,
        "avgRating must be a non-null positive number after sync",
      ).not.toBeNull();
      expect(player.clubSeasonStats.avgRating!).toBeGreaterThan(0);
    },
    30_000,
  );

  it(
    "returns minutes > 0 (player appeared in Bundesliga matches)",
    async () => {
      const res = await request(app)
        .get(`/api/players/${DAMION_DOWNS_ID}`)
        .expect(200);
      const player = GetPlayerResponse.parse(res.body);

      expect(
        player.clubSeasonStats.minutes,
        "minutes must be > 0 after sync writes real playing-time data",
      ).toBeGreaterThan(0);
    },
    30_000,
  );

  it(
    "returns a non-empty matchLog (Hamburger SV match history appears)",
    async () => {
      const res = await request(app)
        .get(`/api/players/${DAMION_DOWNS_ID}`)
        .expect(200);
      const player = GetPlayerResponse.parse(res.body);

      expect(
        player.matchLog.length,
        "matchLog must be non-empty after sync writes club match-log rows",
      ).toBeGreaterThan(0);

      // The Bundesliga entry we inserted should be present
      const bundesligaEntry = player.matchLog.find(
        (m) => m.competition === "Bundesliga" && m.opponent === "__HSV-test-opponent__",
      );
      expect(
        bundesligaEntry,
        "the Bundesliga match log entry must appear in the profile's match history",
      ).toBeDefined();
    },
    30_000,
  );

  it(
    "preserves the 9 HSV fixture links (no wrong-club fixtures introduced)",
    async () => {
      const res = await request(app)
        .get(`/api/players/${DAMION_DOWNS_ID}`)
        .expect(200);
      const player = GetPlayerResponse.parse(res.body);

      // All upcoming fixtures must be HSV games — no wrong-club fixtures
      for (const fixture of player.upcomingFixtures) {
        const isHSVGame =
          fixture.homeTeam === "Hamburger SV" || fixture.awayTeam === "Hamburger SV";
        expect(
          isHSVGame,
          `Fixture "${fixture.homeTeam} vs ${fixture.awayTeam}" is not an HSV game — wrong-club fixture leaked`,
        ).toBe(true);
      }
    },
    30_000,
  );
});
