/**
 * Regression guard for the DUAL_NATIONAL false-positive bug: club
 * competitions whose names contain national-team-sounding keywords
 * ("CONCACAF Champions League", "FIFA Club World Cup") were previously
 * enough, on their own, to flag a capped USMNT international as a dual
 * national. `isNationalTeamComp(league.name)` is now only a cheap
 * pre-filter — the actual gate is team identity, resolved via an injected
 * `resolveIsNational(teamId, teamName)` stub here (no real DB/network).
 */

import { describe, it, expect } from "vitest";
import {
  detectSeniorNonUsCaps,
  countNationalTeamCaps,
  type StatBlock,
  type TeamIsNationalResolver,
} from "../evaluateEligibility";

// Real API-Football team ids, confirmed live during the investigation:
const SEATTLE_SOUNDERS_ID = 1595; // club — national: false
const LAFC_ID = 1616; // club — national: false
const CANADA_ID = 5529; // national team — national: true
const USA_ID = 2384; // national team — national: true

function stat(teamId: number, teamName: string, leagueName: string, lineups = 1): StatBlock {
  return {
    team: { id: teamId, name: teamName },
    league: { name: leagueName, season: 2026 },
    games: { lineups, minutes: lineups * 90, position: "MF", rating: null },
  };
}

/** Resolver stub keyed by team id, standing in for the real DB-cached
 *  API-Football lookup — mirrors exactly what `isTeamNational` would
 *  ultimately return for these ids in production. */
function idResolver(nationalIds: number[]): TeamIsNationalResolver {
  return async (teamId) => teamId != null && nationalIds.includes(teamId);
}

describe("team-identity gate — club competitions no longer masquerade as national-team caps", () => {
  it("Seattle Sounders (club) in the CONCACAF Champions League does NOT count as a senior non-US cap", async () => {
    const statistics = [stat(SEATTLE_SOUNDERS_ID, "Seattle Sounders", "CONCACAF Champions League", 3)];
    const resolver = idResolver([CANADA_ID, USA_ID]);
    expect(await detectSeniorNonUsCaps(statistics, resolver)).toBe(false);
  });

  it("LAFC (club) in the FIFA Club World Cup does NOT count as a senior non-US cap", async () => {
    const statistics = [stat(LAFC_ID, "Los Angeles FC", "FIFA Club World Cup", 2)];
    const resolver = idResolver([CANADA_ID, USA_ID]);
    expect(await detectSeniorNonUsCaps(statistics, resolver)).toBe(false);
  });

  it("Canada (genuine national team) in the CONCACAF Nations League DOES count as a senior non-US cap", async () => {
    const statistics = [stat(CANADA_ID, "Canada", "CONCACAF Nations League", 2)];
    const resolver = idResolver([CANADA_ID, USA_ID]);
    expect(await detectSeniorNonUsCaps(statistics, resolver)).toBe(true);
  });

  it("USA in the CONCACAF Gold Cup is not counted as a non-US cap (it's excluded by name regardless of team identity)", async () => {
    const statistics = [stat(USA_ID, "USA", "CONCACAF Gold Cup", 2)];
    const resolver = idResolver([CANADA_ID, USA_ID]);
    expect(await detectSeniorNonUsCaps(statistics, resolver)).toBe(false);
  });

  it("a youth block ('United States U20') does not count as a senior cap, and increments priorYouthNtCaps instead", async () => {
    const statistics = [stat(USA_ID, "United States U20", "CONCACAF U20 Championship", 4)];
    const resolver = idResolver([CANADA_ID, USA_ID]);

    expect(await detectSeniorNonUsCaps(statistics, resolver)).toBe(false);

    const { seniorCaps, youthCaps } = await countNationalTeamCaps(statistics, resolver);
    expect(seniorCaps).toBe(0);
    expect(youthCaps).toBe(4);
  });

  it("countNationalTeamCaps does not credit a club competition toward either bucket, even with NT-sounding league names", async () => {
    const statistics = [
      stat(SEATTLE_SOUNDERS_ID, "Seattle Sounders", "CONCACAF Champions League", 5),
      stat(LAFC_ID, "Los Angeles FC", "FIFA Club World Cup", 3),
    ];
    const resolver = idResolver([CANADA_ID, USA_ID]);
    const { seniorCaps, youthCaps } = await countNationalTeamCaps(statistics, resolver);
    expect(seniorCaps).toBe(0);
    expect(youthCaps).toBe(0);
  });

  it("countNationalTeamCaps credits a genuine senior national-team cap once team identity is confirmed", async () => {
    const statistics = [stat(CANADA_ID, "Canada", "CONCACAF Nations League", 2)];
    const resolver = idResolver([CANADA_ID, USA_ID]);
    const { seniorCaps, youthCaps } = await countNationalTeamCaps(statistics, resolver);
    expect(seniorCaps).toBe(2);
    expect(youthCaps).toBe(0);
  });

  it("a stat block with no team id fails closed (does not count) rather than guessing", async () => {
    const statistics: StatBlock[] = [
      {
        team: { name: "Unknown Team" },
        league: { name: "CONCACAF Nations League", season: 2026 },
        games: { lineups: 3, minutes: 270, position: "MF", rating: null },
      },
    ];
    const resolver = idResolver([CANADA_ID, USA_ID]);
    expect(await detectSeniorNonUsCaps(statistics, resolver)).toBe(false);
  });
});
