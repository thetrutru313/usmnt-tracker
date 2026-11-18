import type { fixturesTable } from "@workspace/db";
import { mapStatus, type AfFixture } from "./fixtureReconciliation.js";

export type StoredNationalTeamFixture = Pick<
  typeof fixturesTable.$inferSelect,
  "apiFootballFixtureId" | "status" | "homeScore" | "awayScore" |
  "kickoff" | "kickoffTimeTbd" | "venue" | "city" | "ntLevel"
> & Partial<Pick<typeof fixturesTable.$inferSelect, "homeTeam" | "awayTeam">>;

/** Pure calculation; binding and score/status behavior match the existing sync. */
export function nationalTeamFixtureUpdate(row: StoredNationalTeamFixture, match: AfFixture) {
  const status = mapStatus(match.fixture.status.short);
  const update: Partial<typeof fixturesTable.$inferInsert> = {
    status,
    homeScore: match.goals.home ?? null,
    awayScore: match.goals.away ?? null,
    elapsedMinute: status === "live" ? (match.fixture.status.elapsed ?? null) : null,
  };
  if (row.apiFootballFixtureId === null || row.apiFootballFixtureId <= 0) {
    update.apiFootballFixtureId = match.fixture.id;
    if (match.teams.home.logo) update.homeLogoUrl = match.teams.home.logo;
    if (match.teams.away.logo) update.awayLogoUrl = match.teams.away.logo;
    // Take the API's teams when the placeholder had no opponent yet ("USA vs
    // TBD") or listed the pair the other way round, so names match the logos
    // just taken from the API.
    if (row.homeTeam !== undefined && row.awayTeam !== undefined) {
      const apiHome = match.teams.home.name;
      const apiAway = match.teams.away.name;
      const hasTbd = row.homeTeam === "TBD" || row.awayTeam === "TBD";
      const reversed = apiHome !== apiAway && row.homeTeam === apiAway && row.awayTeam === apiHome;
      if (hasTbd || reversed) {
        update.homeTeam = apiHome;
        update.awayTeam = apiAway;
      }
    }
  }
  // Do not change club/youth/unclassified schedule details, or started games.
  if (row.ntLevel === "SENIOR" && row.status === "scheduled") {
    if (match.fixture.status.short === "NS") {
      const kickoff = new Date(match.fixture.date);
      if (kickoff.getTime() !== row.kickoff.getTime()) {
        update.kickoff = kickoff;
        update.kickoffTimeTbd = false;
      }
    }
    const venue = match.fixture.venue?.name;
    if (row.venue.trim().toLowerCase() === "tbd" && venue?.trim()) {
      update.venue = venue;
      update.city = match.fixture.venue.city ?? null;
    }
  }
  return update;
}
