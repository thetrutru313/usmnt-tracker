/**
 * Schedule event windows, shared by the Schedule page (`GET /api/schedule`)
 * and the dashboard hero (`GET /api/dashboard`) so the two can't disagree.
 *
 * An event's matches run from UTC midnight on its startDate until 30 hours
 * after UTC midnight on its endDate. The extra 6 hours past the end day keep
 * late US kickoffs (10 PM ET on the endDate = 02:00 UTC the next day) inside
 * their event. No real fixture kicks off more than 30 h after UTC midnight on
 * the endDate, so this never pulls in the next event's matches.
 */

export const MATCH_WINDOW_HOURS_AFTER_END_DATE = 30;

/** Inclusive start of an event's match window. */
export function matchWindowStart(startDate: string): Date {
  return new Date(`${startDate}T00:00:00Z`);
}

/** Exclusive end of an event's match window. */
export function matchWindowEnd(endDate: string): Date {
  return new Date(
    Date.parse(`${endDate}T00:00:00Z`) + MATCH_WINDOW_HOURS_AFTER_END_DATE * 60 * 60 * 1000,
  );
}

type HeroCandidate = {
  status: string;
  startDate: string | null;
  endDate: string | null;
};

/**
 * Pick the dashboard hero ("NEXT UP") from events already in display order
 * (sortOrder, then startDate).
 *
 * - `tbd` events ("Possible Friendlies") never take the hero.
 * - With an endDate: shown until its match window closes.
 * - With only a startDate: shown from now until the next (non-tbd) event
 *   starts, so a long block such as World Cup qualifying stays up while it is
 *   being played.
 * - With no dates: always eligible.
 *
 * `todayStr` is the viewer's calendar day (YYYY-MM-DD, from viewerDay()).
 */
export function pickHeroEvent<T extends HeroCandidate>(
  events: readonly T[],
  now: Date,
  todayStr: string,
): T | undefined {
  const eligible = events.filter((e) => e.status !== "tbd");
  return eligible.find((e) => {
    if (e.endDate != null) return matchWindowEnd(e.endDate) > now;
    if (e.startDate == null) return true;
    if (e.startDate >= todayStr) return true;
    const start = e.startDate;
    const nextHasStarted = eligible.some(
      (other) => other.startDate != null && other.startDate > start && other.startDate <= todayStr,
    );
    return !nextHasStarted;
  });
}
