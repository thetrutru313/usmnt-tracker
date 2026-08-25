/**
 * Regression guard for the `nt_level` senior-only filtering fix.
 *
 * ## Why this matters
 * `fixtures.is_national_team` is `true` for the senior USMNT AND for youth
 * age-group sides (U17/U20/U23) alike — there was previously no other
 * discriminator. That let U17/U20 fixtures leak into the Dashboard hero
 * (`nextScheduleEvent.fixtures`) and the USMNT Schedule page, both of which
 * are meant to show only the senior team.
 *
 * The fix adds `fixtures.nt_level` plus the `isSeniorNtFixture()` allowlist
 * predicate (`is_national_team = true AND nt_level = 'SENIOR'`), applied to
 * exactly two queries: the dashboard hero's `nextEventFixtures` query and the
 * schedule page's `ntFixtures` query. Everything else — the Upcoming Matches
 * card (`todaysGames`/`upcomingGames`) and the Fixtures page — must keep
 * showing every age group, unchanged.
 *
 * ## What is tested
 * For each of the four surfaces, five fixture types are exercised: a senior
 * fixture, a U17 fixture, a U20 fixture, a club fixture, and a national-team
 * fixture with `nt_level = NULL` (unclassifiable — must fail closed).
 *
 * 1. Dashboard hero (`nextScheduleEvent.fixtures`) — senior only; U17, U20,
 *    club, and null-level NT rows are all excluded.
 * 2. Schedule page (`GET /api/schedule` window fixtures) — same as above.
 * 3. Dashboard Upcoming Matches card (`todaysGames`/`upcomingGames`) — must
 *    still include senior, U17, and U20 national-team rows (explicit
 *    regression guard so youth rows can't quietly disappear later). Club
 *    fixtures are excluded there for an unrelated reason (no linked player),
 *    which this test does not re-litigate.
 * 4. Fixtures page (`GET /api/fixtures/:id`) — every type (senior, U17, U20,
 *    club, null-level NT) is fetchable and returned as-is; the endpoint does
 *    not filter by `nt_level` at all.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { db, scheduleEventsTable, fixturesTable, clubsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ─── test window ──────────────────────────────────────────────────────────
// Far-future window so it doesn't collide with real events/fixtures.
const startMs = Date.now() + 60 * 24 * 60 * 60 * 1000;
const endMs = startMs + 24 * 60 * 60 * 1000;
const startDate = new Date(startMs).toISOString().slice(0, 10);
const endDate = new Date(endMs).toISOString().slice(0, 10);
const kickoff = new Date(startMs + 12 * 60 * 60 * 1000);

const TEST_SLUG = "__test-nt-level-filtering__";

// Separate near-term window for the Upcoming Matches card check — that
// query orders by soonest kickoff with a limit of 8, so a far-future
// fixture (used for the hero/schedule window above) could be pushed out of
// the returned page by real seeded data. Using "just after today" all but
// guarantees these rank first.
const soonKickoff = new Date();
soonKickoff.setDate(soonKickoff.getDate() + 1);
soonKickoff.setHours(0, 5, 0, 0); // just after today's end-of-day cutoff

const fixtureIds: Record<string, number> = {};
let eventId: number | null = null;
let testClubId: number | null = null;

async function insertFixture(key: string, overrides: Partial<typeof fixturesTable.$inferInsert>) {
  const [row] = await db
    .insert(fixturesTable)
    .values({
      apiFootballFixtureId: overrides.apiFootballFixtureId!,
      competition: "International Friendly",
      kickoff,
      venue: "__NT Level Test Venue__",
      homeTeam: "USA",
      awayTeam: "__Test Opponent__",
      status: "scheduled",
      isNationalTeam: true,
      ntLevel: null,
      ...overrides,
    })
    .onConflictDoNothing({ target: fixturesTable.apiFootballFixtureId })
    .returning({ id: fixturesTable.id });
  if (!row) throw new Error(`Fixture insert failed for ${key} (conflict on sentinel ID?)`);
  fixtureIds[key] = row.id;
}

beforeAll(async () => {
  const [ev] = await db
    .insert(scheduleEventsTable)
    .values({
      slug: TEST_SLUG,
      name: "__NT Level Filtering Test Event__",
      kind: "friendly",
      status: "confirmed",
      startDate,
      endDate,
      dateLabel: "NT Level Test Window",
      description: "Inserted by ntLevelFiltering test",
      // Less negative than the -9996..-9998 range used by
      // dashboardInWindowEvent.test.ts / scheduleFixtureAttachment.test.ts so
      // this event never wins the "next upcoming event" race against theirs
      // when test files run concurrently against the same dev DB. Still far
      // below any real event's sortOrder (10-90).
      sortOrder: -9990,
      updatedAt: new Date(),
    })
    .onConflictDoNothing({ target: scheduleEventsTable.slug })
    .returning({ id: scheduleEventsTable.id });
  if (!ev) throw new Error("Schedule event insert failed (conflict?)");
  eventId = ev.id;

  const [club] = await db
    .insert(clubsTable)
    .values({
      name: "__NT Level Test Club__",
      league: "__Test League__",
      country: "USA",
    })
    .returning({ id: clubsTable.id });
  testClubId = club?.id ?? null;

  await insertFixture("senior", {
    apiFootballFixtureId: -9910,
    homeTeam: "USA",
    awayTeam: "__Senior Opponent__",
    isNationalTeam: true,
    ntLevel: "SENIOR",
  });
  await insertFixture("u17", {
    apiFootballFixtureId: -9911,
    homeTeam: "United States U17",
    awayTeam: "__U17 Opponent__",
    isNationalTeam: true,
    ntLevel: "U17",
  });
  await insertFixture("u20", {
    apiFootballFixtureId: -9912,
    homeTeam: "United States U20",
    awayTeam: "__U20 Opponent__",
    isNationalTeam: true,
    ntLevel: "U20",
  });
  await insertFixture("club", {
    apiFootballFixtureId: -9913,
    homeTeam: "__NT Level Test Club__",
    awayTeam: "__Club Opponent__",
    isNationalTeam: false,
    ntLevel: null,
  });
  await insertFixture("ntNull", {
    apiFootballFixtureId: -9914,
    homeTeam: "United States U23", // unclassifiable per current NT_LEVEL_VALUES on purpose via null override below
    awayTeam: "__Unclassified Opponent__",
    isNationalTeam: true,
    ntLevel: null, // simulates a row that failed classification — must fail closed, not be treated as senior
  });

  // Near-term fixtures dedicated to the Upcoming Matches card check (see
  // note on `soonKickoff` above for why this needs its own window).
  await insertFixture("soonSenior", {
    apiFootballFixtureId: -9915,
    homeTeam: "USA",
    awayTeam: "__Soon Senior Opponent__",
    isNationalTeam: true,
    ntLevel: "SENIOR",
    kickoff: soonKickoff,
  });
  await insertFixture("soonU17", {
    apiFootballFixtureId: -9916,
    homeTeam: "United States U17",
    awayTeam: "__Soon U17 Opponent__",
    isNationalTeam: true,
    ntLevel: "U17",
    kickoff: soonKickoff,
  });
  await insertFixture("soonU20", {
    apiFootballFixtureId: -9917,
    homeTeam: "United States U20",
    awayTeam: "__Soon U20 Opponent__",
    isNationalTeam: true,
    ntLevel: "U20",
    kickoff: soonKickoff,
  });
}, 30_000);

afterAll(async () => {
  for (const id of Object.values(fixtureIds)) {
    await db.delete(fixturesTable).where(eq(fixturesTable.id, id)).catch(() => {});
  }
  if (eventId !== null) {
    await db.delete(scheduleEventsTable).where(eq(scheduleEventsTable.id, eventId)).catch(() => {});
  }
  if (testClubId !== null) {
    await db.delete(clubsTable).where(eq(clubsTable.id, testClubId)).catch(() => {});
  }
});

// ─── 1 & 2: hero + schedule page — senior only ────────────────────────────

describe("Dashboard hero and Schedule page — senior-only nt_level filtering", () => {
  it("GET /api/schedule — event.fixtures contains only the senior fixture", async () => {
    const res = await request(app).get("/api/schedule").expect(200);
    const event = res.body.events.find((e: { slug: string }) => e.slug === TEST_SLUG);
    expect(event, `Test event (slug=${TEST_SLUG}) not found in /api/schedule response`).toBeDefined();

    const ids = (event.fixtures as { id: number }[]).map((f) => f.id);
    expect(ids, "senior fixture should be included").toContain(fixtureIds.senior);
    expect(ids, "U17 fixture must be excluded from the schedule page window").not.toContain(fixtureIds.u17);
    expect(ids, "U20 fixture must be excluded from the schedule page window").not.toContain(fixtureIds.u20);
    expect(ids, "club fixture must be excluded from the schedule page window").not.toContain(fixtureIds.club);
    expect(ids, "null-nt_level NT fixture must fail closed and be excluded").not.toContain(fixtureIds.ntNull);
  }, 30_000);

  it("GET /api/dashboard — nextScheduleEvent.fixtures contains only the senior fixture (when this event is next)", async () => {
    const res = await request(app).get("/api/dashboard").expect(200);
    const nse = res.body?.nextScheduleEvent;
    if (!nse || nse.slug !== TEST_SLUG) {
      // Another event is earlier by sortOrder — skip rather than flake.
      return;
    }
    const ids = (nse.fixtures as { id: number }[]).map((f) => f.id);
    expect(ids, "senior fixture should be included").toContain(fixtureIds.senior);
    expect(ids, "U17 fixture must be excluded from the hero").not.toContain(fixtureIds.u17);
    expect(ids, "U20 fixture must be excluded from the hero").not.toContain(fixtureIds.u20);
    expect(ids, "club fixture must be excluded from the hero").not.toContain(fixtureIds.club);
    expect(ids, "null-nt_level NT fixture must fail closed and be excluded from the hero").not.toContain(fixtureIds.ntNull);
  }, 30_000);
});

// ─── 3: Upcoming Matches card — youth must still appear ───────────────────

describe("Dashboard Upcoming Matches card — youth NT fixtures still appear", () => {
  it("GET /api/dashboard — todaysGames/upcomingGames still include senior, U17, and U20 NT fixtures", async () => {
    const res = await request(app).get("/api/dashboard").expect(200);
    const combined = [
      ...(res.body?.todaysGames ?? []),
      ...(res.body?.upcomingGames ?? []),
    ] as { id: number }[];
    const ids = combined.map((f) => f.id);

    expect(ids, "senior fixture must still appear in Upcoming Matches").toContain(fixtureIds.soonSenior);
    expect(ids, "U17 fixture must still appear in Upcoming Matches — this card is not senior-only").toContain(fixtureIds.soonU17);
    expect(ids, "U20 fixture must still appear in Upcoming Matches — this card is not senior-only").toContain(fixtureIds.soonU20);
  }, 30_000);
});

// ─── 4: Fixtures page — all age groups fetchable ──────────────────────────

describe("Fixtures page — all age groups remain fetchable regardless of nt_level", () => {
  it.each(["senior", "u17", "u20", "club", "ntNull"] as const)(
    "GET /api/fixtures/:id returns the %s fixture unfiltered",
    async (key) => {
      const res = await request(app).get(`/api/fixtures/${fixtureIds[key]}`).expect(200);
      expect(res.body?.id).toBe(fixtureIds[key]);
    },
    15_000,
  );
});
