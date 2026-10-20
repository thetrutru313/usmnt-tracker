import { describe, expect, it } from "vitest";
import { nationalTeamFixtureUpdate, type StoredNationalTeamFixture } from "../nationalTeamFixtureUpdate.js";
import type { AfFixture } from "../fixtureReconciliation.js";

const stored: StoredNationalTeamFixture = {
  apiFootballFixtureId: 1644693, ntLevel: "SENIOR",
  status: "scheduled", homeScore: null, awayScore: null,
  kickoff: new Date("2026-11-15T00:00:00Z"), kickoffTimeTbd: true,
  venue: "TBD", city: null,
};
const api = {
  fixture: {
    id: 1644693, date: "2026-11-14T21:00:00Z",
    status: { short: "NS", elapsed: null }, venue: { name: "X", city: "Y" },
  },
  teams: {
    home: { id: 2386, name: "Haiti", logo: "haiti.png" },
    away: { id: 2384, name: "USA", logo: "usa.png" },
  },
  league: { name: "CONCACAF Nations League" },
  goals: { home: null, away: null },
} satisfies AfFixture & { fixture: { venue: { city: string } } };

describe("senior NT schedule details", () => {
  it("1: NS replaces the placeholder kickoff and clears Time TBD", () => {
    const next = { ...stored, ...nationalTeamFixtureUpdate(stored, api) };
    expect(next.kickoff).toEqual(new Date(api.fixture.date));
    expect(next.kickoffTimeTbd).toBe(false);
  });
  it("2: fills TBD venue and its city", () => {
    const next = { ...stored, ...nationalTeamFixtureUpdate(stored, api) };
    expect(next).toMatchObject({ venue: "X", city: "Y" });
  });
  it("3: API TBD leaves kickoff and Time TBD unchanged", () => {
    const match = { ...api, fixture: { ...api.fixture, status: { short: "TBD", elapsed: null } } };
    const next = { ...stored, ...nationalTeamFixtureUpdate(stored, match) };
    expect(next.kickoff).toEqual(stored.kickoff);
    expect(next.kickoffTimeTbd).toBe(true);
  });
  it("4: never overwrites TQL Stadium or its city", () => {
    const row = { ...stored, venue: "TQL Stadium", city: "Cincinnati, OH" };
    expect({ ...row, ...nationalTeamFixtureUpdate(row, api) })
      .toMatchObject({ venue: "TQL Stadium", city: "Cincinnati, OH" });
  });
  it("5: never changes a finished fixture's kickoff or venue", () => {
    const row = { ...stored, status: "finished" };
    const next = { ...row, ...nationalTeamFixtureUpdate(row, api) };
    expect(next).toMatchObject({ kickoff: row.kickoff, kickoffTimeTbd: true, venue: "TBD", city: null });
  });
  it("preserves score, elapsed, and first-bind logo/id calculation", () => {
    const match = { ...api, fixture: { ...api.fixture, status: { short: "1H", elapsed: 32 } }, goals: { home: 0, away: 2 } };
    expect(nationalTeamFixtureUpdate({ ...stored, apiFootballFixtureId: -2005 }, match))
      .toMatchObject({ status: "live", homeScore: 0, awayScore: 2, elapsedMinute: 32,
        apiFootballFixtureId: 1644693, homeLogoUrl: "haiti.png", awayLogoUrl: "usa.png" });
    const bound = nationalTeamFixtureUpdate(stored, match);
    expect(bound).not.toHaveProperty("apiFootballFixtureId");
    expect(bound).not.toHaveProperty("homeLogoUrl");
    expect(bound).not.toHaveProperty("awayLogoUrl");
  });
  it("does not add schedule updates for youth or unclassified rows", () => {
    for (const ntLevel of ["U20", null]) {
      const row = { ...stored, ntLevel };
      expect({ ...row, ...nationalTeamFixtureUpdate(row, api) }).toMatchObject({
        kickoff: row.kickoff, kickoffTimeTbd: true, venue: "TBD", city: null,
      });
    }
  });
  it("accepts trimmed, case-insensitive TBD but rejects empty API venues", () => {
    expect(nationalTeamFixtureUpdate({ ...stored, venue: "  tBd " }, api))
      .toMatchObject({ venue: "X", city: "Y" });
    for (const name of ["", "  ", null]) {
      const match = { ...api, fixture: { ...api.fixture, venue: { name } } };
      expect(nationalTeamFixtureUpdate(stored, match)).not.toHaveProperty("venue");
    }
  });
  it("leaves Time TBD unchanged when NS kickoff has not changed", () => {
    const row = { ...stored, kickoff: new Date(api.fixture.date) };
    expect(nationalTeamFixtureUpdate(row, api)).not.toHaveProperty("kickoff");
    expect(nationalTeamFixtureUpdate(row, api)).not.toHaveProperty("kickoffTimeTbd");
  });
  it("leaves live and postponed schedule details alone", () => {
    for (const status of ["live", "postponed"]) {
      const row = { ...stored, status };
      const update = nationalTeamFixtureUpdate(row, api);
      expect(update).not.toHaveProperty("kickoff");
      expect(update).not.toHaveProperty("venue");
    }
  });
});
