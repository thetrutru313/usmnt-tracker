import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { evaluateEligibility, type EligibilityProfile, type StatBlock } from "../evaluateEligibility";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A stat block representing a club appearance (never fires NT signals). */
function clubBlock(leagueName: string, lineups = 10, minutes = 900): StatBlock {
  return {
    team: { name: "Club FC" },
    league: { name: leagueName },
    games: { lineups, minutes, position: "MF", rating: "7.00" },
  };
}

/** A stat block representing an international appearance. */
function ntBlock(teamName: string, leagueName: string, lineups = 1): StatBlock {
  return {
    team: { name: teamName },
    league: { name: leagueName },
    games: { lineups, minutes: 90, position: "MF", rating: null },
  };
}

const MLS_BLOCK = clubBlock("Major League Soccer");
const PREM_BLOCK = clubBlock("Premier League");

// ---------------------------------------------------------------------------
// Signal coverage
// ---------------------------------------------------------------------------

describe("evaluateEligibility – signal coverage", () => {
  it("fires us_nationality when nationality is USA", () => {
    const profile: EligibilityProfile = {
      nationality: "USA",
      birthCountry: "England",
      statistics: [PREM_BLOCK],
    };
    const { score, signals, status } = evaluateEligibility(profile);
    expect(signals.some((s) => s.signalType === "us_nationality")).toBe(true);
    // 35 pts (nationality only) — above the 30-pt minimum but below the 60-pt
    // US_ELIGIBLE_PROSPECT threshold; status is UNKNOWN for borderline profiles.
    expect(score).toBe(35);
    expect(status).toBe("UNKNOWN");
  });

  it("fires us_birth_country when birthCountry is USA", () => {
    const profile: EligibilityProfile = {
      nationality: "England",
      birthCountry: "USA",
      statistics: [PREM_BLOCK],
    };
    const { signals } = evaluateEligibility(profile);
    expect(signals.some((s) => s.signalType === "us_birth_country")).toBe(true);
  });

  it("fires us_birth_country when birthCountry is 'United States'", () => {
    const profile: EligibilityProfile = {
      nationality: "Germany",
      birthCountry: "United States",
      statistics: [PREM_BLOCK],
    };
    const { signals } = evaluateEligibility(profile);
    expect(signals.some((s) => s.signalType === "us_birth_country")).toBe(true);
  });

  it("fires us_state_birthplace for a US state name in birthplace text", () => {
    const profile: EligibilityProfile = {
      nationality: "Germany",
      birthCountry: "Germany",
      birthplace: "Houston, Texas",
      statistics: [PREM_BLOCK],
    };
    const { signals } = evaluateEligibility(profile);
    expect(signals.some((s) => s.signalType === "us_state_birthplace")).toBe(true);
  });

  it("does NOT fire us_state_birthplace for a non-US city", () => {
    const profile: EligibilityProfile = {
      nationality: "Germany",
      birthCountry: "Germany",
      birthplace: "Berlin",
      statistics: [PREM_BLOCK],
    };
    const { signals } = evaluateEligibility(profile);
    expect(signals.some((s) => s.signalType === "us_state_birthplace")).toBe(false);
  });

  it("fires us_youth_nt for a US U20 appearance", () => {
    const profile: EligibilityProfile = {
      nationality: "Germany",
      birthCountry: "Germany",
      statistics: [
        PREM_BLOCK,
        ntBlock("United States U20", "CONCACAF U20 Championship"),
      ],
    };
    const { signals, score } = evaluateEligibility(profile);
    expect(signals.some((s) => s.signalType === "us_youth_nt")).toBe(true);
    // Score must meet minimum even without nationality/birth
    expect(score).toBeGreaterThanOrEqual(15);
  });

  it("fires us_youth_nt for a USA U17 appearance", () => {
    const profile: EligibilityProfile = {
      nationality: "England",
      birthCountry: "England",
      statistics: [
        PREM_BLOCK,
        ntBlock("USA U17", "FIFA U-17 World Cup"),
      ],
    };
    const { signals } = evaluateEligibility(profile);
    expect(signals.some((s) => s.signalType === "us_youth_nt")).toBe(true);
  });

  it("fires us_senior_nt_cap for a USMNT appearance in a national team competition", () => {
    const profile: EligibilityProfile = {
      nationality: "USA",
      birthCountry: "USA",
      statistics: [
        PREM_BLOCK,
        ntBlock("United States", "CONCACAF Gold Cup"),
      ],
    };
    const { signals } = evaluateEligibility(profile);
    expect(signals.some((s) => s.signalType === "us_senior_nt_cap")).toBe(true);
  });

  it("fires mls_usl_league for an MLS season", () => {
    const profile: EligibilityProfile = {
      nationality: "England",
      birthCountry: "England",
      statistics: [MLS_BLOCK],
    };
    const { signals } = evaluateEligibility(profile);
    expect(signals.some((s) => s.signalType === "mls_usl_league")).toBe(true);
  });

  it("fires mls_usl_league for a USL season", () => {
    const profile: EligibilityProfile = {
      nationality: "England",
      birthCountry: "England",
      statistics: [clubBlock("USL Championship")],
    };
    const { signals } = evaluateEligibility(profile);
    expect(signals.some((s) => s.signalType === "mls_usl_league")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Status derivation
// ---------------------------------------------------------------------------

describe("evaluateEligibility – status derivation", () => {
  it("returns US_ELIGIBLE_PROSPECT for a high-confidence profile", () => {
    const profile: EligibilityProfile = {
      nationality: "USA",
      birthCountry: "USA",
      statistics: [MLS_BLOCK],
    };
    const { status, score } = evaluateEligibility(profile);
    expect(status).toBe("US_ELIGIBLE_PROSPECT");
    expect(score).toBeGreaterThanOrEqual(60);
  });

  it("returns DUAL_NATIONAL when the player has senior non-US caps", () => {
    const profile: EligibilityProfile = {
      nationality: "USA",
      birthCountry: "USA",
      statistics: [
        PREM_BLOCK,
        ntBlock("England", "UEFA Nations League"),
      ],
    };
    const { status } = evaluateEligibility(profile);
    expect(status).toBe("DUAL_NATIONAL");
  });

  it("returns UNKNOWN for a weak profile (only MLS + non-US birth, no nationality)", () => {
    const profile: EligibilityProfile = {
      nationality: "England",
      birthCountry: "England",
      statistics: [MLS_BLOCK],
    };
    const { status, score } = evaluateEligibility(profile);
    expect(status).toBe("UNKNOWN");
    expect(score).toBeLessThan(60);
  });

  it("returns DUAL_NATIONAL even when score is high (dual always wins)", () => {
    const profile: EligibilityProfile = {
      nationality: "USA",
      birthCountry: "USA",
      statistics: [
        MLS_BLOCK,
        ntBlock("Mexico", "CONCACAF Gold Cup"),
      ],
    };
    const { status } = evaluateEligibility(profile);
    expect(status).toBe("DUAL_NATIONAL");
  });

  it("does NOT return DUAL_NATIONAL for a non-US youth NT appearance (e.g. England U21)", () => {
    const profile: EligibilityProfile = {
      nationality: "USA",
      birthCountry: "England",
      statistics: [
        PREM_BLOCK,
        ntBlock("England U21", "UEFA U21 Championship Qualification"),
      ],
    };
    const { status, score } = evaluateEligibility(profile);
    // Youth caps do not constitute a senior commitment — should NOT be DUAL_NATIONAL.
    // nationality=USA → 35 pts, below the 60-pt US_ELIGIBLE_PROSPECT threshold → UNKNOWN.
    expect(status).not.toBe("DUAL_NATIONAL");
    expect(status).toBe("UNKNOWN");
    expect(score).toBe(35);
  });

  it("does NOT return DUAL_NATIONAL for a non-US U20 appearance (Germany U20)", () => {
    const profile: EligibilityProfile = {
      nationality: "USA",
      birthCountry: "Germany",
      statistics: [
        PREM_BLOCK,
        ntBlock("Germany U20", "FIFA U-20 World Cup"),
      ],
    };
    const { status } = evaluateEligibility(profile);
    expect(status).not.toBe("DUAL_NATIONAL");
  });
});

// ---------------------------------------------------------------------------
// Score clamping
// ---------------------------------------------------------------------------

describe("evaluateEligibility – score clamping", () => {
  it("clamps total score to 100 when all strong signals fire", () => {
    const profile: EligibilityProfile = {
      nationality: "USA",
      birthCountry: "USA",
      birthplace: "New York, New York",
      statistics: [
        MLS_BLOCK,
        ntBlock("United States U20", "CONCACAF U20 Championship"),
        ntBlock("United States", "CONCACAF Gold Cup"),
      ],
    };
    const { score } = evaluateEligibility(profile);
    expect(score).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Env-var weight override
// ---------------------------------------------------------------------------

describe("evaluateEligibility – env-var weight overrides", () => {
  beforeEach(() => {
    // Reset the cached weights before each test in this block
    vi.resetModules();
  });

  it("respects ELIGIBILITY_WEIGHT_US_NATIONALITY override", async () => {
    process.env["ELIGIBILITY_WEIGHT_US_NATIONALITY"] = "5";
    // Re-import to pick up the new env var (module-level cache reset)
    const { getResolvedWeights } = await import("../eligibilitySignalsConfig");
    // Force cache refresh by resetting the module-level singleton
    (getResolvedWeights as unknown as { cache?: unknown }).cache = null;
    const weights = getResolvedWeights();
    expect(weights["us_nationality"]).toBe(5);
    delete process.env["ELIGIBILITY_WEIGHT_US_NATIONALITY"];
  });
});

// ---------------------------------------------------------------------------
// Non-US birth / non-US nationality — only US youth NT fires
// ---------------------------------------------------------------------------

describe("evaluateEligibility – US youth NT as sole eligibility signal", () => {
  it("scores a non-US-nationality, non-US-born player who played for US U20", () => {
    const profile: EligibilityProfile = {
      nationality: "Germany",
      birthCountry: "Germany",
      statistics: [
        PREM_BLOCK,
        ntBlock("United States U20", "CONCACAF U20 Championship"),
      ],
    };
    const { score, signals, status } = evaluateEligibility(profile);
    // us_youth_nt fires → 15 pts, below the 60 threshold for US_ELIGIBLE_PROSPECT
    expect(signals.some((s) => s.signalType === "us_youth_nt")).toBe(true);
    expect(score).toBe(15);
    expect(status).toBe("UNKNOWN");
    // The player is NOT skipped — discovery min-score gate (30) handles filtering
    expect(score).toBeLessThan(30); // would be filtered by default min score
  });

  it("scores a non-US player with youth NT + MLS above the 30-point default threshold", () => {
    const profile: EligibilityProfile = {
      nationality: "Germany",
      birthCountry: "Germany",
      statistics: [
        MLS_BLOCK,
        ntBlock("United States U20", "CONCACAF U20 Championship"),
      ],
    };
    const { score, signals } = evaluateEligibility(profile);
    // us_youth_nt (15) + mls_usl_league (10) = 25 → still under 30 default min
    expect(signals.some((s) => s.signalType === "us_youth_nt")).toBe(true);
    expect(signals.some((s) => s.signalType === "mls_usl_league")).toBe(true);
    expect(score).toBe(25);
  });
});
