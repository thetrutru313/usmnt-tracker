import { useState, useEffect, useRef } from "react";

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
