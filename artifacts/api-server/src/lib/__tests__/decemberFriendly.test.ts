import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import request from "supertest";
import { db, fixturesTable, scheduleEventsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import app from "../../app.js";
import { events } from "../../../../../lib/db/src/seeds/scheduleEventsData";

const sandbox = vi.hoisted(() => ({ transaction: null as unknown }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: new Proxy(actual.db, {
    get(target, property) {
      const source = (sandbox.transaction ?? target) as typeof actual.db;
      const value = Reflect.get(source, property);
      return typeof value === "function" ? value.bind(source) : value;
    },
  }) };
});
// Dashboard expiry is computed in SQL, so pin SQL NOW() as well as JS Date.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  const pinnedSql = (parts: TemplateStringsArray, ...values: unknown[]) => {
    const strings = parts.map(part => part.replaceAll("NOW()", "'2026-11-20 12:00:00+00'::timestamptz"));
    return actual.sql(Object.assign(strings, { raw: strings }), ...values);
  };
  return { ...actual, sql: Object.assign(pinnedSql, actual.sql) };
});
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const expectedEvent = {
  slug: "friendly-dec-2026", name: "December Friendly", kind: "friendly",
  status: "confirmed", startDate: "2026-12-13", endDate: "2026-12-14",
  dateLabel: "Dec 13, 2026", sortOrder: 35,
  description: "A one-off friendly against Jamaica on Sunday, December 13, at Inter Miami CF Stadium in Fort Lauderdale, Florida. The match falls outside a FIFA international window. Kickoff time and broadcast details have not been announced.",
};
const expectedFixture = {
  apiFootballFixtureId: -2007, homeTeam: "USA", awayTeam: "Jamaica",
  homeLogoUrl: "https://media.api-sports.io/football/teams/2384.png",
  awayLogoUrl: "https://media.api-sports.io/football/teams/2385.png",
  competition: "International Friendly", kickoffTimeTbd: true,
  venue: "Inter Miami CF Stadium", city: "Fort Lauderdale, FL",
  tvNetwork: null, streamingService: null,
  isNationalTeam: true, ntLevel: "SENIOR", status: "scheduled",
};

async function startupSeed(tx: Tx) {
  const source = await readFile(new URL("../../index.ts", import.meta.url), "utf8");
  const start = source.indexOf("    type MatchDef =");
  const end = source.indexOf("  } catch (err)", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const { code } = await transform(
    `async function seed(db, sql, logger) { ${source.slice(start, end)}\n return matches; }`,
    { loader: "ts", target: "es2022" },
  );
  const run = new Function(`${code}; return seed;`)() as (
    tx: Tx, sqlTag: typeof sql, logger: { info: () => void },
  ) => Promise<unknown>;
  return run(tx, sql, { info: () => {} });
}

async function isolated(check: (tx: Tx) => Promise<void>) {
  const rollback = new Error("intentional December sandbox rollback");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
  try {
    await db.transaction(async tx => {
      sandbox.transaction = tx;
      for (const name of ["fixtures", "fixture_players", "schedule_events"]) {
        await tx.execute(sql.raw(`CREATE TEMP TABLE ${name} (LIKE public.${name} INCLUDING ALL) ON COMMIT DROP`));
      }
      await tx.insert(scheduleEventsTable).values(events);
      await startupSeed(tx);
      await check(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    sandbox.transaction = null;
    vi.useRealTimers();
  }
}

describe("December Jamaica friendly — actual seed and routes", () => {
  it("contains exactly the specified event data", () => {
    expect(events.find(e => e.slug === expectedEvent.slug)).toEqual(expectedEvent);
    expect(events).toHaveLength(15);
  });
  it("startup inserts -2007 with all values and remains idempotent after binding", async () => {
    await isolated(async tx => {
      const rows = await tx.select().from(fixturesTable).where(eq(fixturesTable.apiFootballFixtureId, -2007));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject(expectedFixture);
      expect(rows[0]!.kickoff.toISOString()).toBe("2026-12-14T00:00:00.000Z");
      await startupSeed(tx);
      expect(await tx.select().from(fixturesTable)).toHaveLength(3);
      await tx.update(fixturesTable).set({ apiFootballFixtureId: 9992007 }).where(eq(fixturesTable.id, rows[0]!.id));
      await startupSeed(tx);
      expect(await tx.select().from(fixturesTable)).toHaveLength(3);
      expect(await tx.select().from(fixturesTable).where(eq(fixturesTable.apiFootballFixtureId, -2007))).toEqual([]);
    });
  });
  it("GET /api/schedule attaches -2007 to December and no other event", async () => {
    await isolated(async () => {
      const response = await request(app).get("/api/schedule").expect(200);
      const containing = response.body.events.filter((e: { fixtures: { apiFootballFixtureId: number }[] }) =>
        e.fixtures.some(f => f.apiFootballFixtureId === -2007));
      expect(containing.map((e: { slug: string }) => e.slug)).toEqual(["friendly-dec-2026"]);
      expect(containing[0].fixtures).toHaveLength(1);
      expect(containing[0].fixtures[0]).toMatchObject(expectedFixture);
    });
  });
  it("on November 20 the dashboard hero selects December, with the TBD Jamaica fixture", async () => {
    await isolated(async tx => {
      const response = await request(app).get("/api/dashboard").expect(200);
      expect(response.body.nextScheduleEvent).toMatchObject(expectedEvent);
      expect(response.body.nextScheduleEvent.fixtures).toHaveLength(1);
      const heroFixture = response.body.nextScheduleEvent.fixtures[0];
      // Dashboard serialization intentionally omits these internal columns.
      // Verify identity/classification through the actual returned row's id;
      // continue asserting every public field on the response itself.
      expect(heroFixture).not.toHaveProperty("apiFootballFixtureId");
      expect(heroFixture).not.toHaveProperty("ntLevel");
      const [identity] = await tx.select({
        apiFootballFixtureId: fixturesTable.apiFootballFixtureId,
        ntLevel: fixturesTable.ntLevel,
      }).from(fixturesTable).where(eq(fixturesTable.id, heroFixture.id));
      expect({ ...identity, ...heroFixture }).toMatchObject(expectedFixture);
      expect(heroFixture.kickoff).toBe("2026-12-14T00:00:00.000Z");
    });
  });
});
