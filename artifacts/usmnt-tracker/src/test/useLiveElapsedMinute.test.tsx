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
import { useLiveElapsedMinute } from "@/lib/livePolling";

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
});
