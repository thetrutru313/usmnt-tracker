import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDate, formatKickoff, formatTime } from "../lib/formatTime";

function viewerZone(timeZone: string) {
  const options = new Intl.DateTimeFormat().resolvedOptions();
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
    .mockReturnValue({ ...options, timeZone });
}

beforeEach(() => {
  // Freeze Date only: this tests abbreviation derivation, not timer lifecycles.
  vi.useFakeTimers({ toFake: ["Date"] });
  viewerZone("America/New_York");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("fixture time formatting — abbreviation at the fixture instant", () => {
  it("8: October clock formats a November kickoff as 7:00 PM EST", () => {
    vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
    const value = "2026-11-18T00:00:00Z";
    expect(formatTime(value)).toBe("7:00 PM EST");
    expect(formatKickoff(value)).toBe("Nov 17, 7:00 PM EST");
    expect(formatTime(new Date(value))).toBe("7:00 PM EST");
    expect(formatDate(value)).toBe("Nov 17");
  });

  it("9: November clock formats a September kickoff as EDT", () => {
    vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
    const value = "2026-09-26T20:30:00Z";
    expect(formatTime(value)).toBe("4:30 PM EDT");
    expect(formatKickoff(value)).toBe("Sep 26, 4:30 PM EDT");
    expect(formatKickoff(new Date(value))).toBe("Sep 26, 4:30 PM EDT");
    expect(formatDate(value)).toBe("Sep 26");
  });

  it("10: Phoenix stays MST with either clock and either fixture date", () => {
    viewerZone("America/Phoenix");
    for (const now of ["2026-10-07T12:00:00Z", "2026-11-20T12:00:00Z"]) {
      vi.setSystemTime(new Date(now));
      expect(formatTime("2026-11-18T00:00:00Z")).toBe("5:00 PM MST");
      expect(formatKickoff("2026-11-18T00:00:00Z")).toBe("Nov 17, 5:00 PM MST");
      expect(formatTime("2026-09-26T20:30:00Z")).toBe("1:30 PM MST");
      expect(formatKickoff("2026-09-26T20:30:00Z")).toBe("Sep 26, 1:30 PM MST");
      expect(formatDate("2026-11-18T00:00:00Z")).toBe("Nov 17");
    }
  });
});
