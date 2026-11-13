/** Legacy null-league compatibility: keep the data-driven shared-year
 * selection, but no longer expose one misleading seasonYear in the API.
 * All controlled rows are temporary and every transaction is rolled back. */
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import { db, clubsTable, playersTable, playerStatsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import rankingsRouter from "../../routes/rankings";

const context = vi.hoisted(() => ({ transaction: null as unknown }));
vi.mock("@workspace/db", async (original) => {
  const actual = await original<typeof import("@workspace/db")>();
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
}).use("/api", rankingsRouter);
afterEach(() => vi.useRealTimers());

async function rankings(groups: [string, number][], instant = "2099-08-08T12:00:00Z") {
  const rollback = new Error("rollback legacy rankings");
  let result: { mostMinutes: { id: number }[]; mostGoalContributions: { id: number }[]; seasonYear?: string } | undefined;
  const ids = new Map<string, number[]>();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(instant));
  try {
    await db.transaction(async (tx) => {
      context.transaction = tx;
      await tx.execute(sql`CREATE TEMP TABLE league_seasons (LIKE public.league_seasons INCLUDING ALL) ON COMMIT DROP`);
      await tx.execute(sql`CREATE TEMP TABLE player_stats (LIKE public.player_stats INCLUDING ALL) ON COMMIT DROP`);
      await tx.execute(sql`CREATE TEMP TABLE players (LIKE public.players INCLUDING ALL) ON COMMIT DROP`);
      await tx.execute(sql`CREATE TEMP TABLE clubs (LIKE public.clubs INCLUDING ALL) ON COMMIT DROP`);
      const [club] = await tx.insert(clubsTable).values({ name: "Legacy season", league: "Test", country: "US" }).returning();
      for (const [season, count] of groups) {
        const group = ids.get(season) ?? [];
        for (let i = 0; i < count; i++) {
          const [player] = await tx.insert(playersTable).values({
            name: `Legacy ${season} ${group.length}`, slug: `legacy-${season}-${group.length}`,
            clubId: club.id, age: 22, position: "MID", category: "prospect",
          }).returning();
          group.push(player.id);
          await tx.insert(playerStatsTable).values({ playerId: player.id, periodType: "season_all", season, minutes: 1000, goals: 5, assists: 2 });
        }
        ids.set(season, group);
      }
      result = (await request(app).get("/api/rankings").expect(200)).body;
      throw rollback;
    });
  } catch (err) {
    if (err !== rollback) throw err;
  } finally {
    context.transaction = null;
  }
  return { body: result!, ids };
}

describe("B6 Rankings — legacy null-league shared-year resolver", () => {
  it("January selects prior-year data, not the empty calendar year", async () => {
    const { body, ids } = await rankings([["2098", 5]], "2099-01-15T12:00:00Z");
    expect(body.mostMinutes.map((p) => p.id)).toEqual(expect.arrayContaining(ids.get("2098")!));
  }, 30000);
  it("August still selects the prior year when no new-year data exists", async () => {
    const { body, ids } = await rankings([["2098", 10]]);
    expect(body.mostMinutes.every((p) => ids.get("2098")!.includes(p.id))).toBe(true);
    expect(body.mostMinutes).toHaveLength(8);
  }, 30000);
  it("the older year wins when more players have data there", async () => {
    const { body, ids } = await rankings([["2098", 5], ["2097", 10]]);
    expect(body.mostMinutes).toHaveLength(8);
    expect(body.mostMinutes.every((p) => ids.get("2097")!.includes(p.id))).toBe(true);
  }, 30000);
  it("the newer year wins once it has more players", async () => {
    const { body, ids } = await rankings([["2098", 5], ["2097", 10], ["2098", 15]]);
    expect(body.mostMinutes).toHaveLength(8);
    expect(body.mostMinutes.every((p) => ids.get("2098")!.includes(p.id))).toBe(true);
  }, 30000);
  it("no candidate data returns empty leaderboards", async () => {
    const { body } = await rankings([]);
    expect(body.mostMinutes).toEqual([]);
    expect(body.mostGoalContributions).toEqual([]);
  }, 30000);
  it("both leaderboards reuse the same resolved legacy year", async () => {
    const { body, ids } = await rankings([["2098", 5]], "2099-01-15T12:00:00Z");
    expect(body.mostMinutes.map((p) => p.id)).toEqual(expect.arrayContaining(ids.get("2098")!));
    expect(body.mostGoalContributions.map((p) => p.id)).toEqual(expect.arrayContaining(ids.get("2098")!));
  }, 30000);
  it("the response does not advertise one shared seasonYear", async () => {
    const { body } = await rankings([["2098", 5]]);
    expect(body).not.toHaveProperty("seasonYear");
    expect(body.mostMinutes).toHaveLength(5);
    expect(body.mostGoalContributions).toHaveLength(5);
  }, 30000);
});
