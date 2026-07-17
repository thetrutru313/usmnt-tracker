/**
 * Shared helpers for live-match polling logic used by Fixtures and Dashboard pages.
 *
 * Extracted so the `refetchInterval` callbacks can be unit-tested without
 * rendering React components or importing the full API client.
 *
 * React-specific hooks (e.g. useLiveElapsedMinute) live in
 * `src/hooks/useLiveElapsedMinute.ts` to keep this file React-free.
 */

export const LIVE_POLL_INTERVAL = 60_000; // 1 minute

type WithStatus = { status: string };

/**
 * Terminal statuses that will never transition to live.
 * Polling should stop when the only non-finished fixtures have one of these
 * statuses, because they can never kick off.
 */
const TERMINAL_STATUSES = new Set(["finished", "postponed", "cancelled"]);

/**
 * Returns the polling interval for the Fixtures page.
 *
 * - At least one fixture is not yet in a terminal state (scheduled, live, etc.)
 *   → poll every LIVE_POLL_INTERVAL ms so the LIVE badge appears within
 *     one poll cycle of a match kicking off, without needing a page reload.
 * - All fixtures are finished, postponed, cancelled / no data yet → stop
 *   polling (false). Postponed and cancelled matches can never go live, so
 *   keeping the page polling indefinitely for them wastes quota and battery.
 */
export function fixturesRefetchInterval(
  data: WithStatus[] | undefined,
): number | false {
  return data?.some((f) => !TERMINAL_STATUSES.has(f.status))
    ? LIVE_POLL_INTERVAL
    : false;
}

/**
 * Returns the polling interval for the Dashboard page.
 *
 * - At least one fixture in `todaysGames` or `upcomingGames` is not yet in a
 *   terminal state (scheduled, live, etc.) → poll every LIVE_POLL_INTERVAL ms
 *   so the LIVE badge appears within one poll cycle of a match kicking off,
 *   without needing a page reload.
 * - All fixtures are finished, postponed, cancelled / no data yet → stop
 *   polling (false). Postponed and cancelled matches can never go live, so
 *   keeping the page polling indefinitely for them wastes quota and battery.
 */
export function dashboardRefetchInterval(
  data:
    | { todaysGames?: WithStatus[]; upcomingGames?: WithStatus[] }
    | undefined,
): number | false {
  const hasUnfinished =
    data?.todaysGames?.some((f) => !TERMINAL_STATUSES.has(f.status)) ||
    data?.upcomingGames?.some((f) => !TERMINAL_STATUSES.has(f.status));
  return hasUnfinished ? LIVE_POLL_INTERVAL : false;
}
