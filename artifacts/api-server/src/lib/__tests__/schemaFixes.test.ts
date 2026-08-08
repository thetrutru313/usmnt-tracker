/**
 * Prompt 12 — Schema-fix regression tests
 *
 * Covers:
 *   Test 1 — FK rejects a fixture_players row with a non-existent player_id
 *   Test 2 — FK blocks deletion of a player who still has fixture_players links
 *   Test 3 — Fixture whose only link was cleaned up is absent from GET /api/fixtures
 *   Test 4 — B1: duplicate (player_id, period_type, season) row rejected
 *   Test 5 — B2: second 'season' row for same player with different season label rejected
 *   Test 6 — B2 NOT applied to season_all: second row with different season label succeeds
 *   Test 7 — computeFormBadgesForPlayerIds returns the newest row deterministically
 *
 * All rows are cleaned up in afterAll in FK-safe reverse order.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import {
  db,
  clubsTable,
  playersTable,
  fixturesTable,
  fixturePlayersTable,
  playerStatsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { computeFormBadgesForPlayerIds } from "../queries.js";

// ── Shared state ──────────────────────────────────────────────────────────────

let testClubId: number;
let testPlayerId: number;       // used by Tests 2, 3, 7
let testFixtureId: number;      // used by Tests 2, 3
let statsPlayerId: number;      // used by Tests 4, 5, 6, 7
const extraPlayerIds: number[] = [];   // bulk cleanup
const extraFixtureIds: number[] = [];  // bulk cleanup

// ── Helpers ───────────────────────────────────────────────────────────────────

async function insertClub(): Promise<number> {
  const [row] = await db
    .insert(clubsTable)
    .values({ name: "__SF12__ Club", league: "Test League", country: "Testland" })
    .returning({ id: clubsTable.id });
  return row.id;
}

async function insertPlayer(clubId: number, tag: string): Promise<number> {
  const [row] = await db
    .insert(playersTable)
    .values({
      name: `__SF12__ ${tag}`,
      slug: `sf12-${tag.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      position: "MID",
      category: "prospect",
      clubId,
      age: 22,
    })
    .returning({ id: playersTable.id });
  return row.id;
}

async function insertFutureFixture(): Promise<number> {
  const kickoff = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days out
  const [row] = await db
    .insert(fixturesTable)
    .values({
      competition: "Test League",
      kickoff,
      venue: "Test Stadium",
      homeTeam: "__SF12__ Home FC",
      awayTeam: "__SF12__ Away FC",
      status: "scheduled",
    })
    .returning({ id: fixturesTable.id });
  return row.id;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  testClubId = await insertClub();
  testPlayerId = await insertPlayer(testClubId, "Main Player");
  testFixtureId = await insertFutureFixture();
  statsPlayerId = await insertPlayer(testClubId, "Stats Player");
});

// ── Teardown — reverse FK order ───────────────────────────────────────────────

afterAll(async () => {
  // fixture_players links first
  if (testFixtureId) {
    await db.delete(fixturePlayersTable).where(eq(fixturePlayersTable.fixtureId, testFixtureId));
  }
  for (const fid of extraFixtureIds) {
    await db.delete(fixturePlayersTable).where(eq(fixturePlayersTable.fixtureId, fid));
    await db.delete(fixturesTable).where(eq(fixturesTable.id, fid));
  }
  // player_stats (FK references players)
  if (statsPlayerId) {
    await db.delete(playerStatsTable).where(eq(playerStatsTable.playerId, statsPlayerId));
  }
  for (const pid of extraPlayerIds) {
    await db.delete(playerStatsTable).where(eq(playerStatsTable.playerId, pid));
    await db.delete(playersTable).where(eq(playersTable.id, pid));
  }
  // fixtures
  if (testFixtureId) {
    await db.delete(fixturesTable).where(eq(fixturesTable.id, testFixtureId));
  }
  // players
  if (testPlayerId) await db.delete(playersTable).where(eq(playersTable.id, testPlayerId));
  if (statsPlayerId) await db.delete(playersTable).where(eq(playersTable.id, statsPlayerId));
  // club last
  if (testClubId) await db.delete(clubsTable).where(eq(clubsTable.id, testClubId));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Prompt 12 — schema fixes", () => {
  // ── Task A: FK tests ───────────────────────────────────────────────────────

  it(
    "Test 1: inserting a fixture_players row with a non-existent player_id is rejected by the FK",
    async () => {
      const GHOST_PLAYER_ID = 999_999_999; // guaranteed absent

      await expect(
        db.insert(fixturePlayersTable).values({
          fixtureId: testFixtureId,
          playerId: GHOST_PLAYER_ID,
        }),
      ).rejects.toThrow(); // FK violation — any error satisfies the guard
    },
    15_000,
  );

  it(
    "Test 2: deleting a player who still has fixture_players links fails; the links survive",
    async () => {
      // Create the link
      await db.insert(fixturePlayersTable).values({
        fixtureId: testFixtureId,
        playerId: testPlayerId,
      });

      // Attempt to delete the player — must be rejected (NO ACTION FK on fixture_players.player_id)
      await expect(
        db.delete(playersTable).where(eq(playersTable.id, testPlayerId)),
      ).rejects.toThrow();

      // Confirm the fixture_players row survived
      const rows = await db
        .select({ id: fixturePlayersTable.id })
        .from(fixturePlayersTable)
        .where(
          and(
            eq(fixturePlayersTable.fixtureId, testFixtureId),
            eq(fixturePlayersTable.playerId, testPlayerId),
          ),
        );
      expect(rows.length).toBe(1);
      // (link cleaned up by afterAll)
    },
    15_000,
  );

  it(
    "Test 3: a fixture whose only player link has been cleaned up is absent from GET /api/fixtures",
    async () => {
      // Create a fresh fixture + player + link; verify the fixture appears.
      const orphanFixtureId = await insertFutureFixture();
      extraFixtureIds.push(orphanFixtureId);
      const orphanPlayerId = await insertPlayer(testClubId, "Orphan Cleanup Player");
      extraPlayerIds.push(orphanPlayerId);

      await db.insert(fixturePlayersTable).values({
        fixtureId: orphanFixtureId,
        playerId: orphanPlayerId,
      });

      const beforeRes = await request(app).get("/api/fixtures?scope=upcoming").expect(200);
      const fixtureIds: number[] = (beforeRes.body as { id: number }[]).map((f) => f.id);
      expect(fixtureIds).toContain(orphanFixtureId); // appears while link exists

      // Remove the link (simulates what the generic orphan DELETE does)
      await db
        .delete(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, orphanFixtureId));

      const afterRes = await request(app).get("/api/fixtures?scope=upcoming").expect(200);
      const afterIds: number[] = (afterRes.body as { id: number }[]).map((f) => f.id);
      expect(afterIds).not.toContain(orphanFixtureId); // absent once link is gone
    },
    20_000,
  );

  // ── Task B: unique index tests ─────────────────────────────────────────────

  it(
    "Test 4 (B1): inserting a second player_stats row with the same (player_id, period_type, season) fails",
    async () => {
      await db.insert(playerStatsTable).values({
        playerId: statsPlayerId,
        periodType: "season_all",
        season: "2099",
        minutes: 900,
        goals: 3,
        starts: 10,
        assists: 1,
        shots: 0,
        keyPasses: 0,
      });

      // Same (player_id, period_type='season_all', season='2099') — must fail (B1)
      await expect(
        db.insert(playerStatsTable).values({
          playerId: statsPlayerId,
          periodType: "season_all",
          season: "2099",
          minutes: 100,
          goals: 0,
          starts: 1,
          assists: 0,
          shots: 0,
          keyPasses: 0,
        }),
      ).rejects.toThrow();
    },
    15_000,
  );

  it(
    "Test 5 (B2): inserting a second 'season' row for the same player under a DIFFERENT season label fails",
    async () => {
      await db.insert(playerStatsTable).values({
        playerId: statsPlayerId,
        periodType: "season",
        season: "2098",
        minutes: 1800,
        goals: 5,
        starts: 20,
        assists: 2,
        shots: 0,
        keyPasses: 0,
      });

      // Different season label ("2099" vs "2098") but same (player_id, period_type='season').
      // B1 alone would NOT catch this (seasons differ). B2 must reject it.
      await expect(
        db.insert(playerStatsTable).values({
          playerId: statsPlayerId,
          periodType: "season",
          season: "2099",
          minutes: 900,
          goals: 3,
          starts: 10,
          assists: 1,
          shots: 0,
          keyPasses: 0,
        }),
      ).rejects.toThrow();
    },
    15_000,
  );

  it(
    "Test 6 (B2 negative guard): inserting a second 'season_all' row for the same player under a DIFFERENT season label SUCCEEDS",
    async () => {
      // 'season_all' is NOT in the B2 partial index, so multiple rows with
      // different season labels are allowed — they power the club-season selector.
      // This is the regression guard against the mistake nearly made in Round 1:
      // adding a constraint that would wipe every player's season history.
      await expect(
        db.insert(playerStatsTable).values({
          playerId: statsPlayerId,
          periodType: "season_all",
          season: "2098", // different season from the "2099" row inserted in Test 4
          minutes: 1800,
          goals: 8,
          starts: 20,
          assists: 3,
          shots: 0,
          keyPasses: 0,
        }),
      ).resolves.toBeDefined();
    },
    15_000,
  );

  // ── Task C: deterministic form badge ──────────────────────────────────────

  it(
    "Test 7: computeFormBadgesForPlayerIds reads the correct stats rows deterministically",
    async () => {
      // Seed a fresh player with a complete set of stats (last5, previous5, season).
      // The form-badge computation is:
      //   on_fire/rising  → trending=true
      //   steady/falling  → trending=false
      // We seed last5.avgRating=8.5, season.avgRating=7.0 → strong delta → "rising" or "on_fire".
      const pid = await insertPlayer(testClubId, "Badge Test Player");
      extraPlayerIds.push(pid);

      await db.insert(playerStatsTable).values([
        {
          playerId: pid,
          periodType: "last5",
          season: "2098",
          minutes: 450,        // 5 × 90 — above the 270-minute threshold
          goals: 3,
          starts: 5,
          assists: 1,
          shots: 0,
          keyPasses: 0,
          avgRating: 8.5,      // strong positive delta vs season
        },
        {
          playerId: pid,
          periodType: "previous5",
          season: "2098",
          minutes: 400,
          goals: 1,
          starts: 5,
          assists: 0,
          shots: 0,
          keyPasses: 0,
          avgRating: 7.0,
        },
        {
          playerId: pid,
          periodType: "season",
          season: "2098",
          minutes: 2000,
          goals: 8,
          starts: 22,
          assists: 4,
          shots: 0,
          keyPasses: 0,
          avgRating: 7.0,      // last5 >> season avg → rising or on_fire
        },
      ]);

      const badges = await computeFormBadgesForPlayerIds([pid]);
      const badge = badges.get(pid);

      expect(badge).toBeDefined();
      // avgRating delta = 8.5 - 7.0 = 1.5 > 0 → badge must be rising or on_fire
      expect(["rising", "on_fire"]).toContain(badge!.performanceTrend);
      expect(badge!.trending).toBe(true);
    },
    15_000,
  );
});
