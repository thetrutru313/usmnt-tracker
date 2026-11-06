/**
 * Minutes rules for the weekly performance lists:
 *   GET /api/dashboard → topPerformers: minutes-weighted 7-day average rating,
 *     at least TOP_PERFORMER_MIN_MINUTES (60) rated minutes, with weekRating
 *     and weekMinutes on each row.
 *   GET /api/rankings  → bestWeekendPerformances: a single game must be at
 *     least BEST_PERFORMANCE_MIN_MINUTES (45) long.
 *
 * ## Players (all logs inside the 7-day window)
 *   heavy  — 9.9 in 90 min + 8.0 in 60 min → weighted 9.14, plain avg 8.95
 *   single — 9.0 in exactly 60 min         → 9.00 (also the 60-minute boundary)
 *   cameo  — 9.95 in 13 min                → under the 60-minute floor
 *   ranker — 9.97 in 44 min + 9.96 in 45 min (rankings 45-minute boundary)
 *
 * Ratings are near the maximum so these players rank above any real data.
 * sevenDayWindowGuard.test.ts may run at the same time and adds one more
 * 9.9-rated player; the dashboard list of 5 still has room for both files.
 *
 * ## Cleanup
 * All inserted rows are removed in afterAll in reverse-FK order.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import {
  db,
  clubsTable,
  playersTable,
  matchLogsTable,
  playerStatsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { GetDashboardResponse, GetRankingsResponse } from "@workspace/api-zod";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

let clubId: number | null = null;
const ids: Record<"heavy" | "single" | "cameo" | "ranker", number | null> = {
  heavy: null, single: null, cameo: null, ranker: null,
};
const logIds: number[] = [];
let ranker44LogId: number | null = null;
let ranker45LogId: number | null = null;

afterAll(async () => {
  if (logIds.length > 0) {
    await db.delete(matchLogsTable).where(inArray(matchLogsTable.id, logIds));
  }
  for (const pid of Object.values(ids)) {
    if (pid !== null) {
      await db.delete(playerStatsTable).where(eq(playerStatsTable.playerId, pid));
      await db.delete(playersTable).where(eq(playersTable.id, pid));
    }
  }
  if (clubId !== null) {
    await db.delete(clubsTable).where(eq(clubsTable.id, clubId));
  }
});

async function addPlayer(key: keyof typeof ids): Promise<number> {
  const [row] = await db
    .insert(playersTable)
    .values({
      name: `__min-floor-${key}__`,
      slug: `__min-floor-${key}__`,
      position: "MF",
      category: "prospect",
      clubId: clubId!,
      age: 22,
      nationalTeamCaps: 0,
      nationalTeamGoals: 0,
      worldCupRoster: false,
    })
    .returning({ id: playersTable.id });
  ids[key] = row!.id;
  return row!.id;
}

async function addLog(playerId: number, day: number, minutes: number, rating: number): Promise<number> {
  const [row] = await db
    .insert(matchLogsTable)
    .values({
      playerId,
      date: daysAgo(day),
      opponent: "__min-floor-opp__",
      competition: "__min-floor-comp__",
      result: "W",
      minutes,
      goals: 0,
      assists: 0,
      rating,
    })
    .returning({ id: matchLogsTable.id });
  logIds.push(row!.id);
  return row!.id;
}

beforeAll(async () => {
  const [club] = await db
    .insert(clubsTable)
    .values({ name: "__min-floor-club__", league: "Test League", country: "Test" })
    .returning({ id: clubsTable.id });
  clubId = club!.id;

  const heavy = await addPlayer("heavy");
  const single = await addPlayer("single");
  const cameo = await addPlayer("cameo");
  const ranker = await addPlayer("ranker");

  await addLog(heavy, 5, 90, 9.9);
  await addLog(heavy, 2, 60, 8.0);
  await addLog(single, 3, 60, 9.0);
  await addLog(cameo, 4, 13, 9.95);
  ranker44LogId = await addLog(ranker, 4, 44, 9.97);
  ranker45LogId = await addLog(ranker, 2, 45, 9.96);

  // last5 rows so the dashboard profile lookup finds these players.
  await db.insert(playerStatsTable).values(
    [heavy, single, cameo, ranker].map((playerId) => ({
      playerId, periodType: "last5", season: "1900", minutes: 90, avgRating: 7.0,
    })),
  );
}, 30_000);

async function topPerformers() {
  const res = await request(app).get("/api/dashboard").expect(200);
  return GetDashboardResponse.parse(res.body).topPerformers;
}

describe("GET /api/dashboard — topPerformers minutes rules", () => {
  it("1: excludes a player whose only game this week is a 13-minute cameo", async () => {
    const list = await topPerformers();
    expect(list.map((p) => p.id)).not.toContain(ids.cameo);
  }, 30_000);

  it("2: ranks by minutes-weighted average (9.14 above 9.00, though the plain average is 8.95)", async () => {
    const list = await topPerformers().then((l) => l.map((p) => p.id));
    expect(list).toContain(ids.heavy);
    expect(list).toContain(ids.single);
    expect(list.indexOf(ids.heavy!)).toBeLessThan(list.indexOf(ids.single!));
  }, 30_000);

  it("3: returns the week's weighted rating and rated minutes", async () => {
    const heavy = (await topPerformers()).find((p) => p.id === ids.heavy);
    expect(heavy).toBeDefined();
    expect(heavy!.weekRating).toBeCloseTo(9.14, 2);
    expect(heavy!.weekMinutes).toBe(150);
  }, 30_000);

  // Reads the raw body (no weekRating parse) so it passes before and after.
  it("4 guard: a player with exactly 60 minutes is included", async () => {
    const res = await request(app).get("/api/dashboard").expect(200);
    const list = (res.body.topPerformers as { id: number }[]).map((p) => p.id);
    expect(list).toContain(ids.single);
  }, 30_000);
});

describe("GET /api/rankings — bestWeekendPerformances minutes rule", () => {
  it("5: excludes a 44-minute game", async () => {
    const res = await request(app).get("/api/rankings").expect(200);
    const logs = GetRankingsResponse.parse(res.body).bestWeekendPerformances.map((m) => m.id);
    expect(logs).not.toContain(ranker44LogId);
  }, 30_000);

  it("6 guard: includes a 45-minute game", async () => {
    const res = await request(app).get("/api/rankings").expect(200);
    const logs = GetRankingsResponse.parse(res.body).bestWeekendPerformances.map((m) => m.id);
    expect(logs).toContain(ranker45LogId);
  }, 30_000);
});
