/**
 * GET /api/dashboard hero (review D7), through the real route and database.
 *
 * Change-verifying (fail before D7):
 * 1. A start-only block stays the hero after its start day, until the next
 *    block starts.
 * 2. A tbd block ("Possible Friendlies") with an earlier sort order never takes
 *    the hero.
 * Regression guard: once the next block starts, it takes over.
 *
 * Each test runs in a rolled-back transaction with a temporary
 * schedule_events table, so real development events can't interfere. Dates
 * are in 2099 and the clock is frozen there.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { db, scheduleEventsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import dashboardRouter from "../../routes/dashboard.js";

const context = vi.hoisted(() => ({ transaction: null as unknown, now: "" }));
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
// Pin any SQL NOW() to the frozen clock too (the hero no longer uses it, but
// the route did before D7, and this test must compare like with like).
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  const pinnedSql = (parts: TemplateStringsArray, ...values: unknown[]) => {
    const strings = parts.map((part) =>
      context.now ? part.replaceAll("NOW()", `'${context.now}'::timestamptz`) : part);
    return actual.sql(Object.assign(strings, { raw: strings }), ...values);
  };
  return { ...actual, sql: Object.assign(pinnedSql, actual.sql) };
});

const app = express().use("/api", dashboardRouter);
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Block = { slug: string; status: string; startDate: string | null; endDate: string | null; sortOrder: number };

async function heroAt(instant: string, blocks: Block[]): Promise<string | undefined> {
  const rollback = new Error("roll back hero test");
  let slug: string | undefined;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(instant));
  context.now = instant;
  try {
    await db.transaction(async (tx: Tx) => {
      context.transaction = tx;
      await tx.execute(sql`CREATE TEMP TABLE schedule_events (LIKE public.schedule_events INCLUDING ALL) ON COMMIT DROP`);
      await tx.insert(scheduleEventsTable).values(blocks.map((b) => ({
        ...b, name: b.slug, kind: "friendly", dateLabel: b.slug, description: "",
      })));
      const response = await request(app).get("/api/dashboard").query({ tz: "America/New_York" }).expect(200);
      slug = response.body.nextScheduleEvent?.slug;
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    context.transaction = null;
    context.now = "";
  }
  return slug;
}

afterEach(() => vi.useRealTimers());

const qualifying: Block[] = [
  { slug: "__wcq_r2__", status: "approximate", startDate: "2099-09-28", endDate: null, sortOrder: 80 },
  { slug: "__wcq_final__", status: "approximate", startDate: "2100-05-29", endDate: null, sortOrder: 90 },
];

describe("dashboard hero — start-only blocks (change-verifying)", () => {
  it("1: keeps a start-only block after its start day while it is being played", async () => {
    expect(await heroAt("2099-11-15T17:00:00Z", qualifying)).toBe("__wcq_r2__");
  }, 30_000);
});

describe("dashboard hero — tbd blocks (change-verifying)", () => {
  it("2: skips a tbd block with an earlier sort order", async () => {
    expect(await heroAt("2099-04-01T17:00:00Z", [
      { slug: "__possible_june__", status: "tbd", startDate: "2099-06-07", endDate: null, sortOrder: 50 },
      { slug: "__gold_cup__", status: "approximate", startDate: "2099-06-18", endDate: "2099-07-11", sortOrder: 60 },
    ])).toBe("__gold_cup__");
  }, 30_000);
});

describe("dashboard hero — regression guard", () => {
  it("3: the next block takes over on its start day", async () => {
    expect(await heroAt("2100-05-29T17:00:00Z", qualifying)).toBe("__wcq_final__");
  }, 30_000);
});
