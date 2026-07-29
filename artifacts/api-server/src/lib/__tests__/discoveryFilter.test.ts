import { describe, it, expect, afterEach } from "vitest";
import { applyQualityGate, type AfDiscoveryStatBlock } from "../playerDiscovery";
import { evaluateEligibility, type EligibilityProfile } from "../evaluateEligibility";
import { getMinEligibilityScore, _resetWeightsCacheForTesting } from "../eligibilitySignalsConfig";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statBlock(
  overrides: Partial<AfDiscoveryStatBlock> & { leagueName?: string; lineups?: number; minutes?: number },
): AfDiscoveryStatBlock {
  return {
    team: { id: 1, name: "Club FC" },
    league: { name: overrides.leagueName ?? "Premier League", season: 2024 },
    games: {
      lineups: overrides.lineups ?? 0,
      minutes: overrides.minutes ?? 0,
      position: "MF",
      rating: null,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Quality gate — bench-warmer rejection
// ---------------------------------------------------------------------------

describe("discoveryFilter – quality gate rejects bench-warmers", () => {
  it("rejects a player with 0 lineups and 0 minutes across all stat blocks", () => {
    const statistics: AfDiscoveryStatBlock[] = [
      statBlock({ leagueName: "Premier League", lineups: 0, minutes: 0 }),
      statBlock({ leagueName: "Major League Soccer", lineups: 0, minutes: 0 }),
    ];
    const { passes, starts, minutes } = applyQualityGate(statistics);
    expect(passes).toBe(false);
    expect(starts).toBe(0);
    expect(minutes).toBe(0);
  });

  it("rejects a player with lineups below MIN_STARTS (5) and minutes below MIN_MINUTES (450)", () => {
    const statistics: AfDiscoveryStatBlock[] = [
      statBlock({ leagueName: "Premier League", lineups: 3, minutes: 270 }),
    ];
    const { passes, starts, minutes } = applyQualityGate(statistics);
    expect(passes).toBe(false);
    expect(starts).toBe(3);
    expect(minutes).toBe(270);
  });

  it("passes a player who meets MIN_STARTS (5) exactly", () => {
    const statistics: AfDiscoveryStatBlock[] = [
      statBlock({ leagueName: "Premier League", lineups: 5, minutes: 400 }),
    ];
    const { passes } = applyQualityGate(statistics);
    expect(passes).toBe(true);
  });

  it("passes a player who meets MIN_MINUTES (450) exactly even with fewer than 5 starts", () => {
    const statistics: AfDiscoveryStatBlock[] = [
      statBlock({ leagueName: "Premier League", lineups: 2, minutes: 450 }),
    ];
    const { passes } = applyQualityGate(statistics);
    expect(passes).toBe(true);
  });

  it("accumulates starts and minutes across multiple stat blocks", () => {
    const statistics: AfDiscoveryStatBlock[] = [
      statBlock({ leagueName: "Championship", lineups: 2, minutes: 180 }),
      statBlock({ leagueName: "Premier League", lineups: 2, minutes: 180 }),
    ];
    // 4 starts, 360 minutes — both below thresholds individually and combined
    const { passes, starts, minutes } = applyQualityGate(statistics);
    expect(starts).toBe(4);
    expect(minutes).toBe(360);
    expect(passes).toBe(false);
  });

  it("ignores friendly stat blocks when summing starts and minutes", () => {
    const statistics: AfDiscoveryStatBlock[] = [
      // Only a friendly appearance — should not count toward quality gate
      statBlock({ leagueName: "Club Friendly", lineups: 10, minutes: 900 }),
    ];
    const { passes, starts, minutes } = applyQualityGate(statistics);
    expect(passes).toBe(false);
    expect(starts).toBe(0);
    expect(minutes).toBe(0);
  });

  it("counts competitive minutes even when a friendly block also exists", () => {
    const statistics: AfDiscoveryStatBlock[] = [
      statBlock({ leagueName: "Club Friendly", lineups: 5, minutes: 450 }),
      statBlock({ leagueName: "Bundesliga", lineups: 5, minutes: 450 }),
    ];
    // Friendly is excluded; Bundesliga block alone satisfies both thresholds
    const { passes, starts } = applyQualityGate(statistics);
    expect(passes).toBe(true);
    expect(starts).toBe(5); // only the competitive block
  });

  it("passes a player with 50 substitute appearances (0 starts each, 10 min each = 500 min total)", () => {
    // 50 blocks × 0 lineups × 10 minutes — 0 starts but 500 minutes
    const statistics: AfDiscoveryStatBlock[] = Array.from({ length: 50 }, () =>
      statBlock({ leagueName: "Premier League", lineups: 0, minutes: 10 }),
    );
    const { passes, starts, minutes } = applyQualityGate(statistics);
    expect(starts).toBe(0);
    expect(minutes).toBe(500); // 50 × 10
    // minutes (500) >= MIN_MINUTES (450) → should pass despite 0 starts
    expect(passes).toBe(true);
  });

  it("rejects a player with 40 short appearances (0 starts each, 10 min each = 400 min total)", () => {
    // 40 blocks × 0 lineups × 10 minutes — 0 starts and only 400 minutes
    const statistics: AfDiscoveryStatBlock[] = Array.from({ length: 40 }, () =>
      statBlock({ leagueName: "Championship", lineups: 0, minutes: 10 }),
    );
    const { passes, starts, minutes } = applyQualityGate(statistics);
    expect(starts).toBe(0);
    expect(minutes).toBe(400); // 40 × 10
    // starts (0) < MIN_STARTS (5) AND minutes (400) < MIN_MINUTES (450) → should reject
    expect(passes).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Min-score gate — MLS-only profile is filtered
// ---------------------------------------------------------------------------

describe("discoveryFilter – min-score gate rejects low-evidence profiles", () => {
  afterEach(() => {
    delete process.env["ELIGIBILITY_MIN_SCORE"];
    _resetWeightsCacheForTesting();
  });

  it("default min-score is 30", () => {
    expect(getMinEligibilityScore()).toBe(30);
  });

  it("a foreign player whose only signal is mls_usl_league scores 10, below the 30-pt threshold", () => {
    const profile: EligibilityProfile = {
      nationality: "England",
      birthCountry: "England",
      statistics: [
        {
          team: { name: "Club FC" },
          league: { name: "Major League Soccer" },
          games: { lineups: 20, minutes: 1800, position: "FW", rating: "7.10" },
        },
      ],
    };
    const { score, signals } = evaluateEligibility(profile);
    const minScore = getMinEligibilityScore();

    expect(signals.some((s) => s.signalType === "mls_usl_league")).toBe(true);
    expect(score).toBe(10); // mls_usl_league weight = 10
    expect(score).toBeLessThan(minScore); // 10 < 30 → would be skipped by discovery
  });

  it("a completely foreign profile with no US signals scores 0, well below the 30-pt threshold", () => {
    const profile: EligibilityProfile = {
      nationality: "Germany",
      birthCountry: "Germany",
      statistics: [
        {
          team: { name: "Bayern Munich" },
          league: { name: "Bundesliga" },
          games: { lineups: 25, minutes: 2250, position: "CM", rating: "7.50" },
        },
      ],
    };
    const { score, signals } = evaluateEligibility(profile);
    const minScore = getMinEligibilityScore();

    expect(signals).toHaveLength(0);
    expect(score).toBe(0);
    expect(score).toBeLessThan(minScore);
  });

  it("a profile meeting the 30-pt threshold is not filtered (nationality=USA → 35 pts)", () => {
    const profile: EligibilityProfile = {
      nationality: "USA",
      birthCountry: "England",
      statistics: [
        {
          team: { name: "Club FC" },
          league: { name: "Premier League" },
          games: { lineups: 10, minutes: 900, position: "GK", rating: "7.20" },
        },
      ],
    };
    const { score } = evaluateEligibility(profile);
    const minScore = getMinEligibilityScore();

    expect(score).toBeGreaterThanOrEqual(minScore); // 35 ≥ 30 → passes
  });

  it("ELIGIBILITY_MIN_SCORE env var is respected for a custom threshold", () => {
    process.env["ELIGIBILITY_MIN_SCORE"] = "15";
    // At threshold 15, a mls_usl_league-only profile (10 pts) still fails; need one more signal
    const minScore = getMinEligibilityScore();
    expect(minScore).toBe(15);

    // A profile with us_state_birthplace (15 pts) alone would pass the 15-pt custom threshold
    const profile: EligibilityProfile = {
      nationality: "Germany",
      birthCountry: "Germany",
      birthplace: "Houston, Texas",
      statistics: [
        {
          team: { name: "Club FC" },
          league: { name: "Bundesliga" },
          games: { lineups: 10, minutes: 900, position: "MF", rating: null },
        },
      ],
    };
    const { score } = evaluateEligibility(profile);
    expect(score).toBe(15); // us_state_birthplace only
    expect(score).toBeGreaterThanOrEqual(minScore);
  });
});

// ---------------------------------------------------------------------------
// DUAL_NATIONAL — stored but flagged correctly regardless of score
// ---------------------------------------------------------------------------

describe("discoveryFilter – DUAL_NATIONAL candidates are flagged, not silently rejected", () => {
  it("a high-scoring player with senior non-US caps is flagged DUAL_NATIONAL", () => {
    const profile: EligibilityProfile = {
      nationality: "USA",
      birthCountry: "USA",
      statistics: [
        {
          team: { name: "Club FC" },
          league: { name: "Premier League" },
          games: { lineups: 20, minutes: 1800, position: "AM", rating: "7.80" },
        },
        {
          // Senior England cap — triggers DUAL_NATIONAL
          team: { name: "England" },
          league: { name: "UEFA Nations League" },
          games: { lineups: 3, minutes: 270, position: "AM", rating: null },
        },
      ],
    };
    const { score, status, signals } = evaluateEligibility(profile);
    const minScore = getMinEligibilityScore();

    // Score clears the min-score gate (nationality + birth country = 60)
    expect(score).toBeGreaterThanOrEqual(minScore);
    // Status must be DUAL_NATIONAL, not US_ELIGIBLE_PROSPECT
    expect(status).toBe("DUAL_NATIONAL");
    // US signals still fire — the candidate is stored, just flagged
    expect(signals.some((s) => s.signalType === "us_nationality")).toBe(true);
    expect(signals.some((s) => s.signalType === "us_birth_country")).toBe(true);
  });

  it("DUAL_NATIONAL flag wins over US_ELIGIBLE_PROSPECT even at maximum score", () => {
    const profile: EligibilityProfile = {
      nationality: "USA",
      birthCountry: "USA",
      birthplace: "Los Angeles, California",
      statistics: [
        {
          team: { name: "Club FC" },
          league: { name: "Major League Soccer" },
          games: { lineups: 25, minutes: 2250, position: "ST", rating: "7.90" },
        },
        {
          team: { name: "United States U20" },
          league: { name: "CONCACAF U20 Championship" },
          games: { lineups: 3, minutes: 270, position: "ST", rating: null },
        },
        {
          team: { name: "United States" },
          league: { name: "CONCACAF Gold Cup" },
          games: { lineups: 2, minutes: 180, position: "ST", rating: null },
        },
        {
          // Also played senior Mexico — DUAL_NATIONAL
          team: { name: "Mexico" },
          league: { name: "CONCACAF Gold Cup" },
          games: { lineups: 1, minutes: 90, position: "ST", rating: null },
        },
      ],
    };
    const { score, status } = evaluateEligibility(profile);

    expect(score).toBe(100); // clamped at maximum
    expect(status).toBe("DUAL_NATIONAL"); // dual always takes precedence
  });

  it("a borderline-score DUAL_NATIONAL still clears the min-score gate and is stored", () => {
    const profile: EligibilityProfile = {
      // Only us_birth_country fires (25 pts) — but dual national
      nationality: "Germany",
      birthCountry: "USA",
      statistics: [
        {
          team: { name: "Club FC" },
          league: { name: "Bundesliga" },
          games: { lineups: 15, minutes: 1350, position: "CB", rating: "7.30" },
        },
        {
          team: { name: "Germany" },
          league: { name: "UEFA Nations League" },
          games: { lineups: 2, minutes: 180, position: "CB", rating: null },
        },
      ],
    };
    const { score, status } = evaluateEligibility(profile);
    const minScore = getMinEligibilityScore();

    expect(score).toBe(25); // us_birth_country only
    expect(score).toBeLessThan(minScore); // 25 < 30 → filtered by min-score gate
    // Even though status shows DUAL_NATIONAL, the score gate prevents storage
    expect(status).toBe("DUAL_NATIONAL");
  });

  it("a DUAL_NATIONAL with enough score passes the gate and retains DUAL_NATIONAL status", () => {
    const profile: EligibilityProfile = {
      nationality: "USA",   // 35 pts
      birthCountry: "USA",  // 25 pts → total 60 → clears min-score gate
      statistics: [
        {
          team: { name: "Club FC" },
          league: { name: "Premier League" },
          games: { lineups: 10, minutes: 900, position: "LB", rating: "7.10" },
        },
        {
          team: { name: "Mexico" },
          league: { name: "CONCACAF Gold Cup" },
          games: { lineups: 1, minutes: 90, position: "LB", rating: null },
        },
      ],
    };
    const { score, status } = evaluateEligibility(profile);
    const minScore = getMinEligibilityScore();

    expect(score).toBeGreaterThanOrEqual(minScore); // 60 ≥ 30 → stored
    expect(status).toBe("DUAL_NATIONAL"); // flagged for operator review, not auto-promoted
  });
});
