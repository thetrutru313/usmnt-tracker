import { format } from "date-fns";

/** Returns "YYYY-MM-DD" in the viewer's local timezone. */
export function toLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Returns "Today", "Tomorrow", or a formatted day label — all based on the viewer's local calendar date. */
export function localDateLabel(dateStr: string): string {
  const today = toLocalDateStr(new Date());
  const tomorrow = toLocalDateStr(new Date(Date.now() + 86400000));
  if (dateStr === today) return "Today";
  if (dateStr === tomorrow) return "Tomorrow";
  // Build a local-midnight Date so format() renders the right weekday/day.
  const [y, m, d] = dateStr.split("-").map(Number);
  return format(new Date(y!, m! - 1, d), "EEEE, MMMM d");
}
