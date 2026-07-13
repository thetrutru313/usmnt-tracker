// Arizona (America/Phoenix) observes no daylight saving time, so it stays on
// MST year-round — using it as the IANA zone guarantees a fixed UTC-7 offset.
const MST_TIME_ZONE = "America/Phoenix";

/**
 * Formats a date/kickoff time in Mountain Standard Time (MST), e.g. "Jul 13, 2:00 PM MST".
 */
export function formatKickoffMst(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: MST_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${formatted} MST`;
}

/**
 * Formats just the time portion in MST, e.g. "2:00 PM MST".
 */
export function formatTimeMst(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: MST_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${formatted} MST`;
}
