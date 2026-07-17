/**
 * Shared helpers for live-match polling logic used by Fixtures and Dashboard pages.
 *
 * Extracted so the `refetchInterval` callbacks can be unit-tested without
 * rendering React components or importing the full API client.
 */

import { useState, useEffect, useRef } from "react";

export const LIVE_POLL_INTERVAL = 60_000; // 1 minute

/**
 * Returns a smoothly-incrementing elapsed minute for a live fixture.
 *
 * When a new `elapsedMinute` value arrives from the server (via a poll), the
 * hook resets its internal clock to that value.  Between polls it ticks every
 * 5 seconds and adds `floor(secondsSinceLastPoll / 60)` so the displayed
 * minute advances in real-time without any additional API calls.
 *
 * Returns `null` when the fixture is not live or no elapsed minute is known.
 */
export function useLiveElapsedMinute(
  elapsedMinute: number | null | undefined,
  isLive: boolean,
): number | null {
  // Record the wall-clock time at which this elapsedMinute value was received.
  const capturedAtRef = useRef<number | null>(null);
  const prevMinuteRef = useRef<number | null | undefined>(undefined);

  // Detect when the server sends a new elapsedMinute (poll completed).
  // We do this inline (not in an effect) so capturedAtRef is set before the
  // first render that uses it, avoiding a one-tick flicker.
  if (prevMinuteRef.current !== elapsedMinute) {
    prevMinuteRef.current = elapsedMinute;
    if (isLive && elapsedMinute != null) {
      capturedAtRef.current = Date.now();
    }
  }

  // Force a re-render every 5 s while the fixture is live so the displayed
  // minute stays current.  The interval is intentionally shorter than 60 s so
  // the minute flips over promptly rather than waiting for the next render.
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    if (!isLive || elapsedMinute == null) return;
    const id = setInterval(() => forceUpdate((n) => n + 1), 5_000);
    return () => clearInterval(id);
    // Re-create the interval whenever the server sends a fresh minute so the
    // offset calculation resets from the right base.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, elapsedMinute]);

  if (!isLive || elapsedMinute == null) {
    return null;
  }
  if (capturedAtRef.current == null) {
    return elapsedMinute;
  }

  const secondsElapsed = (Date.now() - capturedAtRef.current) / 1_000;
  return elapsedMinute + Math.floor(secondsElapsed / 60);
}

type WithStatus = { status: string };

/**
 * Returns the polling interval for the Fixtures page.
 *
 * - At least one fixture is not yet finished (scheduled, live, etc.)
 *   → poll every LIVE_POLL_INTERVAL ms so the LIVE badge appears within
 *     one poll cycle of a match kicking off, without needing a page reload.
 * - All fixtures are finished / no data yet → stop polling (false)
 */
export function fixturesRefetchInterval(
  data: WithStatus[] | undefined,
): number | false {
  return data?.some((f) => f.status !== "finished") ? LIVE_POLL_INTERVAL : false;
}

/**
 * Returns the polling interval for the Dashboard page.
 *
 * - At least one fixture in `todaysGames` or `upcomingGames` is not yet
 *   finished (scheduled, live, etc.) → poll every LIVE_POLL_INTERVAL ms so
 *   the LIVE badge appears within one poll cycle of a match kicking off,
 *   without needing a page reload.
 * - All fixtures are finished / no data yet → stop polling (false)
 */
export function dashboardRefetchInterval(
  data:
    | { todaysGames?: WithStatus[]; upcomingGames?: WithStatus[] }
    | undefined,
): number | false {
  const hasUnfinished =
    data?.todaysGames?.some((f) => f.status !== "finished") ||
    data?.upcomingGames?.some((f) => f.status !== "finished");
  return hasUnfinished ? LIVE_POLL_INTERVAL : false;
}
