import type { fixturesTable } from "@workspace/db";
import { mapStatus, type AfFixture } from "./fixtureReconciliation.js";

export type StoredNationalTeamFixture = Pick<
  typeof fixturesTable.$inferSelect,
  "apiFootballFixtureId" | "status" | "homeScore" | "awayScore" |
  "kickoff" | "kickoffTimeTbd" | "venue" | "city" | "ntLevel"
>;

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
