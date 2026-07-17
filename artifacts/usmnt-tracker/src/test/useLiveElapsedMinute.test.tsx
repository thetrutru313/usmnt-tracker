/**
 * Unit tests for the `useLiveElapsedMinute` React hook.
 *
 * The hook provides a client-side minute counter that advances between server
 * polls so the LIVE badge stays current without extra API calls.
 *
 * Covered behaviours:
 *   • Returns null when the fixture is not live or has no elapsed minute
 *   • Returns the server-supplied minute immediately on mount
 *   • Increments the minute as wall-clock time advances (via fake timers)
 *   • Resets the offset when a fresh server minute arrives (poll completed)
 *   • Cleans up its interval on unmount (no state update after unmount)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLiveElapsedMinute } from "@/hooks/useLiveElapsedMinute";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useLiveElapsedMinute", () => {
  it("returns null when isLive is false", () => {
    const { result } = renderHook(() =>
      useLiveElapsedMinute(45, false),
    );
    expect(result.current).toBeNull();
  });

  it("returns null when elapsedMinute is null", () => {
    const { result } = renderHook(() =>
      useLiveElapsedMinute(null, true),
    );
    expect(result.current).toBeNull();
  });

  it("returns null when elapsedMinute is undefined", () => {
    const { result } = renderHook(() =>
      useLiveElapsedMinute(undefined, true),
    );
    expect(result.current).toBeNull();
  });

  it("returns the server-supplied minute immediately on mount", () => {
    const { result } = renderHook(() =>
      useLiveElapsedMinute(37, true),
    );
    expect(result.current).toBe(37);
  });

  it("still shows the same minute after less than 60 s have elapsed", () => {
    const { result } = renderHook(() =>
      useLiveElapsedMinute(37, true),
    );

    act(() => {
      vi.advanceTimersByTime(59_000);
    });

    expect(result.current).toBe(37);
  });

  it("increments the minute once after 60 s have elapsed", () => {
    const { result } = renderHook(() =>
      useLiveElapsedMinute(37, true),
    );

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current).toBe(38);
  });

  it("increments by 2 after 120 s have elapsed", () => {
    const { result } = renderHook(() =>
      useLiveElapsedMinute(37, true),
    );

    act(() => {
      vi.advanceTimersByTime(120_000);
    });

    expect(result.current).toBe(39);
  });

  it("resets the offset when a fresh server minute arrives", () => {
    let elapsedMinute = 37;

    const { result, rerender } = renderHook(() =>
      useLiveElapsedMinute(elapsedMinute, true),
    );

    // Advance 60 s → displayed minute should be 38
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(38);

    // Server poll delivers minute 45 (a jump e.g. extra-time start)
    elapsedMinute = 45;
    rerender();

    // The offset must reset: we are back to the server value
    expect(result.current).toBe(45);

    // Another 60 s → now 46, not a continuation of the old offset
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(46);
  });

  it("stops ticking and returns null when isLive transitions to false", () => {
    let isLive = true;

    const { result, rerender } = renderHook(() =>
      useLiveElapsedMinute(70, isLive),
    );

    expect(result.current).toBe(70);

    // Match ends
    isLive = false;
    rerender();

    expect(result.current).toBeNull();

    // Timers advancing should not change the result
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(result.current).toBeNull();
  });

  it("does not throw or update state after unmount (interval cleaned up)", () => {
    const { result, unmount } = renderHook(() =>
      useLiveElapsedMinute(50, true),
    );

    expect(result.current).toBe(50);

    unmount();

    // Advancing timers after unmount must not cause errors
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(300_000);
      });
    }).not.toThrow();
  });

  // ─── Long-running match (120+ minutes) ───────────────────────────────────

  it("stays within ±1 of the expected minute across a full 120-minute match with multiple poll cycles", () => {
    /**
     * Simulate a 120+ minute match:
     *   - 90 min at kick-off (server poll 1)
     *   - Poll at 91 min after 60 s of wall-clock time
     *   - Poll at 105 min (extra-time start, jump)
     *   - Poll at 106, 107, … through 120 min
     *
     * After each poll the displayed minute must be within ±1 of the
     * expected value (the hook increments on 5 s ticks, so up to 4 s
     * of rounding lag is possible at the boundary).
     */
    let serverMinute = 90;

    const { result, rerender } = renderHook(() =>
      useLiveElapsedMinute(serverMinute, true),
    );

    // Initial value matches the server
    expect(result.current).toBe(90);

    // ── First 60 s window: 90 → should display 91 ──
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(result.current).toBeGreaterThanOrEqual(90);
    expect(result.current).toBeLessThanOrEqual(91);

    // Server poll arrives: minute is now 91
    serverMinute = 91;
    rerender();
    expect(result.current).toBe(91);

    // ── Second 60 s window: 91 → should display 92 ──
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(result.current).toBeGreaterThanOrEqual(91);
    expect(result.current).toBeLessThanOrEqual(92);

    // Server poll: 92
    serverMinute = 92;
    rerender();
    expect(result.current).toBe(92);

    // ── Extra-time jump: server delivers 105 ──
    act(() => { vi.advanceTimersByTime(30_000); }); // 30 s into the window
    serverMinute = 105;
    rerender();
    // Offset resets; displayed minute should be exactly 105 (0 s elapsed since reset)
    expect(result.current).toBe(105);

    // ── 60 s into extra-time window ──
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(result.current).toBeGreaterThanOrEqual(105);
    expect(result.current).toBeLessThanOrEqual(106);

    // Server poll: 106
    serverMinute = 106;
    rerender();
    expect(result.current).toBe(106);

    // ── Simulate remaining extra-time minutes up to 120 ──
    for (let expected = 107; expected <= 120; expected++) {
      act(() => { vi.advanceTimersByTime(60_000); });
      // Allow ±1 for tick-boundary rounding
      expect(result.current).toBeGreaterThanOrEqual(expected - 1);
      expect(result.current).toBeLessThanOrEqual(expected);

      serverMinute = expected;
      rerender();
      expect(result.current).toBe(expected);
    }

    // ── 120+ (penalty shootout territory) ──
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(result.current).toBeGreaterThanOrEqual(120);
    expect(result.current).toBeLessThanOrEqual(121);
  });

  it("increments exactly at the 60 s boundary within a poll window", () => {
    /**
     * Verify the minute flips at precisely the 60 s wall-clock mark and not
     * before, using the 5 s internal tick granularity.
     */
    const { result } = renderHook(() =>
      useLiveElapsedMinute(45, true),
    );

    expect(result.current).toBe(45);

    // 55 s elapsed — still at 45
    act(() => { vi.advanceTimersByTime(55_000); });
    expect(result.current).toBe(45);

    // Advance 5 more seconds to reach the 60 s mark (one more tick)
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(result.current).toBe(46);

    // 59 s further (total 119 s) — still at 46
    act(() => { vi.advanceTimersByTime(59_000); });
    expect(result.current).toBe(46);

    // 1 more second (total 120 s, two full minutes)
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(result.current).toBe(47);
  });

  it("accumulated wall-clock offset resets cleanly on each new server poll", () => {
    /**
     * Ensures that after a mid-window poll delivers a new server minute, the
     * offset is counted fresh from that poll — the old wall-clock offset is
     * not compounded on top of the new server value.
     *
     * Scenario: at 90 s into the first poll window (1 displayed extra minute),
     * the server delivers 94.  The hook should reset to 94 immediately, and
     * only reach 95 after another full 60 s from that reset point.
     */
    let serverMinute = 93;

    const { result, rerender } = renderHook(() =>
      useLiveElapsedMinute(serverMinute, true),
    );

    // 90 s into the window: the hook has accumulated +1 minute of offset
    act(() => { vi.advanceTimersByTime(90_000); });
    expect(result.current).toBe(94); // 93 + floor(90/60) = 94

    // Server poll arrives with a genuinely new value (94)
    serverMinute = 94;
    rerender();

    // Offset must reset to zero from this new base: displayed value is 94,
    // NOT 94 + the old 1-minute offset = 95.
    expect(result.current).toBe(94);

    // Another 60 s → should reach 95 (not 96 or beyond)
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(result.current).toBe(95);
  });
});
