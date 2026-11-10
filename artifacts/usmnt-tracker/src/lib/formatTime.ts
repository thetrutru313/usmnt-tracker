/** Returns the viewer's own IANA timezone. */
function localTz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Format the clock and its abbreviation together at the supplied instant. */
function formatWithZone(date: Date, options: Intl.DateTimeFormatOptions): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: localTz(),
    ...options,
    timeZoneName: "short",
  }).formatToParts(date);
  // formatToParts may use a narrow space before AM/PM; preserve the existing
  // format() output's ordinary spacing.
  return parts.map((part) => part.value).join("").replace(/\u202f/g, " ");
}

/** "Jul 13, 2:00 PM PDT" */
export function formatKickoff(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return formatWithZone(date, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "Jul 16" */
export function formatDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: localTz(),
    month: "short",
    day: "numeric",
  }).format(date);
}

/** "2:00 PM PDT" */
export function formatTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return formatWithZone(date, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * A calendar date ("2026-11-08", or the API's "2026-11-08T00:00:00.000Z" for
 * date-only fields) as local midnight on that day. `new Date("2026-11-08")` is
 * UTC midnight, which shows as Nov 7 anywhere in the Americas.
 */
export function dateOnly(value: string | Date): Date {
  const iso = typeof value === "string" ? value : value.toISOString();
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}
