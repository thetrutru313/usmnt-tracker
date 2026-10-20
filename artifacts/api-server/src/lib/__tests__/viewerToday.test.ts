import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { db, fixturesTable, scheduleEventsTable } from "@workspace/db";
import dashboardRouter from "../../routes/dashboard.js";
import fixturesRouter from "../../routes/fixtures.js";

const context = vi.hoisted(() => ({ transaction: null as unknown }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: new Proxy(actual.db, {
      get(target, property) {
        const source = (context.transaction ?? target) as typeof actual.db;
        const value = Reflect.get(source, property);
        return typeof value === "function" ? value.bind(source) : value;
      },
    }),
  };
});

const app = express().use("/api", dashboardRouter, fixturesRouter);
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const rollback = new Error("roll back isolated viewer-day test");
async function isolated(run: (tx: Tx) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      context.transaction = tx;
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
function freeze(instant: string) {
  // Fake Date only: HTTP, database and animation timers remain real.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(instant));
}
async function fixture(tx: Tx, kickoff: string) {
  const [row] = await tx.insert(fixturesTable).values({
    isNationalTeam: true, ntLevel: "SENIOR", competition: "__viewer_day__",
    kickoff: new Date(kickoff), venue: "__viewer_day__", homeTeam: "__viewer_home__",
    awayTeam: "__viewer_away__", status: "scheduled",
  }).returning();
  return row.id;
}
const paths = ["/api/dashboard", "/api/fixtures?scope=today"];
async function ids(path: string, tz?: string): Promise<number[]> {
  const response = await request(app).get(path).query(tz === undefined ? {} : { tz }).expect(200);
  const games = path.includes("dashboard") ? response.body.todaysGames : response.body;
  return games.map((f: { id: number }) => f.id);
}

describe.each(paths)("%s — viewer's calendar day (change-verifying)", (path) => {
  it("1: includes a Denver evening kickoff on the next UTC date", () => isolated(async (tx) => {
    freeze("2026-11-17T20:00:00Z");
    const id = await fixture(tx, "2026-11-18T00:00:00Z");
    expect(await ids(path, "America/Denver")).toContain(id);
  }));
  it("2: missing tz uses the Eastern calendar day", () => isolated(async (tx) => {
    freeze("2026-11-17T19:00:00Z");
    const id = await fixture(tx, "2026-11-18T00:00:00Z");
    expect(await ids(path)).toContain(id);
  }));
  it("3: Los Angeles includes 9 PM but excludes next-day 1 AM", () => isolated(async (tx) => {
    freeze("2026-11-18T02:00:00Z");
    const evening = await fixture(tx, "2026-11-18T05:00:00Z");
    const tomorrow = await fixture(tx, "2026-11-18T09:00:00Z");
    const result = await ids(path, "America/Los_Angeles");
    expect(result).toContain(evening);
    expect(result).not.toContain(tomorrow);
  }));
  it("4: includes 11:30 PM on the 25-hour Eastern fall-back day", () => isolated(async (tx) => {
    freeze("2026-11-01T15:00:00Z");
    const id = await fixture(tx, "2026-11-02T04:30:00Z");
    expect(await ids(path, "America/New_York")).toContain(id);
  }));
  it("5: invalid tz equals missing tz AND includes the correct Eastern evening", () => isolated(async (tx) => {
    freeze("2026-11-17T19:00:00Z");
    const id = await fixture(tx, "2026-11-18T00:00:00Z");
    const invalid = await ids(path, "Not/AZone");
    const missing = await ids(path);
    expect(invalid).toEqual(missing);
    expect(invalid).toContain(id);
  }));
  it("uses a 23-hour spring-forward day with an exclusive next midnight", () => isolated(async (tx) => {
    freeze("2026-03-08T15:00:00Z");
    const evening = await fixture(tx, "2026-03-09T03:30:00Z");
    const midnight = await fixture(tx, "2026-03-09T04:00:00Z");
    const result = await ids(path, "America/New_York");
    expect(result).toContain(evening);
    expect(result).not.toContain(midnight);
  }));
  it("includes local midnight and excludes the instant immediately before it", () => isolated(async (tx) => {
    freeze("2026-11-17T20:00:00Z");
    const midnight = await fixture(tx, "2026-11-17T07:00:00Z");
    const before = await fixture(tx, "2026-11-17T06:59:59.999Z");
    const result = await ids(path, "America/Denver");
    expect(result).toContain(midnight);
    expect(result).not.toContain(before);
  }));
});

describe("viewer day — additional changed behavior", () => {
  it("dashboard start-only hero uses the same viewer date after UTC midnight", () => isolated(async (tx) => {
    freeze("2026-11-18T02:00:00Z");
    const [event] = await tx.insert(scheduleEventsTable).values({
      slug: "__viewer_start_only__", name: "__viewer_start_only__", kind: "friendly",
      status: "confirmed", startDate: "2026-11-17", endDate: null,
      dateLabel: "Nov 17", description: "", sortOrder: -2147483648,
    }).returning();
    const response = await request(app).get("/api/dashboard").query({ tz: "America/Los_Angeles" }).expect(200);
    expect(response.body.nextScheduleEvent?.id).toBe(event.id);
  }));
});

describe("viewer day — regression guards", () => {
  it.each(paths)("7: %s never includes a fixture two days ahead", (path) => isolated(async (tx) => {
    freeze("2026-11-17T20:00:00Z");
    const id = await fixture(tx, "2026-11-19T20:00:00Z");
    expect(await ids(path, "America/Denver")).not.toContain(id);
  }));
  it("8: upcoming scope remains relative to now, regardless of tz", () => isolated(async (tx) => {
    freeze("2026-11-17T20:00:00Z");
    const future = await fixture(tx, "2026-11-17T21:00:00Z");
    const past = await fixture(tx, "2026-11-17T19:00:00Z");
    const response = await request(app).get("/api/fixtures").query({ scope: "upcoming", tz: "America/Denver" }).expect(200);
    const result = response.body.map((f: { id: number }) => f.id);
    expect(result).toContain(future);
    expect(result).not.toContain(past);
  }));
});
