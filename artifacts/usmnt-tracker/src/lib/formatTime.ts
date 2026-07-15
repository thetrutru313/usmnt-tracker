/** Returns the user's IANA timezone and its current short abbreviation. */
function localTz(): { timeZone: string; abbr: string } {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(new Date());
  const abbr = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  return { timeZone, abbr };
}

/** "Jul 13, 2:00 PM PDT" */
export function formatKickoff(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const { timeZone, abbr } = localTz();
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${formatted} ${abbr}`;
}

/** "Jul 16" */
export function formatDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const { timeZone } = localTz();
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
  }).format(date);
}

/** "2:00 PM PDT" */
export function formatTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const { timeZone, abbr } = localTz();
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${formatted} ${abbr}`;
}
