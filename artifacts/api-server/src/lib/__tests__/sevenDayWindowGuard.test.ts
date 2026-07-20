/**
 * Regression guard: confirms the 7-day date boundary on both
 *   GET /api/dashboard  → topPerformers          (avg rating, last 7 days)
 *   GET /api/rankings   → bestWeekendPerformances (single game, last 7 days)
 *
 * ## Strategy
 * Player A has two match logs:
 *   day-6  (inside window,  rating = 9.9) — must appear
 *   day-8  (outside window, rating = 9.9) — must be excluded
 * …and a last5 player_stats row so the dashboard profile-lookup step succeeds.
 *
 * Player B has only a day-8 match log (outside window) and its own last5 row.
 * They must never appear in topPerformers or bestWeekendPerformances.
 *
 * Using rating = 9.9 (near-maximum) ensures both players rank at the top of
 * any concurrent real data, making the "must appear" assertions reliable.
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

// ── Date helpers ──────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ── Cleanup state ──────────────────────────────────────────────────────────────

let clubId: number | null = null;
let playerAId: number | null = null;
let playerBId: number | null = null;
let logInsideId: number | null = null;   // player A, day-6 (inside window)
let logOutsideAId: number | null = null; // player A, day-8 (outside window)
let logOutsideBId: number | null = null; // player B, day-8 (outside window)

afterAll(async () => {
  const logIds = [logInsideId, logOutsideAId, logOutsideBId].filter(
    (id): id is number => id !== null,
  );
  if (logIds.length > 0) {
    await db.delete(matchLogsTable).where(inArray(matchLogsTable.id, logIds));
  }
  for (const pid of [playerAId, playerBId]) {
    if (pid !== null) {
      await db.delete(playerStatsTable).where(eq(playerStatsTable.playerId, pid));
      await db.delete(playersTable).where(eq(playersTable.id, pid));
    }
  }
  if (clubId !== null) {
    await db.delete(clubsTable).where(eq(clubsTable.id, clubId));
  }
});

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Club
  const [club] = await db
    .insert(clubsTable)
    .values({ name: "__7d-guard-club__", league: "Test League", country: "Test" })
    .returning({ id: clubsTable.id });
  clubId = club!.id;

  // Player A — has logs both inside and outside the 7-day window
  const [playerA] = await db
    .insert(playersTable)
    .values({
      name: "__7d-guard-player-A__",
      slug: "__7d-guard-player-a__",
      position: "MF",
      category: "prospect",
      clubId: clubId!,
      age: 22,
      nationalTeamCaps: 0,
      nationalTeamGoals: 0,
      worldCupRoster: false,
    })
    .returning({ id: playersTable.id });
  playerAId = playerA!.id;

  // Player B — only has a log outside the 7-day window
  const [playerB] = await db
    .insert(playersTable)
    .values({
      name: "__7d-guard-player-B__",
      slug: "__7d-guard-player-b__",
      position: "FW",
      category: "prospect",
      clubId: clubId!,
      age: 21,
      nationalTeamCaps: 0,
      nationalTeamGoals: 0,
      worldCupRoster: false,
    })
    .returning({ id: playersTable.id });
  playerBId = playerB!.id;

  // Player A: inside-window log (day-6, rating 9.9)
  const [logInside] = await db
    .insert(matchLogsTable)
    .values({
      playerId: playerAId!,
      date: daysAgo(6),
      opponent: "__7d-guard-inside__",
      competition: "__7d-guard-comp__",
      result: "W",
      minutes: 90,
      goals: 1,
      assists: 0,
      rating: 9.9,
    })
    .returning({ id: matchLogsTable.id });
  logInsideId = logInside!.id;

  // Player A: outside-window log (day-8, same high rating to catch filter removal)
  const [logOutsideA] = await db
    .insert(matchLogsTable)
    .values({
      playerId: playerAId!,
      date: daysAgo(8),
      opponent: "__7d-guard-outside-a__",
      competition: "__7d-guard-comp__",
      result: "W",
      minutes: 90,
      goals: 1,
      assists: 0,
      rating: 9.9,
    })
    .returning({ id: matchLogsTable.id });
  logOutsideAId = logOutsideA!.id;

  // Player B: only an outside-window log (day-8)
  const [logOutsideB] = await db
    .insert(matchLogsTable)
    .values({
      playerId: playerBId!,
      date: daysAgo(8),
      opponent: "__7d-guard-outside-b__",
      competition: "__7d-guard-comp__",
      result: "W",
      minutes: 90,
      goals: 2,
      assists: 0,
      rating: 9.9,
    })
    .returning({ id: matchLogsTable.id });
  logOutsideBId = logOutsideB!.id;

  // last5 player_stats rows so the topPerformers profile-lookup step succeeds
  await db.insert(playerStatsTable).values([
    { playerId: playerAId!, periodType: "last5", season: "1900", minutes: 90,  avgRating: 9.9 },
    { playerId: playerBId!, periodType: "last5", season: "1900", minutes: 90,  avgRating: 9.9 },
  ]);
}, 30_000);

// ── Dashboard: topPerformers ──────────────────────────────────────────────────

describe("GET /api/dashboard — topPerformers 7-day window", () => {
  it(
    "includes player A whose only in-window log is from day-6",
    async () => {
      const res = await request(app).get("/api/dashboard").expect(200);
      const parsed = GetDashboardResponse.parse(res.body);
      const ids = parsed.topPerformers.map((p) => p.id);
      expect(
        ids,
        `player A (id=${playerAId}) must appear in topPerformers — has a day-6 rated log`,
      ).toContain(playerAId);
    },
    30_000,
  );

  it(
    "excludes player B whose only log is from day-8 (outside window)",
    async () => {
      const res = await request(app).get("/api/dashboard").expect(200);
      const parsed = GetDashboardResponse.parse(res.body);
      const ids = parsed.topPerformers.map((p) => p.id);
      expect(
        ids,
        `player B (id=${playerBId}) must NOT appear in topPerformers — only log is day-8`,
      ).not.toContain(playerBId);
    },
    30_000,
  );
});

// ── Rankings: bestWeekendPerformances ─────────────────────────────────────────

describe("GET /api/rankings — bestWeekendPerformances 7-day window", () => {
  it(
    "includes the day-6 log but not the day-8 log for player A",
    async () => {
      const res = await request(app).get("/api/rankings").expect(200);
      const parsed = GetRankingsResponse.parse(res.body);
      const returnedIds = parsed.bestWeekendPerformances.map((m) => m.id);
      expect(
        returnedIds,
        `day-6 log (id=${logInsideId}) must appear in bestWeekendPerformances`,
      ).toContain(logInsideId);
      expect(
        returnedIds,
        `day-8 log for player A (id=${logOutsideAId}) must NOT appear`,
      ).not.toContain(logOutsideAId);
    },
    30_000,
  );

  it(
    "excludes the day-8 log for player B (only log is outside the window)",
    async () => {
      const res = await request(app).get("/api/rankings").expect(200);
      const parsed = GetRankingsResponse.parse(res.body);
      const returnedIds = parsed.bestWeekendPerformances.map((m) => m.id);
      expect(
        returnedIds,
        `day-8 log for player B (id=${logOutsideBId}) must NOT appear`,
      ).not.toContain(logOutsideBId);
    },
    30_000,
  );
});
