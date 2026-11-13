import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { db, leagueSeasonsTable, playerStatsTable, playersTable, clubsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { leagueSeasons } from "../../dataMigrations/0002_league_seasons";
import { DATA_MIGRATIONS } from "../../dataMigrations";
import rankingsRouter from "../../routes/rankings";
import playersRouter from "../../routes/players";

const context = vi.hoisted(() => ({ transaction: null as unknown }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: new Proxy(actual.db, {
    get(target, property) {
      const source = (context.transaction ?? target) as typeof actual.db;
      const value = Reflect.get(source, property);
      return typeof value === "function" ? value.bind(source) : value;
    },
  }) };
});
const app = express().use((req, _res, next) => {
  req.log = { info: vi.fn(), warn: vi.fn() } as unknown as typeof req.log;
  next();
}).use("/api", rankingsRouter, playersRouter);
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function isolated(run: (tx: Tx) => Promise<void>) {
  const rollback = new Error("rollback season test");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2099-03-15T12:00:00Z"));
  try {
    await db.transaction(async (tx) => {
      context.transaction = tx;
      await tx.execute(sql`CREATE TEMP TABLE league_seasons (LIKE public.league_seasons INCLUDING ALL) ON COMMIT DROP`);
      await tx.execute(sql`CREATE TEMP TABLE player_stats (LIKE public.player_stats INCLUDING ALL) ON COMMIT DROP`);
      await tx.execute(sql`CREATE TEMP TABLE players (LIKE public.players INCLUDING ALL) ON COMMIT DROP`);
      await tx.execute(sql`CREATE TEMP TABLE clubs (LIKE public.clubs INCLUDING ALL) ON COMMIT DROP`);
      await run(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    context.transaction = null;
  }
}
afterEach(() => vi.useRealTimers());

describe("Group A — league seasons database integration", () => {
  it("A5 migration inserts exactly 44 rows, skips duplicates, and is registered after baseline", async () => {
    await isolated(async (tx) => {
      await leagueSeasons.run(tx);
      const first = await tx.select().from(leagueSeasonsTable);
      expect(first).toHaveLength(44);
      await leagueSeasons.run(tx);
      expect(await tx.select().from(leagueSeasonsTable)).toHaveLength(44);
      for (const [leagueId, apiSeason, startDate, displayLabel] of [
        [253, 2026, "2026-02-21", "2026"],
        [262, 2025, "2025-07-12", "2025/2026"],
        [179, 2026, "2026-07-31", "2026/2027"],
      ] as const) {
        expect(first).toContainEqual(expect.objectContaining({ apiFootballLeagueId: leagueId, apiSeason, startDate, displayLabel }));
      }
      expect(DATA_MIGRATIONS.map((m) => m.id)).toEqual(["0001_baseline", "0002_league_seasons"]);
    });
  }, 30000);

  it("A7 ranks each league's started season, excludes stale season rows, and uses matching all-club totals", async () => {
    await isolated(async (tx) => {
      await tx.insert(leagueSeasonsTable).values([
        { apiFootballLeagueId: 39, leagueName: "Premier League", apiSeason: 2098, displayLabel: "2098/2099", startDate: "2098-08-15" },
        { apiFootballLeagueId: 39, leagueName: "Premier League", apiSeason: 2099, displayLabel: "2099/2100", startDate: "2099-08-15" },
        { apiFootballLeagueId: 253, leagueName: "MLS", apiSeason: 2099, displayLabel: "2099", startDate: "2099-02-20" },
      ]);
      const [club] = await tx.insert(clubsTable).values({ name: "Season test", league: "Test", country: "US" }).returning();
      const ids: number[] = [];
      for (const [i, leagueId, season, minutes] of [[0, 39, "2098", 1000], [1, 39, "2098", 800], [2, 253, "2099", 900], [3, 39, "2097", 9000]] as const) {
        const [player] = await tx.insert(playersTable).values({ name: `Season ${i}`, slug: `season-${i}`, clubId: club.id, age: 23, position: "MID", category: "prospect" }).returning();
        ids.push(player.id);
        await tx.insert(playerStatsTable).values([
          { playerId: player.id, periodType: "season", season, apiFootballLeagueId: leagueId, minutes: 1, goals: 0 },
          { playerId: player.id, periodType: "season_all", season, apiFootballLeagueId: leagueId, minutes, goals: minutes },
        ]);
        if (leagueId === 253) await tx.insert(playerStatsTable).values({ playerId: player.id, periodType: "season_all", season: "2098", apiFootballLeagueId: leagueId, minutes: 5000, goals: 5000 });
      }
      const response = await request(app).get("/api/rankings").expect(200);
      expect(response.body.mostMinutes.map((p: { id: number }) => p.id)).toEqual([ids[0], ids[2], ids[1]]);
      expect(response.body.mostGoalContributions.map((p: { id: number }) => p.id)).toEqual([ids[0], ids[2], ids[1]]);
    });
  }, 30000);

  it("A8 rankings response omits seasonYear", async () => {
    await isolated(async () => {
      const response = await request(app).get("/api/rankings").expect(200);
      expect(response.body).not.toHaveProperty("seasonYear");
    });
  }, 30000);

  it("A9 profile exposes calendar labels and defaults to the selected current-club season, not early qualifier history", async () => {
    await isolated(async (tx) => {
      await tx.insert(leagueSeasonsTable).values({ apiFootballLeagueId: 253, leagueName: "MLS", apiSeason: 2099, displayLabel: "2099", startDate: "2099-02-20" });
      const [club] = await tx.insert(clubsTable).values({ name: "Profile season", league: "MLS", country: "US" }).returning();
      const [player] = await tx.insert(playersTable).values({ name: "Profile", slug: "profile-season", clubId: club.id, age: 23, position: "MID", category: "prospect" }).returning();
      await tx.insert(playerStatsTable).values([
        { playerId: player.id, periodType: "season", season: "2098", apiFootballLeagueId: 253 },
        { playerId: player.id, periodType: "season_all", season: "2098", apiFootballLeagueId: 253 },
        { playerId: player.id, periodType: "season_all", season: "2099", apiFootballLeagueId: 253 },
      ]);
      const response = await request(app).get(`/api/players/${player.id}`).expect(200);
      expect(response.body.availableClubSeasons).toEqual([{ season: "2099", label: "2099" }, { season: "2098", label: "2098" }]);
      expect(response.body.clubSeasonStats.season).toBe("2098");
      const explicit = await request(app).get(`/api/players/${player.id}?season=2099`).expect(200);
      expect(explicit.body.clubSeasonStats.season).toBe("2099");
    });
  }, 30000);
});
