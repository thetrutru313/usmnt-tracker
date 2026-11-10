/**
 * How a team is named to users (push alert titles). API-Football lists US
 * Soccer's Olympic-cycle squad as "USA U21" (2026 camps) or "United States U23"
 * (Olympic years); both show as the Olympic team. Stored names are unchanged:
 * the youth sync classifies and purges by them. Keep in sync with
 * artifacts/usmnt-tracker/src/lib/teamNames.ts.
 */
export const US_OLYMPIC_TEAM = "USA Olympic Team";

export function displayTeamName(name: string): string {
  return /^(USA|United States) U2[13]$/.test(name) ? US_OLYMPIC_TEAM : name;
}
