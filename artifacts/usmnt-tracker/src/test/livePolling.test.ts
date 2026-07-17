/**
 * Unit tests for the live-match polling helpers used by Fixtures and Dashboard.
 *
 * These are pure, framework-free tests — no React rendering required.
 * They verify that `refetchInterval` returns the correct value across every
 * meaningful data state:
 *
 *   • No data yet (undefined)         → false  (don't poll before first fetch)
 *   • All fixtures finished/upcoming  → false  (stop polling after final whistle)
 *   • At least one fixture is live    → 60 000 (poll every minute while live)
 *
 * Both the Fixtures page helper (`fixturesRefetchInterval`) and the Dashboard
 * helper (`dashboardRefetchInterval`) are covered.
 */

import { describe, it, expect } from "vitest";
import {
  fixturesRefetchInterval,
  dashboardRefetchInterval,
  LIVE_POLL_INTERVAL,
} from "@/lib/livePolling";

// ─── Fixtures page ────────────────────────────────────────────────────────────

describe("fixturesRefetchInterval", () => {
  it("returns false when data is undefined (no fetch has completed yet)", () => {
    expect(fixturesRefetchInterval(undefined)).toBe(false);
  });

  it("returns false when the fixtures array is empty", () => {
    expect(fixturesRefetchInterval([])).toBe(false);
  });

  it("returns false when all fixtures are finished", () => {
    const fixtures = [
      { status: "finished" },
      { status: "finished" },
      { status: "finished" },
    ];
    expect(fixturesRefetchInterval(fixtures)).toBe(false);
  });

  it("returns false when fixtures have upcoming/scheduled statuses only", () => {
    const fixtures = [
      { status: "upcoming" },
      { status: "scheduled" },
      { status: "postponed" },
    ];
    expect(fixturesRefetchInterval(fixtures)).toBe(false);
  });

  it("returns LIVE_POLL_INTERVAL when exactly one fixture is live", () => {
    const fixtures = [{ status: "finished" }, { status: "live" }, { status: "finished" }];
    expect(fixturesRefetchInterval(fixtures)).toBe(LIVE_POLL_INTERVAL);
  });

  it("returns LIVE_POLL_INTERVAL when all fixtures are live", () => {
    const fixtures = [{ status: "live" }, { status: "live" }];
    expect(fixturesRefetchInterval(fixtures)).toBe(LIVE_POLL_INTERVAL);
  });

  it("returns LIVE_POLL_INTERVAL when a live fixture is the last in a mixed list", () => {
    const fixtures = [
      { status: "finished" },
      { status: "finished" },
      { status: "live" },
    ];
    expect(fixturesRefetchInterval(fixtures)).toBe(LIVE_POLL_INTERVAL);
  });

  it("stops polling (false) once the last live fixture becomes finished", () => {
    // Simulate the transition: was live, now finished
    const before = [{ status: "live" }, { status: "finished" }];
    const after  = [{ status: "finished" }, { status: "finished" }];

    expect(fixturesRefetchInterval(before)).toBe(LIVE_POLL_INTERVAL);
    expect(fixturesRefetchInterval(after)).toBe(false);
  });

  it("LIVE_POLL_INTERVAL is exactly 60 000 ms (1 minute)", () => {
    expect(LIVE_POLL_INTERVAL).toBe(60_000);
  });
});

// ─── Dashboard page ───────────────────────────────────────────────────────────

describe("dashboardRefetchInterval", () => {
  it("returns false when data is undefined (no fetch has completed yet)", () => {
    expect(dashboardRefetchInterval(undefined)).toBe(false);
  });

  it("returns false when both todaysGames and upcomingGames are empty arrays", () => {
    expect(dashboardRefetchInterval({ todaysGames: [], upcomingGames: [] })).toBe(false);
  });

  it("returns false when todaysGames and upcomingGames are absent (sparse object)", () => {
    expect(dashboardRefetchInterval({})).toBe(false);
  });

  it("returns false when all fixtures in both arrays are finished", () => {
    const data = {
      todaysGames:   [{ status: "finished" }, { status: "finished" }],
      upcomingGames: [{ status: "upcoming" }],
    };
    expect(dashboardRefetchInterval(data)).toBe(false);
  });

  it("returns LIVE_POLL_INTERVAL when a todaysGames entry is live", () => {
    const data = {
      todaysGames:   [{ status: "live" }],
      upcomingGames: [{ status: "upcoming" }],
    };
    expect(dashboardRefetchInterval(data)).toBe(LIVE_POLL_INTERVAL);
  });

  it("returns LIVE_POLL_INTERVAL when an upcomingGames entry is live", () => {
    const data = {
      todaysGames:   [{ status: "finished" }],
      upcomingGames: [{ status: "live" }],
    };
    expect(dashboardRefetchInterval(data)).toBe(LIVE_POLL_INTERVAL);
  });

  it("returns LIVE_POLL_INTERVAL when live fixtures exist in both arrays", () => {
    const data = {
      todaysGames:   [{ status: "live" }],
      upcomingGames: [{ status: "live" }, { status: "finished" }],
    };
    expect(dashboardRefetchInterval(data)).toBe(LIVE_POLL_INTERVAL);
  });

  it("stops polling (false) once the last live fixture in todaysGames becomes finished", () => {
    const before = {
      todaysGames:   [{ status: "live" }],
      upcomingGames: [{ status: "finished" }],
    };
    const after = {
      todaysGames:   [{ status: "finished" }],
      upcomingGames: [{ status: "finished" }],
    };

    expect(dashboardRefetchInterval(before)).toBe(LIVE_POLL_INTERVAL);
    expect(dashboardRefetchInterval(after)).toBe(false);
  });

  it("stops polling (false) once the last live fixture in upcomingGames becomes finished", () => {
    const before = {
      todaysGames:   [{ status: "finished" }],
      upcomingGames: [{ status: "live" }],
    };
    const after = {
      todaysGames:   [{ status: "finished" }],
      upcomingGames: [{ status: "finished" }],
    };

    expect(dashboardRefetchInterval(before)).toBe(LIVE_POLL_INTERVAL);
    expect(dashboardRefetchInterval(after)).toBe(false);
  });

  it("returns false when only todaysGames is present and it has no live fixtures", () => {
    expect(dashboardRefetchInterval({ todaysGames: [{ status: "finished" }] })).toBe(false);
  });

  it("returns LIVE_POLL_INTERVAL when only todaysGames is present and one is live", () => {
    expect(dashboardRefetchInterval({ todaysGames: [{ status: "live" }] })).toBe(LIVE_POLL_INTERVAL);
  });
});
