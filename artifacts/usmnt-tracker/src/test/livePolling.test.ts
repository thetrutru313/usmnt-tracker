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

  it("returns LIVE_POLL_INTERVAL when fixtures are scheduled/upcoming (so the LIVE badge appears within one poll cycle of kick-off)", () => {
    const fixtures = [
      { status: "upcoming" },
      { status: "scheduled" },
    ];
    expect(fixturesRefetchInterval(fixtures)).toBe(LIVE_POLL_INTERVAL);
  });

  it("returns LIVE_POLL_INTERVAL when a non-finished fixture is mixed with finished ones", () => {
    const fixtures = [
      { status: "finished" },
      { status: "scheduled" },
    ];
    expect(fixturesRefetchInterval(fixtures)).toBe(LIVE_POLL_INTERVAL);
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

  /**
   * AUTO-RESUME: finished → live round-trip
   *
   * React Query re-evaluates `refetchInterval` on every completed fetch.
   * If a fixture transitions back to live (e.g. extra time begins, or a
   * data-feed correction re-marks a match as live), the helper must return
   * LIVE_POLL_INTERVAL again so React Query restarts polling automatically
   * on the very next background refetch cycle — no component remount required.
   */
  it("resumes polling (LIVE_POLL_INTERVAL) when a finished fixture transitions back to live (e.g. extra time)", () => {
    // Step 1 — match appeared finished: polling stops
    const finished = [{ status: "finished" }, { status: "finished" }];
    expect(fixturesRefetchInterval(finished)).toBe(false);

    // Step 2 — data-feed correction: one match is live again
    const backToLive = [{ status: "live" }, { status: "finished" }];
    expect(fixturesRefetchInterval(backToLive)).toBe(LIVE_POLL_INTERVAL);
  });

  /**
   * Sequential double-finish: two live fixtures ending at different times.
   *
   * React Query re-evaluates `refetchInterval` after every completed fetch,
   * so the helper is called once per poll cycle with fresh data.
   *
   * Step 1 — both live     → poll (LIVE_POLL_INTERVAL)
   * Step 2 — first done    → still poll (second is still live)
   * Step 3 — both done     → stop polling (false)
   *
   * This confirms the helper never halts early and never keeps running
   * past the last live match.
   */
  it("keeps polling while the first of two live fixtures finishes, stops only after the second finishes", () => {
    // Step 1: both fixtures are live
    const bothLive = [{ status: "live" }, { status: "live" }];
    expect(fixturesRefetchInterval(bothLive)).toBe(LIVE_POLL_INTERVAL);

    // Step 2: first fixture finishes — second is still live → must keep polling
    const oneStillLive = [{ status: "finished" }, { status: "live" }];
    expect(fixturesRefetchInterval(oneStillLive)).toBe(LIVE_POLL_INTERVAL);

    // Step 3: second fixture finishes — all done → stop polling
    const bothFinished = [{ status: "finished" }, { status: "finished" }];
    expect(fixturesRefetchInterval(bothFinished)).toBe(false);
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

  /**
   * AUTO-RESUME: finished → live round-trip (dashboard)
   *
   * React Query re-evaluates `refetchInterval` on every completed fetch.
   * If a match transitions back to live (e.g. extra time, feed correction),
   * the helper must return LIVE_POLL_INTERVAL again so polling resumes
   * automatically — no component remount required.
   */
  it("resumes polling (LIVE_POLL_INTERVAL) when a todaysGames fixture transitions back to live after being finished", () => {
    // Step 1 — all done: polling stops
    const allFinished = {
      todaysGames:   [{ status: "finished" }],
      upcomingGames: [{ status: "finished" }],
    };
    expect(dashboardRefetchInterval(allFinished)).toBe(false);

    // Step 2 — feed correction: todaysGames match is live again
    const backToLive = {
      todaysGames:   [{ status: "live" }],
      upcomingGames: [{ status: "finished" }],
    };
    expect(dashboardRefetchInterval(backToLive)).toBe(LIVE_POLL_INTERVAL);
  });

  it("resumes polling (LIVE_POLL_INTERVAL) when an upcomingGames fixture transitions back to live after being finished", () => {
    // Step 1 — all done: polling stops
    const allFinished = {
      todaysGames:   [{ status: "finished" }],
      upcomingGames: [{ status: "finished" }],
    };
    expect(dashboardRefetchInterval(allFinished)).toBe(false);

    // Step 2 — feed correction: upcomingGames match is live again (e.g. extra time)
    const backToLive = {
      todaysGames:   [{ status: "finished" }],
      upcomingGames: [{ status: "live" }],
    };
    expect(dashboardRefetchInterval(backToLive)).toBe(LIVE_POLL_INTERVAL);
  });

  it("returns false when only todaysGames is present and it has no live fixtures", () => {
    expect(dashboardRefetchInterval({ todaysGames: [{ status: "finished" }] })).toBe(false);
  });

  it("returns LIVE_POLL_INTERVAL when only todaysGames is present and one is live", () => {
    expect(dashboardRefetchInterval({ todaysGames: [{ status: "live" }] })).toBe(LIVE_POLL_INTERVAL);
  });

  /**
   * Sequential double-finish across todaysGames: two live fixtures ending
   * at different times.
   *
   * Step 1 — both live     → poll (LIVE_POLL_INTERVAL)
   * Step 2 — first done    → still poll (second is still live)
   * Step 3 — both done     → stop polling (false)
   */
  it("keeps polling while the first of two live todaysGames finishes, stops only after the second finishes", () => {
    // Step 1: both fixtures in todaysGames are live
    const bothLive = {
      todaysGames:   [{ status: "live" }, { status: "live" }],
      upcomingGames: [{ status: "upcoming" }],
    };
    expect(dashboardRefetchInterval(bothLive)).toBe(LIVE_POLL_INTERVAL);

    // Step 2: first fixture finishes — second is still live → must keep polling
    const oneStillLive = {
      todaysGames:   [{ status: "finished" }, { status: "live" }],
      upcomingGames: [{ status: "upcoming" }],
    };
    expect(dashboardRefetchInterval(oneStillLive)).toBe(LIVE_POLL_INTERVAL);

    // Step 3: both fixtures finished — all done → stop polling
    const bothFinished = {
      todaysGames:   [{ status: "finished" }, { status: "finished" }],
      upcomingGames: [{ status: "upcoming" }],
    };
    expect(dashboardRefetchInterval(bothFinished)).toBe(false);
  });

  /**
   * Cross-array sequential finish: one live fixture in todaysGames and one in
   * upcomingGames ending at different times.
   *
   * React Query re-evaluates `refetchInterval` after every completed fetch, so
   * as long as either array still has a live fixture the helper must keep
   * returning LIVE_POLL_INTERVAL.
   *
   * Step 1 — todaysGames live, upcomingGames live  → poll (LIVE_POLL_INTERVAL)
   * Step 2 — todaysGames finished, upcomingGames still live → poll (LIVE_POLL_INTERVAL)
   * Step 3 — upcomingGames finished → stop polling (false)
   */
  it("keeps polling when the todaysGames fixture finishes first while an upcomingGames fixture is still live, stops only after the upcomingGames fixture finishes", () => {
    // Step 1: one live fixture in each array
    const bothLive = {
      todaysGames:   [{ status: "live" }],
      upcomingGames: [{ status: "live" }],
    };
    expect(dashboardRefetchInterval(bothLive)).toBe(LIVE_POLL_INTERVAL);

    // Step 2: todaysGames fixture finishes — upcomingGames is still live → must keep polling
    const todaysFinished = {
      todaysGames:   [{ status: "finished" }],
      upcomingGames: [{ status: "live" }],
    };
    expect(dashboardRefetchInterval(todaysFinished)).toBe(LIVE_POLL_INTERVAL);

    // Step 3: upcomingGames fixture finishes — all done → stop polling
    const allFinished = {
      todaysGames:   [{ status: "finished" }],
      upcomingGames: [{ status: "finished" }],
    };
    expect(dashboardRefetchInterval(allFinished)).toBe(false);
  });
});
