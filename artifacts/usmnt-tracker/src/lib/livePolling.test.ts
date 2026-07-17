import { describe, it, expect } from "vitest";
import {
  fixtureRefetchInterval,
  fixturesRefetchInterval,
  dashboardRefetchInterval,
  LIVE_POLL_INTERVAL,
} from "./livePolling";

describe("fixtureRefetchInterval", () => {
  it('returns LIVE_POLL_INTERVAL when status is "live"', () => {
    expect(fixtureRefetchInterval({ status: "live" })).toBe(LIVE_POLL_INTERVAL);
  });

  it('returns false when status is "finished"', () => {
    expect(fixtureRefetchInterval({ status: "finished" })).toBe(false);
  });

  it('returns false when status is "scheduled"', () => {
    expect(fixtureRefetchInterval({ status: "scheduled" })).toBe(false);
  });

  it("returns false when data is undefined", () => {
    expect(fixtureRefetchInterval(undefined)).toBe(false);
  });
});

describe("fixturesRefetchInterval", () => {
  it('returns LIVE_POLL_INTERVAL when at least one fixture is "scheduled"', () => {
    expect(
      fixturesRefetchInterval([
        { status: "finished" },
        { status: "scheduled" },
      ]),
    ).toBe(LIVE_POLL_INTERVAL);
  });

  it('returns LIVE_POLL_INTERVAL when at least one fixture is "live"', () => {
    expect(
      fixturesRefetchInterval([{ status: "finished" }, { status: "live" }]),
    ).toBe(LIVE_POLL_INTERVAL);
  });

  it('returns false when all fixtures are "finished"', () => {
    expect(
      fixturesRefetchInterval([
        { status: "finished" },
        { status: "finished" },
      ]),
    ).toBe(false);
  });

  it('returns false when all fixtures are "postponed" or "cancelled"', () => {
    expect(
      fixturesRefetchInterval([
        { status: "postponed" },
        { status: "cancelled" },
      ]),
    ).toBe(false);
  });

  it("returns false when the array is empty", () => {
    expect(fixturesRefetchInterval([])).toBe(false);
  });

  it("returns false when data is undefined", () => {
    expect(fixturesRefetchInterval(undefined)).toBe(false);
  });
});

describe("dashboardRefetchInterval", () => {
  it('returns LIVE_POLL_INTERVAL when todaysGames has a "live" fixture', () => {
    expect(
      dashboardRefetchInterval({
        todaysGames: [{ status: "finished" }, { status: "live" }],
        upcomingGames: [],
      }),
    ).toBe(LIVE_POLL_INTERVAL);
  });

  it('returns LIVE_POLL_INTERVAL when upcomingGames has a "scheduled" fixture', () => {
    expect(
      dashboardRefetchInterval({
        todaysGames: [{ status: "finished" }],
        upcomingGames: [{ status: "scheduled" }],
      }),
    ).toBe(LIVE_POLL_INTERVAL);
  });

  it("returns false when all fixtures across both arrays are terminal", () => {
    expect(
      dashboardRefetchInterval({
        todaysGames: [{ status: "finished" }, { status: "postponed" }],
        upcomingGames: [{ status: "cancelled" }, { status: "finished" }],
      }),
    ).toBe(false);
  });

  it("returns false when both arrays are empty", () => {
    expect(
      dashboardRefetchInterval({ todaysGames: [], upcomingGames: [] }),
    ).toBe(false);
  });

  it("returns false when data is undefined", () => {
    expect(dashboardRefetchInterval(undefined)).toBe(false);
  });
});
