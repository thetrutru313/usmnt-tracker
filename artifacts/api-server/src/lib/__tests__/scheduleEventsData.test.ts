import { readFileSync } from "node:fs";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { events } from "../../../../../lib/db/src/seeds/scheduleEventsData";

type SeedEvent = (typeof events)[number];

const queryMocks = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("@workspace/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/db")>(),
  db: { select: queryMocks.select },
}));

import scheduleRouter from "../../routes/schedule.js";

const removedSlugs = [
  "cnl-f4-gold-cup-2027",
  "wcq-begins-2027",
  "wcq-2028-2029",
];
const qualifyingSlugs = [
  "wcq-r2-2027",
  "wcq-final-jun-2028",
  "wcq-final-sept-2029",
];

beforeEach(() => {
  queryMocks.select.mockReset();
});

describe("schedule data — change-verifying tests", () => {
  it("1: separates the March Finals and summer Gold Cup with their dates", () => {
    expect(events.find((event) => event.slug === "cnl-finals-mar-2027"))
      .toMatchObject({ startDate: "2027-03-25", endDate: "2027-03-28" });
    expect(events.find((event) => event.slug === "gold-cup-2027"))
      .toMatchObject({ startDate: "2027-06-18", endDate: "2027-07-11" });
  });

  it("2: excludes all three retired slugs", () => {
    expect(events.filter((event) => removedSlugs.includes(event.slug))).toEqual([]);
  });

  it("3: GET /api/schedule returns all three qualifying blocks without fixtures", async () => {
    const seededRows = events.map((event, index) => ({
      ...event,
      id: index + 1,
      createdAt: new Date("2026-10-07T00:00:00Z"),
      updatedAt: new Date("2026-10-07T00:00:00Z"),
    }));
    // Deliberately supply candidate matches during each qualifying period.
    // They must not attach to start-date-only events, even if returned by
    // the route's batch query. These are in-memory objects, not DB writes.
    const candidates = ["2027-10-01", "2028-06-01", "2029-10-01"].map((date, index) => ({
      id: 9000 + index,
      apiFootballFixtureId: 9000 + index,
      isNationalTeam: true,
      ntLevel: "SENIOR",
      kickoff: new Date(`${date}T12:00:00Z`),
    }));
    queryMocks.select
      .mockReturnValueOnce({ from: () => ({ orderBy: async () => seededRows }) })
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ orderBy: async () => candidates }) }),
      });
    const app = express();
    app.use("/api", scheduleRouter);
    const response = await request(app).get("/api/schedule").expect(200);
    const qualifying = response.body.events.filter(
      (event: SeedEvent) => event.kind === "world-cup-qualifying",
    );
    expect(qualifying.map((event: SeedEvent) => event.slug)).toEqual(qualifyingSlugs);
    for (const event of qualifying) {
      expect(event.endDate).toBeNull();
      expect(event.fixtures).toEqual([]);
    }
  });
});

describe("schedule data — invariant guards", () => {
  it("4: slugs are unique and kinds/statuses match the documented schema values", () => {
    const schema = readFileSync(
      new URL("../../../../../lib/db/src/schema/nationalTeam.ts", import.meta.url),
      "utf8",
    );
    const documented = [...schema.matchAll(/One of: ([^\n*]+)/g)]
      .map((match) => match[1]!.trim().split(/\s*\|\s*/));
    expect(documented).toHaveLength(2);
    const [kinds, statuses] = documented;
    expect(new Set(events.map((event) => event.slug)).size).toBe(events.length);
    for (const event of events) {
      expect(kinds).toContain(event.kind);
      expect(statuses).toContain(event.status);
    }
  });

  it("5: sort order strictly increases alongside dated-event chronology", () => {
    const dated = events.filter((event) => event.startDate !== null);
    for (let index = 1; index < dated.length; index++) {
      expect(dated[index]!.sortOrder).toBeGreaterThan(dated[index - 1]!.sortOrder);
      expect(dated[index]!.startDate! > dated[index - 1]!.startDate!).toBe(true);
    }
  });

  it("6: bounded windows do not overlap, including the 30-hour extension", () => {
    const bounded = events.filter((event) => event.startDate && event.endDate)
      .map((event) => ({
        slug: event.slug,
        start: Date.parse(`${event.startDate}T00:00:00Z`),
        end: Date.parse(`${event.endDate}T00:00:00Z`) + 30 * 60 * 60 * 1000,
      }));
    for (let a = 0; a < bounded.length; a++) {
      for (let b = a + 1; b < bounded.length; b++) {
        const left = bounded[a]!;
        const right = bounded[b]!;
        expect(
          left.start < right.end && right.start < left.end,
          `${left.slug} overlaps ${right.slug}`,
        ).toBe(false);
      }
    }
  });

  it("7: every bounded event has a start date no later than its end date", () => {
    for (const event of events.filter((event) => event.endDate !== null)) {
      expect(event.startDate, event.slug).not.toBeNull();
      expect(event.startDate! <= event.endDate!).toBe(true);
    }
  });
});
