/**
 * Unit tests for `isLikelyNationalTeamName` — the name-pattern guard that
 * identifies national and women's team entries in API-Football squad data.
 *
 * ## Why this matters
 * `fetchPlayerCurrentTeam` calls `isNationalTeamId` for every squad entry it
 * receives, and `isNationalTeamId` falls back to `isLikelyNationalTeamName`
 * when the `/teams?id=` API returns the wrong `national` flag (e.g. US U20
 * returns `national=false` despite being a youth national team).
 *
 * Two bugs this guard prevents:
 *  1. International-window blind spot — during Gold Cup / Nations League,
 *     API-Football's `/players/squads` returns only national-team entries for
 *     called-up players.  If the guard misses a national team name, the sync
 *     assigns a player to the national team instead of their real club.
 *  2. Women's-club leakage — if `isLikelyNationalTeamName` does not block " W"
 *     suffixes, a male player with a wrong api_football_player_id that maps to
 *     a women's team (e.g. Cole Campbell → Houston Dash W) permanently inherits
 *     the women's club name on every sync.
 *
 * ## What is tested
 *  • Women's sides:  "Houston Dash W", "USA W", "Germany W" → true
 *  • Senior US national teams:  "USA", "United States" (exact) → true
 *  • Youth national teams:  "US U20", "Germany U18", "USA U17",
 *    "United States U23" → true
 *  • Real clubs that share a pattern prefix:
 *      "Houston Dash" (no " W" suffix) → false
 *      "United States Postal FC" (contains "United States" but not exact) → false
 *      "LA Galaxy", "Benfica B", "Los Angeles FC II" → false
 *  • Edge cases:  empty string, lowercase "usa", mixed case " w" suffix → false
 *    (the function only matches the exact patterns documented in its JSDoc)
 */

import { describe, it, expect } from "vitest";
import { isLikelyNationalTeamName } from "../apiFootballSync.js";

// ---------------------------------------------------------------------------
// Women's sides — trailing " W"
// ---------------------------------------------------------------------------

describe('isLikelyNationalTeamName — women\'s " W" suffix guard', () => {
  it('returns true for "Houston Dash W" (women\'s club)', () => {
    expect(isLikelyNationalTeamName("Houston Dash W")).toBe(true);
  });

  it('returns true for "USA W" (women\'s national team)', () => {
    expect(isLikelyNationalTeamName("USA W")).toBe(true);
  });

  it('returns true for "Germany W" (women\'s national team)', () => {
    expect(isLikelyNationalTeamName("Germany W")).toBe(true);
  });

  it('returns true for "Spain W" (women\'s national team)', () => {
    expect(isLikelyNationalTeamName("Spain W")).toBe(true);
  });

  it('returns false for "Houston Dash" (real men\'s-league club — no " W" suffix)', () => {
    expect(isLikelyNationalTeamName("Houston Dynamo")).toBe(false);
  });

  it('returns false for "Houston Dash" (no trailing " W")', () => {
    expect(isLikelyNationalTeamName("Houston Dash")).toBe(false);
  });

  it('returns false for a name ending in "w" (lowercase — guard is case-sensitive on suffix)', () => {
    // The guard checks trimmed.endsWith(" W") — capital W only.
    expect(isLikelyNationalTeamName("Some FC w")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Senior US national teams — exact match
// ---------------------------------------------------------------------------

describe("isLikelyNationalTeamName — senior US national team (exact match)", () => {
  it('returns true for "USA" (exact)', () => {
    expect(isLikelyNationalTeamName("USA")).toBe(true);
  });

  it('returns true for "United States" (exact)', () => {
    expect(isLikelyNationalTeamName("United States")).toBe(true);
  });

  it('returns false for "United States Postal FC" (contains "United States" but not exact)', () => {
    // Guard uses exact match; substring matches must not fire.
    expect(isLikelyNationalTeamName("United States Postal FC")).toBe(false);
  });

  it('returns false for "USA FC" (contains "USA" as prefix but not exact)', () => {
    expect(isLikelyNationalTeamName("USA FC")).toBe(false);
  });

  it('returns false for "usa" (lowercase — guard is case-sensitive for exact match)', () => {
    expect(isLikelyNationalTeamName("usa")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Youth national teams — "U" + 2-digit age group
// ---------------------------------------------------------------------------

describe("isLikelyNationalTeamName — youth national team suffix (UXX)", () => {
  it('returns true for "US U20"', () => {
    expect(isLikelyNationalTeamName("US U20")).toBe(true);
  });

  it('returns true for "USA U17"', () => {
    expect(isLikelyNationalTeamName("USA U17")).toBe(true);
  });

  it('returns true for "United States U23"', () => {
    expect(isLikelyNationalTeamName("United States U23")).toBe(true);
  });

  it('returns true for "Germany U18"', () => {
    expect(isLikelyNationalTeamName("Germany U18")).toBe(true);
  });

  it('returns true for "England U21"', () => {
    expect(isLikelyNationalTeamName("England U21")).toBe(true);
  });

  it('returns true for "France U19"', () => {
    expect(isLikelyNationalTeamName("France U19")).toBe(true);
  });

  // Intentionally also matches reserve/academy sides — documented acceptable
  // side-effect in the JSDoc (they're preserved via the stored club_id fallback).
  it('returns true for "RB Leipzig U19" (reserve side — acceptable per spec)', () => {
    expect(isLikelyNationalTeamName("RB Leipzig U19")).toBe(true);
  });

  it('returns false for "Los Angeles FC U13" (U13 is outside the U15–U23 band the guard matches)', () => {
    expect(isLikelyNationalTeamName("Los Angeles FC U13")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Real clubs — must return false
// ---------------------------------------------------------------------------

describe("isLikelyNationalTeamName — real club names must not be filtered", () => {
  const realClubs = [
    "LA Galaxy",
    "Inter Miami CF",
    "FC Copenhagen",
    "Lyngby Boldklub",
    "Benfica",
    "Benfica B",
    "FC St. Gallen",
    "CF Montréal",
    "AZ Alkmaar",
    "Randers FC",
    "FC Dallas",
    "Guadalajara",
    "Norwich City",
    "Monterrey",
    "Toluca",
    "Borussia Dortmund",
    "PSV Eindhoven",
    "Fulham",
    "AC Milan",
    "Los Angeles FC II",
    "Real Salt Lake",
    "San Diego FC",
    "Philadelphia Union",
    "Seattle Sounders FC",
    "Columbus Crew",
  ];

  for (const club of realClubs) {
    it(`returns false for real club "${club}"`, () => {
      expect(isLikelyNationalTeamName(club)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("isLikelyNationalTeamName — edge cases", () => {
  it("returns false for empty string", () => {
    expect(isLikelyNationalTeamName("")).toBe(false);
  });

  it("returns false for a string that is only whitespace", () => {
    // trimmed will be "", which is not "USA" or "United States" and doesn't
    // match the regex or endsWith patterns.
    expect(isLikelyNationalTeamName("   ")).toBe(false);
  });

  it('returns true for "USA" with surrounding whitespace (trimmed)', () => {
    // The function trims before comparing.
    expect(isLikelyNationalTeamName("  USA  ")).toBe(true);
  });

  it('returns true for "Houston Dash W" with surrounding whitespace (trimmed)', () => {
    expect(isLikelyNationalTeamName("  Houston Dash W  ")).toBe(true);
  });
});
