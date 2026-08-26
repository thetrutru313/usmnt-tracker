/**
 * Regression guard for three eligibility-correctness bugs fixed together:
 *
 * Bug 1 — `detectUsStateBirthplace` (in evaluateEligibility.ts) fired on
 * non-English place-name particles that collide with US state
 * abbreviations/names ("Rio de Janeiro" -> DE, "La Plata"/"La Paz" -> LA,
 * "Al Rayyan" -> AL, "Tbilisi, Georgia" -> Georgia). Fixed by only accepting
 * a two-letter abbreviation from the final (or pre-country) comma segment
 * when it was already uppercase in the source string, and by requiring
 * independent US evidence before "Georgia" counts as the state rather than
 * the country.
 *
 * Bug 2 — `playerDiscovery.ts` had its own, buggy senior-caps detector that
 * did not exclude youth national-team appearances, duplicating (and
 * disagreeing with) the correct `detectSeniorNonUsCaps` in
 * evaluateEligibility.ts. The buggy trio has been deleted; `playerDiscovery`
 * now imports `detectSeniorNonUsCaps`/`countNationalTeamCaps` from
 * evaluateEligibility.ts, and youth caps are tracked in a separate
 * `priorYouthNtCaps` counter instead of inflating the senior total.
 *
 * Bug 3 — candidate `age` was frozen at discovery time and never
 * recomputed, so a candidate could silently age past the cutoff without
 * ever being re-evaluated. Fixed by adding `date_of_birth`, computing age
 * live from it wherever an age gate is checked, and keeping the stored
 * `age` column as a display-only fallback for rows with no birth date on
 * file.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateEligibility,
  detectSeniorNonUsCaps,
  countNationalTeamCaps,
  type EligibilityProfile,
  type StatBlock,
} from "../evaluateEligibility";
import { ageFromBirthDate } from "../playerClubSync";

function baseProfile(overrides: Partial<EligibilityProfile>): EligibilityProfile {
  return {
    nationality: "USA",
    birthCountry: "USA",
    birthplace: null,
    statistics: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Bug 1 — us_state_birthplace false positives on non-English place names
// ---------------------------------------------------------------------------

describe("detectUsStateBirthplace (via evaluateEligibility's us_state_birthplace signal)", () => {
  async function fires(birthplace: string, birthCountry: string | null): Promise<boolean> {
    const result = await evaluateEligibility(baseProfile({ birthplace, birthCountry }));
    return result.signals.some((s) => s.signalType === "us_state_birthplace");
  }

  it("does NOT fire on 'Rio de Janeiro, Brazil' (De is not the Delaware abbreviation)", async () => {
    expect(await fires("Rio de Janeiro, Brazil", "Brazil")).toBe(false);
  });

  it("does NOT fire on 'La Plata, Argentina' (La is not the Louisiana abbreviation)", async () => {
    expect(await fires("La Plata, Argentina", "Argentina")).toBe(false);
  });

  it("does NOT fire on 'La Paz, Bolivia'", async () => {
    expect(await fires("La Paz, Bolivia", "Bolivia")).toBe(false);
  });

  it("does NOT fire on 'Al Rayyan, Qatar' (Al is not the Alabama abbreviation)", async () => {
    expect(await fires("Al Rayyan, Qatar", "Qatar")).toBe(false);
  });

  it("does NOT fire on 'Tbilisi, Georgia' with no US evidence (country Georgia, not the US state)", async () => {
    expect(await fires("Tbilisi, Georgia", "Georgia")).toBe(false);
  });

  it("still fires on a genuine two-letter state abbreviation as the final segment, e.g. 'Springfield, IL'", async () => {
    expect(await fires("Springfield, IL", "USA")).toBe(true);
  });

  it("still fires on a full state name embedded in a multi-word city, e.g. 'Maryland Heights, Missouri'", async () => {
    expect(await fires("Maryland Heights, Missouri", "USA")).toBe(true);
  });

  it("still fires on 'New York City' with confirmed US birth country", async () => {
    expect(await fires("New York City", "USA")).toBe(true);
  });

  it("fires on Georgia the US state when corroborated by a confirmed US birth country", async () => {
    expect(await fires("Atlanta, Georgia", "USA")).toBe(true);
  });

  it("still fires on a genuine uppercase state abbreviation even when birthCountry is a non-US country (birthCountry is not a blanket gate — only used to disambiguate 'Georgia')", async () => {
    expect(await fires("Berlin, GA", "Germany")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bug 2 — senior-caps detection must exclude youth national-team appearances
// ---------------------------------------------------------------------------

function natTeamStat(teamName: string, leagueName: string, lineups: number): StatBlock {
  return {
    team: { id: 1, name: teamName },
    league: { name: leagueName, season: 2026 },
    games: { lineups, minutes: lineups * 90, position: "MF", rating: null },
  };
}

// These fixtures reuse the same team.id (1) for every national-team block —
// they're testing the youth-vs-senior name split, not the team-identity
// gate (club vs. national by team.id), which has its own dedicated coverage
// in teamNationalityGate.test.ts. A stub resolver that always reports
// "national" keeps that distinction out of scope here.
const alwaysNational = async () => true;

describe("detectSeniorNonUsCaps / countNationalTeamCaps — youth appearances excluded from senior caps", () => {
  it("Brazil U17 World Cup appearances do not count as senior non-US caps", async () => {
    const statistics = [natTeamStat("Brazil U17", "FIFA U-17 World Cup", 3)];
    expect(await detectSeniorNonUsCaps(statistics, alwaysNational)).toBe(false);

    const { seniorCaps, youthCaps } = await countNationalTeamCaps(statistics, alwaysNational);
    expect(seniorCaps).toBe(0);
    expect(youthCaps).toBe(3);
  });

  it("evaluateEligibility does not classify a youth-only Brazil call-up as DUAL_NATIONAL", async () => {
    const result = await evaluateEligibility(
      baseProfile({ statistics: [natTeamStat("Brazil U17", "FIFA U-17 World Cup", 3)] }),
      alwaysNational,
    );
    expect(result.status).not.toBe("DUAL_NATIONAL");
  });

  it("a genuine senior non-US cap still triggers DUAL_NATIONAL and counts toward seniorCaps only", async () => {
    const statistics = [natTeamStat("Brazil", "World Cup Qualification", 2)];
    expect(await detectSeniorNonUsCaps(statistics, alwaysNational)).toBe(true);

    const { seniorCaps, youthCaps } = await countNationalTeamCaps(statistics, alwaysNational);
    expect(seniorCaps).toBe(2);
    expect(youthCaps).toBe(0);

    const result = await evaluateEligibility(baseProfile({ statistics }), alwaysNational);
    expect(result.status).toBe("DUAL_NATIONAL");
  });

  it("mixed senior + youth caps for the same country split into the correct buckets", async () => {
    const statistics = [
      natTeamStat("Brazil U20", "FIFA U-20 World Cup", 4),
      natTeamStat("Brazil", "Copa America", 1),
    ];
    const { seniorCaps, youthCaps } = await countNationalTeamCaps(statistics, alwaysNational);
    expect(seniorCaps).toBe(1);
    expect(youthCaps).toBe(4);
  });

  it("US youth-team appearances are excluded from senior caps just like any other country's youth team", async () => {
    const statistics = [natTeamStat("United States U20", "FIFA U-20 World Cup", 5)];
    expect(await detectSeniorNonUsCaps(statistics, alwaysNational)).toBe(false);
    const { seniorCaps, youthCaps } = await countNationalTeamCaps(statistics, alwaysNational);
    expect(seniorCaps).toBe(0);
    expect(youthCaps).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Bug 3 — age must be computed live from date_of_birth, not frozen at
// discovery time
// ---------------------------------------------------------------------------

describe("ageFromBirthDate overrides a stale stored age column", () => {
  it("computes a live age from date_of_birth that differs from (and overrides) a stale stored age", () => {
    const today = new Date();
    const twentyFourYearsAgo = new Date(
      Date.UTC(today.getUTCFullYear() - 24, today.getUTCMonth(), today.getUTCDate()),
    );
    const dateOfBirth = twentyFourYearsAgo.toISOString().slice(0, 10);

    const staleStoredAge = 22; // recorded at discovery time, never refreshed
    const liveAge = ageFromBirthDate(dateOfBirth) ?? staleStoredAge;

    expect(liveAge).toBe(24);
    expect(liveAge).not.toBe(staleStoredAge);

    const maxAge = 23;
    // The gate must treat this candidate as over-cap using the live age,
    // even though the stale stored age would have kept it under the cap.
    expect(liveAge > maxAge).toBe(true);
    expect(staleStoredAge > maxAge).toBe(false);
  });

  it("falls back to the stored age when no date_of_birth is on file", () => {
    const dateOfBirth: string | null = null;
    const storedAge = 22;
    const liveAge = ageFromBirthDate(dateOfBirth) ?? storedAge;
    expect(liveAge).toBe(storedAge);
  });
});
