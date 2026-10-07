import { describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import request from "supertest";
import { db, fixturesTable, scheduleEventsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import app from "../../app.js";

const clock = vi.hoisted(() => ({
  transaction: null as unknown,
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: new Proxy(actual.db, {
      get(target, property) {
        const source = (clock.transaction ?? target) as typeof actual.db;
        const value = Reflect.get(source, property);
        return typeof value === "function" ? value.bind(source) : value;
      },
    }),
  };
});
// The hero uses PostgreSQL NOW(), not JS Date. Pin that SQL clock as well as
// JS Date, without changing the live query or removing its expiry predicate.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  const pinnedSql = (parts: TemplateStringsArray, ...values: unknown[]) => {
    const strings = parts.map((part) =>
      part.replaceAll("NOW()", "'2026-10-07 12:00:00+00'::timestamptz"));
    return actual.sql(Object.assign(strings, { raw: strings }), ...values);
  };
  return { ...actual, sql: Object.assign(pinnedSql, actual.sql) };
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Match = {
  sentinelId: number; homeTeam: string; awayTeam: string;
  competition: string; kickoffTimeTbd: boolean;
};

async function startupSeed(tx: Tx): Promise<Match[]> {
  // Execute the actual entry-point block, not a copied approximation of its SQL.
  const source = await readFile(new URL("../../index.ts", import.meta.url), "utf8");
  const start = source.indexOf("    type MatchDef =");
  const end = source.indexOf("  } catch (err)", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const block = source.slice(start, end);
  const { code } = await transform(
    `async function seed(db, sql, logger) { ${block}\n return matches; }`,
    { loader: "ts", target: "es2022" },
  );
  const run = new Function(`${code}; return seed;`)() as (
    tx: Tx, sqlTag: typeof sql, logger: { info: () => void },
  ) => Promise<Match[]>;
  return run(tx, sql, { info: () => {} });
}

async function seededSandbox(check: (tx: Tx) => Promise<void>) {
  const rollback = new Error("intentional November test rollback");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
  try {
    await db.transaction(async (tx) => {
      clock.transaction = tx;
      // Temp shadows isolate real startup cleanup and route queries from all
      // development fixtures/events. No production data or public rows change.
      await tx.execute(sql`CREATE TEMP TABLE fixtures (LIKE public.fixtures INCLUDING ALL) ON COMMIT DROP`);
      await tx.execute(sql`CREATE TEMP TABLE fixture_players (LIKE public.fixture_players INCLUDING ALL) ON COMMIT DROP`);
      await tx.execute(sql`CREATE TEMP TABLE schedule_events (LIKE public.schedule_events INCLUDING ALL) ON COMMIT DROP`);
      const source = await readFile(new URL("../../../../../lib/db/src/seeds/scheduleEvents.ts", import.meta.url), "utf8");
      const data = source.slice(source.indexOf("const events"), source.indexOf("async function seed()"));
      const { code } = await transform(`${data}\n`, { loader: "ts", target: "es2022" });
      const events = new Function(`${code}; return events;`)() as (typeof scheduleEventsTable.$inferInsert)[];
      await tx.insert(scheduleEventsTable).values(events);
      await startupSeed(tx);
      await check(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    clock.transaction = null;
    vi.useRealTimers();
  }
}

describe("November Nations League quarterfinals — real startup and routes", () => {
  it("6/7: startup seeds only Haiti legs, corrects TBD, and is idempotent before/after binding", async () => {
    await seededSandbox(async (tx) => {
      const matches = await startupSeed(tx);
      expect(matches.map((match) => match.sentinelId)).toEqual([-2005, -2006]);
      const rows = await tx.select().from(fixturesTable).orderBy(fixturesTable.kickoff);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        apiFootballFixtureId: -2005, homeTeam: "Haiti", awayTeam: "USA",
        competition: "CONCACAF Nations League", ntLevel: "SENIOR",
        venue: "TBD", city: null, kickoffTimeTbd: true,
        tvNetwork: "TNT", streamingService: "HBO Max",
        homeLogoUrl: "https://media.api-sports.io/football/teams/2386.png",
        awayLogoUrl: "https://media.api-sports.io/football/teams/2384.png",
      });
      expect(rows[0]!.kickoff.toISOString()).toBe("2026-11-15T00:00:00.000Z");
      expect(rows[1]).toMatchObject({
        apiFootballFixtureId: -2006, homeTeam: "USA", awayTeam: "Haiti",
        competition: "CONCACAF Nations League", ntLevel: "SENIOR",
        venue: "TQL Stadium", city: "Cincinnati, OH", kickoffTimeTbd: false,
        tvNetwork: "TNT", streamingService: "HBO Max",
        homeLogoUrl: rows[0]!.awayLogoUrl, awayLogoUrl: rows[0]!.homeLogoUrl,
      });
      expect(rows[1]!.kickoff.toISOString()).toBe("2026-11-18T00:00:00.000Z");
      await tx.update(fixturesTable).set({ kickoffTimeTbd: false }).where(eq(fixturesTable.id, rows[0]!.id));
      await startupSeed(tx);
      expect((await tx.select().from(fixturesTable).where(eq(fixturesTable.id, rows[0]!.id)))[0]!.kickoffTimeTbd).toBe(true);
      await tx.update(fixturesTable).set({ apiFootballFixtureId: 9992005 }).where(eq(fixturesTable.id, rows[0]!.id));
      await startupSeed(tx);
      expect(await tx.select().from(fixturesTable)).toHaveLength(2);
      expect((await tx.select().from(fixturesTable).where(eq(fixturesTable.id, rows[0]!.id)))[0]!.apiFootballFixtureId).toBe(9992005);
    });
  });
  it("8: dashboard chooses November after October expires and returns both legs with TBD", async () => {
    await seededSandbox(async () => {
      const response = await request(app).get("/api/dashboard").expect(200);
      expect(response.body.nextScheduleEvent.slug).toBe("cnl-qf-nov-2026");
      expect(response.body.nextScheduleEvent.fixtures).toHaveLength(2);
      expect(response.body.nextScheduleEvent.fixtures[0]).toMatchObject({
        homeTeam: "Haiti", awayTeam: "USA", kickoffTimeTbd: true,
      });
      expect(response.body.nextScheduleEvent.fixtures[1]).toMatchObject({
        homeTeam: "USA", awayTeam: "Haiti", kickoffTimeTbd: false,
      });
    });
  });
  it("9: schedule has the quarterfinals and neither stale slug", async () => {
    await seededSandbox(async () => {
      const response = await request(app).get("/api/schedule").expect(200);
      expect(response.body.events.map((event: { slug: string }) => event.slug))
        .not.toContain("friendlies-nov-2026");
      expect(response.body.events.map((event: { slug: string }) => event.slug))
        .not.toContain("cnl-qf-2027");
      const event = response.body.events.find((row: { slug: string }) => row.slug === "cnl-qf-nov-2026");
      expect(event.fixtures).toHaveLength(2);
      expect(event.fixtures[0].kickoffTimeTbd).toBe(true);
    });
  });
});
