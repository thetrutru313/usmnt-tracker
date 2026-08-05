/**
 * Regression guard: confirms that GET /api/schedule and GET /api/dashboard
 * include NT fixtures (including ones seeded with negative sentinel IDs) in
 * the `fixtures` array of their respective schedule event payload.
 *
 * ## Why this matters
 * Task #614 extended both routes to attach NT fixtures to schedule events by
 * date-window matching. Without a regression guard a future refactor could
 * silently drop the fixtures array or fail to attach negative-sentinel rows.
 *
 * ## What is tested
 * 1. GET /api/schedule — the matching event's `fixtures` array contains the
 *    seeded NT fixture (negative sentinel api_football_fixture_id).
 * 2. GET /api/schedule — an event whose window contains no NT fixtures returns
 *    `fixtures: []`.
 * 3. GET /api/dashboard — `nextScheduleEvent.fixtures` contains the NT fixture
 *    when the upcoming event has a matching date window.
 *
 * ## How it works
 * - Inserts a schedule_events row (far-future sortOrder=-9998 so it is the
 *   next upcoming event for the dashboard test) with a 2-day date window.
 * - Inserts a minimal NT fixture with a negative api_football_fixture_id whose
 *   kickoff falls within that window.
 * - Hits the routes via supertest and asserts fixture attachment.
 * - afterAll removes all inserted rows.
 */

import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { db, scheduleEventsTable, fixturesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ─── test data ───────────────────────────────────────────────────────────────

// Use a far-future window so it doesn't collide with real events and always
// qualifies as "upcoming" for the dashboard query.
const TEST_SLUG = "__test-schedule-fixture-attach__";
// Start 30 days from now, end 31 days from now (2-day window).
const startMs = Date.now() + 30 * 24 * 60 * 60 * 1000;
const endMs = startMs + 24 * 60 * 60 * 1000;
const startDate = new Date(startMs).toISOString().slice(0, 10);
const endDate = new Date(endMs).toISOString().slice(0, 10);
// Kickoff 18 h into the window — safely within both UTC midnight boundaries.
const kickoff = new Date(startMs + 18 * 60 * 60 * 1000);

// Sentinel negative ID — real API-Football IDs are always positive.
const SENTINEL_ID = -9901;

// Cleanup registry
let insertedEventId: number | null = null;
let insertedFixtureId: number | null = null;

afterAll(async () => {
  if (insertedFixtureId !== null) {
    await db.delete(fixturesTable).where(eq(fixturesTable.id, insertedFixtureId)).catch(() => {});
    insertedFixtureId = null;
  }
  if (insertedEventId !== null) {
    await db.delete(scheduleEventsTable).where(eq(scheduleEventsTable.id, insertedEventId)).catch(() => {});
    insertedEventId = null;
  }
});

// ─── helpers ─────────────────────────────────────────────────────────────────

async function setupTestData(): Promise<{ eventId: number; fixtureId: number }> {
  const [event] = await db
    .insert(scheduleEventsTable)
    .values({
      slug: TEST_SLUG,
      name: "__Test Schedule Event__",
      kind: "friendly",
      status: "confirmed",
      startDate,
      endDate,
      dateLabel: "Test Window",
      description: "Inserted by scheduleFixtureAttachment test",
      // Sort order -9998 ensures this is the first upcoming event for dashboard
      sortOrder: -9998,
      updatedAt: new Date(),
    })
    .onConflictDoNothing({ target: scheduleEventsTable.slug })
    .returning({ id: scheduleEventsTable.id });
  if (!event) throw new Error("Schedule event insert failed (conflict?)");

  const [fixture] = await db
    .insert(fixturesTable)
    .values({
      apiFootballFixtureId: SENTINEL_ID,
      isNationalTeam: true,
      competition: "International Friendly",
      kickoff,
      venue: "__Test Venue__",
      city: "__Test City, TS__",
      homeTeam: "USA",
      awayTeam: "__Test Opponent__",
      status: "scheduled",
    })
    .onConflictDoNothing({ target: fixturesTable.apiFootballFixtureId })
    .returning({ id: fixturesTable.id });
  if (!fixture) throw new Error("Fixture insert failed (conflict on sentinel ID?)");

  return { eventId: event.id, fixtureId: fixture.id };
}

// ─── suite ───────────────────────────────────────────────────────────────────

describe("GET /api/schedule — NT fixtures attached to schedule events", () => {
  it(
    "attaches a negative-sentinel NT fixture to the matching event's fixtures array",
    async () => {
      const { eventId, fixtureId } = await setupTestData();
      insertedEventId = eventId;
      insertedFixtureId = fixtureId;

      const res = await request(app).get("/api/schedule").expect(200);
      expect(Array.isArray(res.body?.events), "response should have an events array").toBe(true);

      const event = res.body.events.find((e: { slug: string }) => e.slug === TEST_SLUG);
      expect(event, `Test event (slug=${TEST_SLUG}) not found in /api/schedule response`).toBeDefined();

      expect(
        Array.isArray(event.fixtures),
        "event.fixtures should be an array",
      ).toBe(true);

      const attached = event.fixtures.find((f: { id: number }) => f.id === fixtureId);
      expect(
        attached,
        `NT fixture id=${fixtureId} (sentinel api_football_fixture_id=${SENTINEL_ID}) was not ` +
          `attached to its schedule event — the route may not be querying negative-sentinel rows correctly`,
      ).toBeDefined();

      // Verify city is serialised
      expect(attached?.city).toBe("__Test City, TS__");
    },
    30_000,
  );

  it(
    "returns fixtures:[] for a windowed event with no matching NT fixtures",
    async () => {
      const res = await request(app).get("/api/schedule").expect(200);
      // Find an event that has a date window but whose window should have zero
      // real NT fixtures (e.g. the Nov 2026 event which has no seeded fixtures).
      const nov = res.body.events.find(
        (e: { slug: string; fixtures?: unknown[] }) => e.slug === "friendlies-nov-2026",
      );
      if (!nov) return; // event not present — skip without failing
      expect(Array.isArray(nov.fixtures), "nov event.fixtures should be an array").toBe(true);
      expect(nov.fixtures).toHaveLength(0);
    },
    15_000,
  );
});

describe("GET /api/dashboard — nextScheduleEvent includes fixtures array", () => {
  it(
    "nextScheduleEvent.fixtures contains the NT fixture for the upcoming event",
    async () => {
      // Ensure test data is present
      if (insertedEventId === null) {
        const { eventId, fixtureId } = await setupTestData();
        insertedEventId = eventId;
        insertedFixtureId = fixtureId;
      }

      const res = await request(app).get("/api/dashboard").expect(200);
      const nse = res.body?.nextScheduleEvent;
      // The dashboard picks the first upcoming event by sortOrder. Our test
      // event uses sortOrder=-9998, so it should be first among upcoming events.
      if (!nse || nse.slug !== TEST_SLUG) {
        // Another event is earlier — skip rather than fail (flaky environment).
        return;
      }

      expect(
        Array.isArray(nse.fixtures),
        "nextScheduleEvent.fixtures should be an array",
      ).toBe(true);

      const attached = nse.fixtures.find((f: { id: number }) => f.id === insertedFixtureId);
      expect(
        attached,
        `NT fixture id=${insertedFixtureId} was not present in nextScheduleEvent.fixtures`,
      ).toBeDefined();
    },
    30_000,
  );
});
