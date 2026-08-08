/**
 * Prompt 11-FIX — Rankings season-year resolver tests
 *
 * The resolver must pick the candidate year with the MOST distinct players
 * holding a season_all row, not blindly take seasonYearCandidates()[0]
 * (which equals getUTCFullYear() and is wrong during January for European
 * leagues whose season year doesn't roll over on 1 Jan).
 *
 * All tests use far-future year ranges (2052–2074, 2099) to avoid any
 * interference with real production data in 2024/2025.  The pattern is
 * identical to the real defect:
 *   "2073" stands for "the current football season" (labelled by the year it
 *   started, which is the prior calendar year in January).
 *   "2074" stands for "the new calendar year" (January — no data yet).
 *
 * SEEDING LAYOUT
 * ─────────────────────────────────────────────────────────────
 * p2073Ids  : 5  players × season_all "2073"  (Tests 1, 5, 6)
 * p2062Ids  : 10 players × season_all "2062"  (Test 2)
 * p2053Ids  :  5 players × season_all "2053"  (Tests 3a, 3b)
 * p2052Ids  : 10 players × season_all "2052"  (Tests 3a, 3b)
 * p2053ExtraIds: 15 players × season_all "2053"  (seeded inside Test 3b)
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { db, playersTable, playerStatsTable, clubsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ── Seeded IDs ──────────────────────────────────────────────────────────────

let testClubId: number;
const p2073Ids: number[] = [];        // Tests 1, 5, 6
const p2062Ids: number[] = [];        // Test 2
const p2053Ids: number[] = [];        // Tests 3a, 3b (minority year before flip)
const p2052Ids: number[] = [];        // Tests 3a, 3b (majority year before flip)
const p2053ExtraIds: number[] = [];   // seeded inside Test 3b

// ── Seed helper ──────────────────────────────────────────────────────────────

async function seedOne(label: string, year: string): Promise<number> {
  const [player] = await db.insert(playersTable).values({
    name: `__SYR__ ${label}`,
    slug: `syr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    position: "MID",
    category: "prospect",
    clubId: testClubId,
    age: 22,
  }).returning();
  await db.insert(playerStatsTable).values({
    playerId: player.id,
    periodType: "season_all",
    season: year,
    minutes: 1000,
    goals: 5,
    starts: 10,
    assists: 2,
    shots: 0,
    keyPasses: 0,
    tackles: 0,
    interceptions: 0,
  });
  return player.id;
}

// ── Global setup / teardown ──────────────────────────────────────────────────

beforeAll(async () => {
  const [club] = await db.insert(clubsTable)
    .values({ name: "__SYR__ Test Club", league: "SYR League", country: "US" })
    .returning();
  testClubId = club.id;

  for (let i = 0; i < 5;  i++) p2073Ids.push(await seedOne(`2073-${i}`, "2073"));
  for (let i = 0; i < 10; i++) p2062Ids.push(await seedOne(`2062-${i}`, "2062"));
  for (let i = 0; i < 5;  i++) p2053Ids.push(await seedOne(`2053-${i}`, "2053"));
  for (let i = 0; i < 10; i++) p2052Ids.push(await seedOne(`2052-${i}`, "2052"));
}, 60_000);

afterAll(async () => {
  const allIds = [...p2073Ids, ...p2062Ids, ...p2053Ids, ...p2052Ids, ...p2053ExtraIds];
  for (const pid of allIds) {
    await db.delete(playerStatsTable).where(eq(playerStatsTable.playerId, pid));
    await db.delete(playersTable).where(eq(playersTable.id, pid));
  }
  if (testClubId) await db.delete(clubsTable).where(eq(clubsTable.id, testClubId));
}, 30_000);

// Restore real clock after each test — never let fake timers leak.
afterEach(() => { vi.useRealTimers(); });

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Rankings — season-year resolver (Prompt 11-FIX)", () => {

  it(
    // ── Test 1: THE JANUARY TIME BOMB ─────────────────────────────────────────
    // Clock is 2074-01-15. seasonYearCandidates() returns [2074, 2073, 2072].
    // We seeded season_all rows for "2073" only.
    // BEFORE fix: candidates[0] = "2074" → WHERE season='2074' → 0 rows.
    // AFTER fix:  resolver counts players per year, picks "2073" (5 > 0 > 0).
    "Test 1 (January time bomb): clock=2074-01-15, data in '2073' only → resolver picks '2073', NOT calendar year '2074'",
    async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2074-01-15T12:00:00.000Z"));
      // Must FAIL before fix (seasonYear='2074', mostMinutes empty)
      // Must PASS after fix  (seasonYear='2073', mostMinutes has our 5 players)
      const res = await request(app).get("/api/rankings").expect(200);
      expect(res.body.seasonYear).toBe("2073");
      const anyIn2073 = res.body.mostMinutes.some(
        (p: { id: number }) => p2073Ids.includes(p.id),
      );
      expect(anyIn2073).toBe(true);
    },
    30_000,
  );

  it(
    // ── Test 2: THE TODAY (US PRE-SEASON) CASE ────────────────────────────────
    // Clock is 2063-08-08. candidates = [2063, 2062, 2061].
    // All 10 seeded players are in "2062". None in "2063" or "2061".
    // BEFORE fix: picks "2063" → 0 results.
    // AFTER fix:  picks "2062" (10 players).
    "Test 2 (today case): clock=2063-08-08, data in '2062' for 10 players, none in '2063' → resolver picks '2062'",
    async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2063-08-08T12:00:00.000Z"));
      const res = await request(app).get("/api/rankings").expect(200);
      expect(res.body.seasonYear).toBe("2062");
      const anyIn2062 = res.body.mostMinutes.some(
        (p: { id: number }) => p2062Ids.includes(p.id),
      );
      expect(anyIn2062).toBe(true);
    },
    30_000,
  );

  it(
    // ── Test 3a: SEASON TRANSITION — older year still ahead ──────────────────
    // Clock 2054-08-08, candidates = [2054, 2053, 2052].
    // "2052" has 10 players, "2053" has 5, "2054" has 0.
    // → resolver picks "2052" (10 > 5 > 0).
    "Test 3a (season transition, older year ahead): 10×'2052' vs 5×'2053' → resolver picks '2052'",
    async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2054-08-08T12:00:00.000Z"));
      const res = await request(app).get("/api/rankings").expect(200);
      expect(res.body.seasonYear).toBe("2052");
    },
    30_000,
  );

  it(
    // ── Test 3b: SEASON TRANSITION — newer year flips ahead ──────────────────
    // Seed 15 more "2053" players (now 20 total for "2053" vs 10 for "2052").
    // Same clock 2054-08-08 → resolver must flip to "2053".
    "Test 3b (season transition, newer year flips): after adding 15 more '2053' players (20 total > 10) → resolver flips to '2053'",
    async () => {
      for (let i = 0; i < 15; i++) {
        p2053ExtraIds.push(await seedOne(`2053-extra-${i}`, "2053"));
      }
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2054-08-08T12:00:00.000Z"));
      const res = await request(app).get("/api/rankings").expect(200);
      expect(res.body.seasonYear).toBe("2053");
    },
    30_000,
  );

  it(
    // ── Test 4: EMPTY FALLBACK ────────────────────────────────────────────────
    // Clock 2099-06-01, candidates = [2099, 2098, 2097].
    // No player_stats rows exist for any of these years.
    // Must return 200 with empty leaderboards and fall back to "2099" (most
    // recent candidate) — must NOT throw or return 500.
    "Test 4 (empty fallback): no season_all rows for any candidate year → 200 with empty leaderboards, seasonYear=most-recent candidate",
    async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2099-06-01T12:00:00.000Z"));
      const res = await request(app).get("/api/rankings").expect(200);
      // Falls back to the most-recent candidate ("2099")
      expect(res.body.seasonYear).toBe("2099");
      expect(Array.isArray(res.body.mostMinutes)).toBe(true);
      expect(Array.isArray(res.body.mostGoalContributions)).toBe(true);
      // Our seeded players are in years 2052–2073; none should appear here
      const allSeededIds = [...p2073Ids, ...p2062Ids, ...p2053Ids, ...p2052Ids, ...p2053ExtraIds];
      const spuriousMinutes = res.body.mostMinutes.some(
        (p: { id: number }) => allSeededIds.includes(p.id),
      );
      expect(spuriousMinutes).toBe(false);
    },
    30_000,
  );

  it(
    // ── Test 5: SINGLE RESOLUTION ────────────────────────────────────────────
    // After Test 3b: p2073Ids=5 players in "2073".
    // Clock 2074-01-15, candidates = [2074, 2073, 2072].
    // Resolver picks "2073" and must reuse that result for BOTH mostMinutes
    // and mostGoalContributions — if it resolved independently per leaderboard
    // and the results could diverge, they wouldn't both contain our "2073"
    // players while agreeing on seasonYear="2073".
    "Test 5 (single resolution): seasonYear, mostMinutes, and mostGoalContributions all agree on the same resolved year",
    async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2074-01-15T12:00:00.000Z"));
      const res = await request(app).get("/api/rankings").expect(200);
      expect(res.body.seasonYear).toBe("2073");
      const minutesHas2073 = res.body.mostMinutes.some(
        (p: { id: number }) => p2073Ids.includes(p.id),
      );
      const goalContribsHas2073 = res.body.mostGoalContributions.some(
        (p: { id: number }) => p2073Ids.includes(p.id),
      );
      expect(minutesHas2073).toBe(true);
      expect(goalContribsHas2073).toBe(true);
    },
    30_000,
  );

  it(
    // ── Test 6: seasonYear FIELD MATCHES RESOLVED YEAR ───────────────────────
    // The seasonYear response field must equal the year the leaderboard data
    // actually comes from — the UI label and the ranked data cannot disagree.
    // Clock 2074-01-15, "2073" data only → both must say "2073".
    "Test 6 (seasonYear field matches resolved year): response.seasonYear equals the year both leaderboards draw from",
    async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2074-01-15T12:00:00.000Z"));
      const res = await request(app).get("/api/rankings").expect(200);
      expect(res.body.seasonYear).toBe("2073");
      // Both leaderboards must contain players from the declared year
      expect(res.body.mostMinutes.some(
        (p: { id: number }) => p2073Ids.includes(p.id),
      )).toBe(true);
      expect(res.body.mostGoalContributions.some(
        (p: { id: number }) => p2073Ids.includes(p.id),
      )).toBe(true);
    },
    30_000,
  );

});
