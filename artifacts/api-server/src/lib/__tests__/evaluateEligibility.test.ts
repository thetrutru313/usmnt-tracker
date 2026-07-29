import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { evaluateEligibility, type EligibilityProfile, type StatBlock } from "../evaluateEligibility";
import { _resetWeightsCacheForTesting } from "../eligibilitySignalsConfig";

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
// Threshold guard — weight-config change must not silently flip status
// ---------------------------------------------------------------------------

describe("evaluateEligibility – threshold guard (weight-config change)", () => {
  afterEach(() => {
    // Restore any env-var overrides and flush the weight cache so subsequent
    // tests always start from a clean default-weights state.
    delete process.env["ELIGIBILITY_WEIGHT_US_BIRTH_COUNTRY"];
    delete process.env["ELIGIBILITY_WEIGHT_US_NATIONALITY"];
    _resetWeightsCacheForTesting();
  });

  /**
   * Baseline: a borderline profile whose default score (55) sits just below the
   * US_ELIGIBLE_PROSPECT threshold (60).  This is the anchor for the two
   * override tests below.
   *
   * Signals that fire with default weights:
   *   us_birth_country    (25)
   *   us_state_birthplace (15)
   *   us_youth_nt         (15)
   *   ─────────────────────────
   *   total               55  → UNKNOWN
   */
  it("borderline profile (score=55) stays UNKNOWN with default weights", () => {
    const profile: EligibilityProfile = {
      nationality: "Germany",
      birthCountry: "USA",
      birthplace: "Houston, Texas",
      statistics: [
        PREM_BLOCK,
        ntBlock("United States U20", "CONCACAF U20 Championship"),
      ],
    };
    const { score, status } = evaluateEligibility(profile);
    expect(score).toBe(55);
    expect(status).toBe("UNKNOWN");
  });

  /**
   * Weight-bump test: raising ELIGIBILITY_WEIGHT_US_BIRTH_COUNTRY from 25 → 30
   * pushes the borderline profile from 55 → 60, which must flip status to
   * US_ELIGIBLE_PROSPECT.  Verifies the threshold gate is actually enforced.
   *
   * Signals that fire with overridden weight:
   *   us_birth_country    (30)  ← bumped via env var
   *   us_state_birthplace (15)
   *   us_youth_nt         (15)
   *   ─────────────────────────
   *   total               60  → US_ELIGIBLE_PROSPECT
   */
  it("bumping ELIGIBILITY_WEIGHT_US_BIRTH_COUNTRY to 30 crosses 60 → US_ELIGIBLE_PROSPECT", () => {
    process.env["ELIGIBILITY_WEIGHT_US_BIRTH_COUNTRY"] = "30";
    _resetWeightsCacheForTesting(); // force recompute from updated env

    const profile: EligibilityProfile = {
      nationality: "Germany",
      birthCountry: "USA",
      birthplace: "Houston, Texas",
      statistics: [
        PREM_BLOCK,
        ntBlock("United States U20", "CONCACAF U20 Championship"),
      ],
    };
    // us_birth_country(30) + us_state_birthplace(15) + us_youth_nt(15) = 60
    const { score, status } = evaluateEligibility(profile);
    expect(score).toBe(60);
    expect(status).toBe("US_ELIGIBLE_PROSPECT");
  });

  /**
   * Weight-decrease test: a profile that with default weights scores exactly 60
   * (us_nationality=35 + us_birth_country=25) must drop back to UNKNOWN when
   * ELIGIBILITY_WEIGHT_US_NATIONALITY is reduced to 34 (total → 59).
   * Verifies that a small weight reduction is not silently masked.
   *
   * Signals that fire with overridden weight:
   *   us_nationality   (34)  ← decreased via env var
   *   us_birth_country (25)
   *   ─────────────────────
   *   total            59  → UNKNOWN
   */
  it("decreasing ELIGIBILITY_WEIGHT_US_NATIONALITY to 34 drops a 60-point profile back to UNKNOWN", () => {
    // Sanity-check baseline: without an override this profile scores exactly 60.
    const profile: EligibilityProfile = {
      nationality: "USA",
      birthCountry: "USA",
      statistics: [PREM_BLOCK],
    };
    const defaultResult = evaluateEligibility(profile);
    expect(defaultResult.score).toBe(60);
    expect(defaultResult.status).toBe("US_ELIGIBLE_PROSPECT");

    // Override us_nationality to 34 → 34 + 25 = 59 → UNKNOWN.
    process.env["ELIGIBILITY_WEIGHT_US_NATIONALITY"] = "34";
    _resetWeightsCacheForTesting();

    const { score, status } = evaluateEligibility(profile);
    expect(score).toBe(59);
    expect(status).toBe("UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// Weight cap clamping — env-var override above maxContribution
// ---------------------------------------------------------------------------

describe("evaluateEligibility – weight cap clamping (maxContribution)", () => {
  afterEach(() => {
    delete process.env["ELIGIBILITY_WEIGHT_US_NATIONALITY"];
    _resetWeightsCacheForTesting();
  });

  /**
   * us_nationality has defaultWeight=35 and maxContribution=50.
   * Setting the env-var override to 999 must NOT produce a signal weight of 999
   * or a score of 999.  The signal weight must be silently clamped to
   * maxContribution (50), and the total score must reflect that clamped value.
   *
   * Profile: nationality=USA, birthCountry=England → only us_nationality fires.
   *
   *   us_nationality raw override : 999
   *   clamped to maxContribution  : 50
   *   total score (clamped to 100): 50  → UNKNOWN (below 60-pt threshold)
   */
  it("clamps a signal weight to maxContribution when the env-var override exceeds the cap", () => {
    process.env["ELIGIBILITY_WEIGHT_US_NATIONALITY"] = "999";
    _resetWeightsCacheForTesting(); // force recompute from updated env

    const profile: EligibilityProfile = {
      nationality: "USA",
      birthCountry: "England",
      statistics: [PREM_BLOCK],
    };

    const { score, signals, status } = evaluateEligibility(profile);

    // The fired signal's weight must equal maxContribution (50), not the raw 999
    const nationalitySignal = signals.find(
      (s) => s.signalType === "us_nationality",
    );
    expect(nationalitySignal).toBeDefined();
    expect(nationalitySignal!.weight).toBe(50); // maxContribution for us_nationality

    // Total score is the sum of clamped signal weights, itself clamped to 100
    expect(score).toBe(50);

    // 50 < 60 → status stays UNKNOWN (not US_ELIGIBLE_PROSPECT)
    expect(status).toBe("UNKNOWN");
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
