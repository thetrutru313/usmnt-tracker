import { format } from "date-fns";

/** Returns "Today", "Tomorrow", or a formatted day label — all based on the UTC calendar date. */
export function utcDateLabel(dateStr: string): string {
  const todayUtc = new Date().toISOString().substring(0, 10);
  const tomorrowUtc = new Date(Date.now() + 86400000).toISOString().substring(0, 10);
  if (dateStr === todayUtc) return "Today";
  if (dateStr === tomorrowUtc) return "Tomorrow";
  // Build a local-midnight Date from the UTC year/month/day so format() displays the right weekday/day.
  const [y, m, d] = dateStr.split("-").map(Number);
  return format(new Date(y, m - 1, d), "EEEE, MMMM d");
}
