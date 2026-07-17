import { describe, it, expect, vi, afterEach } from "vitest";
import { utcDateLabel } from "@/lib/dateLabels";

afterEach(() => {
  vi.useRealTimers();
});

describe("utcDateLabel", () => {
  it('returns "Today" for the current UTC date', () => {
    // Fix time to 2026-07-17T15:00:00Z
    vi.useFakeTimers({ now: new Date("2026-07-17T15:00:00Z") });
    expect(utcDateLabel("2026-07-17")).toBe("Today");
  });

  it('returns "Tomorrow" for the next UTC date', () => {
    vi.useFakeTimers({ now: new Date("2026-07-17T15:00:00Z") });
    expect(utcDateLabel("2026-07-18")).toBe("Tomorrow");
  });

  it("returns a formatted weekday label for past dates", () => {
    vi.useFakeTimers({ now: new Date("2026-07-17T15:00:00Z") });
    // 2026-07-15 is a Wednesday
    expect(utcDateLabel("2026-07-15")).toBe("Wednesday, July 15");
  });

  it("returns a formatted weekday label for future dates beyond tomorrow", () => {
    vi.useFakeTimers({ now: new Date("2026-07-17T15:00:00Z") });
    // 2026-07-20 is a Monday
    expect(utcDateLabel("2026-07-20")).toBe("Monday, July 20");
  });

  it('returns "Today" even when the clock is just before midnight UTC', () => {
    vi.useFakeTimers({ now: new Date("2026-07-17T23:59:59Z") });
    expect(utcDateLabel("2026-07-17")).toBe("Today");
  });

  it('returns "Tomorrow" correctly when today is the last day of the month', () => {
    vi.useFakeTimers({ now: new Date("2026-07-31T12:00:00Z") });
    expect(utcDateLabel("2026-08-01")).toBe("Tomorrow");
  });

  it("does not confuse today with tomorrow or vice versa", () => {
    vi.useFakeTimers({ now: new Date("2026-07-17T15:00:00Z") });
    expect(utcDateLabel("2026-07-17")).not.toBe("Tomorrow");
    expect(utcDateLabel("2026-07-18")).not.toBe("Today");
  });
});
