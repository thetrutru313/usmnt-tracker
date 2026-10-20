import { Temporal } from "@js-temporal/polyfill";

const FALLBACK_ZONE = "America/New_York";

/** Validate named IANA zones, rather than accepting fixed UTC-offset strings. */
function viewerZone(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || /^[+-]/.test(value)) {
    return FALLBACK_ZONE;
  }
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return FALLBACK_ZONE;
  }
}

/** Half-open UTC interval for the viewer's actual calendar day (23/24/25 hours). */
export function viewerDay(tz: unknown, now = new Date()) {
  const timeZone = viewerZone(tz);
  const localNow = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(timeZone);
  const start = localNow.startOfDay();
  const end = start.add({ days: 1 }).startOfDay();
  return {
    timeZone,
    startOfDay: new Date(start.epochMilliseconds),
    endOfDay: new Date(end.epochMilliseconds),
    todayStr: localNow.toPlainDate().toString(),
  };
}
