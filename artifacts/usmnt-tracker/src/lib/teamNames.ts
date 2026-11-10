/**
 * How a team is named in the app. API-Football lists US Soccer's Olympic-cycle
 * squad as "USA U21" (2026 camps) or "United States U23" (Olympic years); both
 * show as the Olympic team. Every other name is shown as stored. Keep in sync
 * with artifacts/api-server/src/lib/teamNames.ts (push alert titles).
 */
export const US_OLYMPIC_TEAM = "USA Olympic Team";

export function displayTeamName(name: string): string {
  return /^(USA|United States) U2[13]$/.test(name) ? US_OLYMPIC_TEAM : name;
}
