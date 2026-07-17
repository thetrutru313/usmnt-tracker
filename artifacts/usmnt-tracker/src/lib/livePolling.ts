/**
 * Shared helpers for live-match polling logic used by Fixtures and Dashboard pages.
 *
 * Extracted so the `refetchInterval` callbacks can be unit-tested without
 * rendering React components or importing the full API client.
 */

export const LIVE_POLL_INTERVAL = 60_000; // 1 minute

type WithStatus = { status: string };

/**
 * Returns the polling interval for the Fixtures page.
 *
 * - At least one fixture is `live`  → poll every LIVE_POLL_INTERVAL ms
 * - All fixtures are finished / no data yet → stop polling (false)
 */
export function fixturesRefetchInterval(
  data: WithStatus[] | undefined,
): number | false {
  return data?.some((f) => f.status === "live") ? LIVE_POLL_INTERVAL : false;
}

/**
 * Returns the polling interval for the Dashboard page.
 *
 * Checks both `todaysGames` and `upcomingGames` arrays for any live fixture.
 */
export function dashboardRefetchInterval(
  data:
    | { todaysGames?: WithStatus[]; upcomingGames?: WithStatus[] }
    | undefined,
): number | false {
  const hasLive =
    data?.todaysGames?.some((f) => f.status === "live") ||
    data?.upcomingGames?.some((f) => f.status === "live");
  return hasLive ? LIVE_POLL_INTERVAL : false;
}
