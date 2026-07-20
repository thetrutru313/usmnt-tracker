import { describe, it, expect, vi, afterEach } from "vitest";
import { localDateLabel, toLocalDateStr } from "@/lib/dateLabels";

afterEach(() => {
  vi.useRealTimers();
});

describe("localDateLabel", () => {
  it('returns "Today" for the current local date', () => {
    vi.useFakeTimers({ now: new Date("2026-07-17T15:00:00Z") });
    expect(localDateLabel(toLocalDateStr(new Date()))).toBe("Today");
  });

  it('returns "Tomorrow" for the next local date', () => {
    vi.useFakeTimers({ now: new Date("2026-07-17T15:00:00Z") });
    expect(localDateLabel(toLocalDateStr(new Date(Date.now() + 86400000)))).toBe("Tomorrow");
  });

  it("returns a formatted weekday label for past dates", () => {
    vi.useFakeTimers({ now: new Date("2026-07-17T15:00:00Z") });
    // 2026-07-15 is a Wednesday
    expect(localDateLabel("2026-07-15")).toBe("Wednesday, July 15");
  });

  it("returns a formatted weekday label for future dates beyond tomorrow", () => {
    vi.useFakeTimers({ now: new Date("2026-07-17T15:00:00Z") });
    // 2026-07-20 is a Monday
    expect(localDateLabel("2026-07-20")).toBe("Monday, July 20");
  });

  it('returns "Today" even when the clock is just before midnight local time', () => {
    vi.useFakeTimers({ now: new Date("2026-07-17T23:59:59Z") });
    expect(localDateLabel(toLocalDateStr(new Date()))).toBe("Today");
  });

  it('returns "Tomorrow" correctly when today is the last day of the month', () => {
    vi.useFakeTimers({ now: new Date("2026-07-31T12:00:00Z") });
    expect(localDateLabel(toLocalDateStr(new Date(Date.now() + 86400000)))).toBe("Tomorrow");
  });

  it("does not confuse today with tomorrow or vice versa", () => {
    vi.useFakeTimers({ now: new Date("2026-07-17T15:00:00Z") });
    const today = toLocalDateStr(new Date());
    const tomorrow = toLocalDateStr(new Date(Date.now() + 86400000));
    expect(localDateLabel(today)).not.toBe("Tomorrow");
    expect(localDateLabel(tomorrow)).not.toBe("Today");
  });
});
