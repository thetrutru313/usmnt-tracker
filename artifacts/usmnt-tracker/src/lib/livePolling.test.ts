import { describe, it, expect } from "vitest";
import { fixtureRefetchInterval, LIVE_POLL_INTERVAL } from "./livePolling";

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
