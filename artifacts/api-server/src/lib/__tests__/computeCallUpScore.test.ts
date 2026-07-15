import { describe, it, expect } from "vitest";
import { computeCallUpScore, aggregateSeasonBlocks, AfSeasonStatBlock } from "../playerStatsSync.js";

// ---------------------------------------------------------------------------
// Helper: build a minimal player fixture with all neutral defaults so each
// test can vary exactly one dimension at a time.
//
// Neutral baseline produces a score of 40:
//   base=40, form=steady(0), seasonMinutes=1350(fraction=0.5→0),
//   age=27(0), caps=0(0), last5AvgRating=null(0), marketValueUsd=null(0),
//   hasActiveInjury=false(0)
// ---------------------------------------------------------------------------
function neutralPlayer(overrides: {
  category?: string | null;
  nationalTeamCaps?: number | null;
  marketValueUsd?: number | null;
  age?: number | null;
} = {}) {
  return {
    category: overrides.category !== undefined ? overrides.category : "fringe",
    nationalTeamCaps: overrides.nationalTeamCaps !== undefined ? overrides.nationalTeamCaps : 0,
    marketValueUsd: overrides.marketValueUsd !== undefined ? overrides.marketValueUsd : null,
    age: overrides.age !== undefined ? overrides.age : 27,
  };
}

// ---------------------------------------------------------------------------
// Null-return path: established core players (category "current", caps ≥ 30)
// ---------------------------------------------------------------------------
describe("computeCallUpScore — null path for established core", () => {
  it("returns null when category is 'current' and caps === 30", () => {
    expect(
      computeCallUpScore(
        neutralPlayer({ category: "current", nationalTeamCaps: 30 }),
        "steady",
        1350,
        null,
        false,
      ),
    ).toBeNull();
  });

  it("returns null when category is 'current' and caps > 30", () => {
    expect(
      computeCallUpScore(
        neutralPlayer({ category: "current", nationalTeamCaps: 55 }),
        "on_fire",
        2700,
        null,
        false,
      ),
    ).toBeNull();
  });

  it("does NOT return null when category is 'current' but caps < 30", () => {
    const result = computeCallUpScore(
      neutralPlayer({ category: "current", nationalTeamCaps: 29 }),
      "steady",
      1350,
      null,
      false,
    );
    expect(result).not.toBeNull();
  });

  it("does NOT return null when category is 'prospect' regardless of caps", () => {
    const result = computeCallUpScore(
      neutralPlayer({ category: "prospect", nationalTeamCaps: 50 }),
      "steady",
      1350,
      null,
      false,
    );
    expect(result).not.toBeNull();
  });

  it("does NOT return null when category is null even with 30+ caps", () => {
    const result = computeCallUpScore(
      neutralPlayer({ category: null, nationalTeamCaps: 40 }),
      "steady",
      1350,
      null,
      false,
    );
    expect(result).not.toBeNull();
  });

  it("treats null nationalTeamCaps as 0 — does not return null for 'current' + null caps", () => {
    const result = computeCallUpScore(
      neutralPlayer({ category: "current", nationalTeamCaps: null }),
      "steady",
      1350,
      null,
      false,
    );
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Form tier bonus: on_fire +20, rising +12, steady 0, falling −10, ice_cold −18
// Baseline (neutral player, seasonMinutes=1350 → fraction=0.5 → 0pts): 40
// ---------------------------------------------------------------------------
describe("computeCallUpScore — form tier signal", () => {
  it("on_fire adds +20 → base 60", () => {
    expect(computeCallUpScore(neutralPlayer(), "on_fire", 1350, null, false)).toBe(60);
  });

  it("rising adds +12 → base 52", () => {
    expect(computeCallUpScore(neutralPlayer(), "rising", 1350, null, false)).toBe(52);
  });

  it("steady adds 0 → base 40", () => {
    expect(computeCallUpScore(neutralPlayer(), "steady", 1350, null, false)).toBe(40);
  });

  it("falling subtracts 10 → base 30", () => {
    expect(computeCallUpScore(neutralPlayer(), "falling", 1350, null, false)).toBe(30);
  });

  it("ice_cold subtracts 18 → base 22", () => {
    expect(computeCallUpScore(neutralPlayer(), "ice_cold", 1350, null, false)).toBe(22);
  });

  it("unknown trend string contributes 0 (falls through to ?? 0)", () => {
    expect(computeCallUpScore(neutralPlayer(), "unknown_tier", 1350, null, false)).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// Playing-time bracket: Math.round((fraction − 0.5) * 30), −15 → +15
// fraction = min(seasonMinutes / 2700, 1.0)
// ---------------------------------------------------------------------------
describe("computeCallUpScore — playing-time signal", () => {
  it("null seasonMinutes contributes 0 (no change to score)", () => {
    expect(computeCallUpScore(neutralPlayer(), "steady", null, null, false)).toBe(40);
  });

  it("0 minutes → fraction=0 → round((0−0.5)*30) = −15", () => {
    expect(computeCallUpScore(neutralPlayer(), "steady", 0, null, false)).toBe(25);
  });

  it("1350 minutes → fraction=0.5 → round(0*30) = 0", () => {
    expect(computeCallUpScore(neutralPlayer(), "steady", 1350, null, false)).toBe(40);
  });

  it("2700 minutes → fraction=1.0 → round(0.5*30) = +15", () => {
    expect(computeCallUpScore(neutralPlayer(), "steady", 2700, null, false)).toBe(55);
  });

  it("minutes > 2700 are capped at fraction=1.0 → still +15", () => {
    expect(computeCallUpScore(neutralPlayer(), "steady", 5000, null, false)).toBe(55);
  });

  it("900 minutes → fraction=1/3 → round((1/3 − 0.5)*30) = round(−5) = −5", () => {
    expect(computeCallUpScore(neutralPlayer(), "steady", 900, null, false)).toBe(35);
  });
});

// ---------------------------------------------------------------------------
// Age bracket: <20 +10, <23 +6, <26 +2, <29 0, <32 −5, ≥32 −10
// Default when age is null: treated as 26 → 0
// ---------------------------------------------------------------------------
describe("computeCallUpScore — age signal", () => {
  it("age 19 (< 20) adds +10", () => {
    expect(computeCallUpScore(neutralPlayer({ age: 19 }), "steady", 1350, null, false)).toBe(50);
  });

  it("age 20 (< 23) adds +6", () => {
    expect(computeCallUpScore(neutralPlayer({ age: 20 }), "steady", 1350, null, false)).toBe(46);
  });

  it("age 22 (< 23) adds +6", () => {
    expect(computeCallUpScore(neutralPlayer({ age: 22 }), "steady", 1350, null, false)).toBe(46);
  });

  it("age 23 (< 26) adds +2", () => {
    expect(computeCallUpScore(neutralPlayer({ age: 23 }), "steady", 1350, null, false)).toBe(42);
  });

  it("age 26 (< 29) adds 0", () => {
    expect(computeCallUpScore(neutralPlayer({ age: 26 }), "steady", 1350, null, false)).toBe(40);
  });

  it("age 29 (< 32) subtracts 5", () => {
    expect(computeCallUpScore(neutralPlayer({ age: 29 }), "steady", 1350, null, false)).toBe(35);
  });

  it("age 32 (≥ 32) subtracts 10", () => {
    expect(computeCallUpScore(neutralPlayer({ age: 32 }), "steady", 1350, null, false)).toBe(30);
  });

  it("null age defaults to 26 (adds 0)", () => {
    expect(computeCallUpScore(neutralPlayer({ age: null }), "steady", 1350, null, false)).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// Caps bracket: 0 → 0, 1-10 → +5, 11-20 → +3, 21-30 → 0, >30 → −5
// ---------------------------------------------------------------------------
describe("computeCallUpScore — caps signal", () => {
  it("0 caps adds 0", () => {
    expect(computeCallUpScore(neutralPlayer({ nationalTeamCaps: 0 }), "steady", 1350, null, false)).toBe(40);
  });

  it("1 cap (≤ 10) adds +5", () => {
    expect(computeCallUpScore(neutralPlayer({ nationalTeamCaps: 1 }), "steady", 1350, null, false)).toBe(45);
  });

  it("10 caps (≤ 10) adds +5", () => {
    expect(computeCallUpScore(neutralPlayer({ nationalTeamCaps: 10 }), "steady", 1350, null, false)).toBe(45);
  });

  it("11 caps (≤ 20) adds +3", () => {
    expect(computeCallUpScore(neutralPlayer({ nationalTeamCaps: 11 }), "steady", 1350, null, false)).toBe(43);
  });

  it("20 caps (≤ 20) adds +3", () => {
    expect(computeCallUpScore(neutralPlayer({ nationalTeamCaps: 20 }), "steady", 1350, null, false)).toBe(43);
  });

  it("21 caps (≤ 30) adds 0", () => {
    expect(computeCallUpScore(neutralPlayer({ nationalTeamCaps: 21 }), "steady", 1350, null, false)).toBe(40);
  });

  it("30 caps (≤ 30, non-'current' category) adds 0", () => {
    expect(computeCallUpScore(neutralPlayer({ nationalTeamCaps: 30, category: "fringe" }), "steady", 1350, null, false)).toBe(40);
  });

  it("31 caps (> 30, non-'current' category) subtracts 5", () => {
    expect(computeCallUpScore(neutralPlayer({ nationalTeamCaps: 31, category: "fringe" }), "steady", 1350, null, false)).toBe(35);
  });

  it("null caps treated as 0 (adds 0)", () => {
    expect(computeCallUpScore(neutralPlayer({ nationalTeamCaps: null }), "steady", 1350, null, false)).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// Last-5 avg rating: > 7.5 → +8, > 7.0 → +4, > 6.5 → 0, > 6.0 → −4, ≤ 6.0 → −8
// ---------------------------------------------------------------------------
describe("computeCallUpScore — last-5 avg rating signal", () => {
  it("null last5AvgRating contributes 0", () => {
    expect(computeCallUpScore(neutralPlayer(), "steady", 1350, null, false)).toBe(40);
  });

  it("rating 7.6 (> 7.5) adds +8", () => {
    expect(computeCallUpScore(neutralPlayer(), "steady", 1350, 7.6, false)).toBe(48);
  });

  it("rating exactly 7.5 falls into next bracket (> 7.0) → +4", () => {
    expect(computeCallUpScore(neutralPlayer(), "steady", 1350, 7.5, false)).toBe(44);
  });

  it("rating 7.1 (> 7.0) adds +4", () => {
    expect(computeCallUpScore(neutralPlayer(), "steady", 1350, 7.1, false)).toBe(44);
  });

  it("rating exactly 7.0 falls into next bracket (> 6.5) → 0", () => {
    expect(computeCallUpScore(neutralPlayer(), "steady", 1350, 7.0, false)).toBe(40);
  });

  it("rating 6.6 (> 6.5) adds 0", () => {
    expect(computeCallUpScore(neutralPlayer(), "steady", 1350, 6.6, false)).toBe(40);
  });

  it("rating exactly 6.5 falls into next bracket (> 6.0) → −4", () => {
    expect(computeCallUpScore(neutralPlayer(), "steady", 1350, 6.5, false)).toBe(36);
  });

  it("rating 6.1 (> 6.0) subtracts 4", () => {
    expect(computeCallUpScore(neutralPlayer(), "steady", 1350, 6.1, false)).toBe(36);
  });

  it("rating exactly 6.0 subtracts 8 (not > 6.0)", () => {
    expect(computeCallUpScore(neutralPlayer(), "steady", 1350, 6.0, false)).toBe(32);
  });

  it("rating 5.5 (< 6.0) subtracts 8", () => {
    expect(computeCallUpScore(neutralPlayer(), "steady", 1350, 5.5, false)).toBe(32);
  });
});

// ---------------------------------------------------------------------------
// Market value: log-scale, 0 → +8, capped at +8, skipped when null/0
// formula: min(round(log10(mv / 1_000_000) * 4), 8)
// $1M  → log10(1) * 4 = 0 → 0 pts
// $10M → log10(10) * 4 = 4 → +4 pts
// $100M → log10(100) * 4 = 8 → +8 pts
// $1B  → log10(1000) * 4 = 12 → capped at +8
// ---------------------------------------------------------------------------
describe("computeCallUpScore — market value signal", () => {
  it("null marketValueUsd contributes 0", () => {
    expect(computeCallUpScore(neutralPlayer({ marketValueUsd: null }), "steady", 1350, null, false)).toBe(40);
  });

  it("0 marketValueUsd contributes 0 (guarded by mv > 0 check)", () => {
    expect(computeCallUpScore(neutralPlayer({ marketValueUsd: 0 }), "steady", 1350, null, false)).toBe(40);
  });

  it("$1M → log10(1)*4 = 0 pts", () => {
    expect(computeCallUpScore(neutralPlayer({ marketValueUsd: 1_000_000 }), "steady", 1350, null, false)).toBe(40);
  });

  it("$10M → log10(10)*4 = 4 pts", () => {
    expect(computeCallUpScore(neutralPlayer({ marketValueUsd: 10_000_000 }), "steady", 1350, null, false)).toBe(44);
  });

  it("$100M → log10(100)*4 = 8 pts", () => {
    expect(computeCallUpScore(neutralPlayer({ marketValueUsd: 100_000_000 }), "steady", 1350, null, false)).toBe(48);
  });

  it("$1B → capped at +8 (log10(1000)*4 = 12 → capped)", () => {
    expect(computeCallUpScore(neutralPlayer({ marketValueUsd: 1_000_000_000 }), "steady", 1350, null, false)).toBe(48);
  });
});

// ---------------------------------------------------------------------------
// Active injury penalty: −15 when hasActiveInjury is true
// ---------------------------------------------------------------------------
describe("computeCallUpScore — active injury penalty", () => {
  it("hasActiveInjury=false contributes 0", () => {
    expect(computeCallUpScore(neutralPlayer(), "steady", 1350, null, false)).toBe(40);
  });

  it("hasActiveInjury=true subtracts 15", () => {
    expect(computeCallUpScore(neutralPlayer(), "steady", 1350, null, true)).toBe(25);
  });

  it("injury penalty stacks with other signals (on_fire + injury = 60 − 15 = 45)", () => {
    expect(computeCallUpScore(neutralPlayer(), "on_fire", 1350, null, true)).toBe(45);
  });
});

// ---------------------------------------------------------------------------
// Clamping to [0, 100]
// ---------------------------------------------------------------------------
describe("computeCallUpScore — clamping to [0, 100]", () => {
  it("score is clamped to 0 at the floor", () => {
    // ice_cold (−18) + 0 minutes (−15) + old age 35 (−10) + caps=0 (0) + rating 5.0 (−8) + injury (−15)
    // = 40 − 18 − 15 − 10 − 8 − 15 = −26 → clamped to 0
    expect(
      computeCallUpScore(
        neutralPlayer({ age: 35, nationalTeamCaps: 0 }),
        "ice_cold",
        0,
        5.0,
        true,
      ),
    ).toBe(0);
  });

  it("score is clamped to 100 at the ceiling", () => {
    // on_fire (+20) + full minutes (+15) + age 18 (+10) + 5 caps (+5) + rating 8.0 (+8) + $100M (+8) + no injury
    // = 40 + 20 + 15 + 10 + 5 + 8 + 8 = 106 → clamped to 100
    expect(
      computeCallUpScore(
        neutralPlayer({ age: 18, nationalTeamCaps: 5, marketValueUsd: 100_000_000 }),
        "on_fire",
        2700,
        8.0,
        false,
      ),
    ).toBe(100);
  });

  it("result is always an integer (no fractional scores)", () => {
    const result = computeCallUpScore(neutralPlayer(), "steady", 1800, 6.9, false);
    expect(result).not.toBeNull();
    expect(Number.isInteger(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Combined scenarios — exercise multiple signals together
// ---------------------------------------------------------------------------
describe("computeCallUpScore — combined scenarios", () => {
  it("in-form young prospect with good market value scores high", () => {
    // base=40, on_fire=+20, 2700min=+15, age=21(+6), caps=5(+5), rating=7.8(+8),
    // $15M: round(log10(15)*4) = round(4.70) = +5, no injury
    // = 40 + 20 + 15 + 6 + 5 + 8 + 5 = 99
    const result = computeCallUpScore(
      neutralPlayer({ age: 21, nationalTeamCaps: 5, marketValueUsd: 15_000_000 }),
      "on_fire",
      2700,
      7.8,
      false,
    );
    expect(result).toBe(99);
  });

  it("cold veteran on the bench with an injury scores low", () => {
    // base=40, ice_cold(−18), 270min→fraction=0.1→round((0.1−0.5)*30)=round(−12)=−12, age=33(−10),
    // caps=35, non-current category → −5, rating=6.0(−8), no market value, injury(−15)
    // = 40 − 18 − 12 − 10 − 5 − 8 − 15 = −28 → clamped to 0
    const result = computeCallUpScore(
      neutralPlayer({ age: 33, nationalTeamCaps: 35, category: "fringe" }),
      "ice_cold",
      270,
      6.0,
      true,
    );
    expect(result).toBe(0);
  });

  it("steady fringe player with no data gets the bare base score of 40", () => {
    // All signals null/default → 40
    const result = computeCallUpScore(
      { category: "fringe", nationalTeamCaps: 0, marketValueUsd: null, age: 27 },
      "steady",
      1350,
      null,
      false,
    );
    expect(result).toBe(40);
  });

  it("prospect with moderate caps getting minutes scores around the middle", () => {
    // base=40, rising(+12), 1800min→fraction=0.667→round((0.667−0.5)*30)=round(5)=5, age=24(+2),
    // caps=8(+5), rating=7.0(0), no MV, no injury
    // = 40 + 12 + 5 + 2 + 5 + 0 = 64
    const result = computeCallUpScore(
      neutralPlayer({ age: 24, nationalTeamCaps: 8 }),
      "rising",
      1800,
      7.0,
      false,
    );
    expect(result).toBe(64);
  });

  it("'current' player with 29 caps is NOT exempted (still computes a score)", () => {
    // caps=29, category='current' — null gate requires ≥ 30
    // base=40, steady(0), 1350min(0), age=28(0), caps=21-30(0), no rating, no MV, no injury = 40
    const result = computeCallUpScore(
      { category: "current", nationalTeamCaps: 29, marketValueUsd: null, age: 28 },
      "steady",
      1350,
      null,
      false,
    );
    expect(result).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// Mid-season transfer: aggregateSeasonBlocks + computeCallUpScore integration
//
// When a player transfers mid-season, the API-Football /players response
// contains two statistics blocks: one for the old club's team ID and one for
// the new club's team ID. aggregateSeasonBlocks(blocks, newClubTeamId) must
// scope to only the new club's block so that computeCallUpScore receives the
// correct season-minutes figure. Using the stale old-club minutes or an
// unscoped total both produce meaningfully wrong scores.
//
// Test setup:
//   OLD_TEAM_ID=100 — played 400 min there before the transfer
//   NEW_TEAM_ID=200 — played 1500 min there after the transfer
//
// Expected minutes per scope:
//   new-club scoped  → 1500 min  → fraction=0.556 → round((0.556−0.5)×30)=+2  → score=42
//   stale old-club   →  400 min  → fraction=0.148 → round((0.148−0.5)×30)=−11 → score=29
//   unscoped total   → 1900 min  → fraction=0.704 → round((0.704−0.5)×30)=+6  → score=46
// ---------------------------------------------------------------------------

/** Minimal AfSeasonStatBlock factory — only populates the fields used by aggregateSeasonBlocks. */
function makeBlock(overrides: {
  teamId: number;
  teamName?: string;
  leagueName?: string;
  minutes?: number;
  rating?: string | null;
}): AfSeasonStatBlock {
  return {
    team: { id: overrides.teamId, name: overrides.teamName ?? "Club" },
    league: { name: overrides.leagueName ?? "League", season: 2025 },
    games: { minutes: overrides.minutes ?? 0, lineups: null, position: null, rating: overrides.rating ?? null },
    goals: { total: null, assists: null, conceded: null, saves: null },
    shots: { total: null },
    passes: { total: null, key: null, accuracy: null },
    tackles: { total: null, interceptions: null },
    duels: { total: null, won: null },
  };
}

const OLD_TEAM_ID = 100;
const NEW_TEAM_ID = 200;

describe("mid-season transfer — aggregateSeasonBlocks scopes to new club", () => {
  const blocks: AfSeasonStatBlock[] = [
    makeBlock({ teamId: OLD_TEAM_ID, teamName: "Old Club", minutes: 400 }),
    makeBlock({ teamId: NEW_TEAM_ID, teamName: "New Club", minutes: 1500 }),
  ];

  it("scoped to new club returns only the new-club minutes (1500)", () => {
    const stats = aggregateSeasonBlocks(blocks, NEW_TEAM_ID);
    expect(stats).not.toBeNull();
    expect(stats!.minutes).toBe(1500);
  });

  it("scoped to old club returns only the old-club minutes (400)", () => {
    const stats = aggregateSeasonBlocks(blocks, OLD_TEAM_ID);
    expect(stats).not.toBeNull();
    expect(stats!.minutes).toBe(400);
  });

  it("unscoped (clubTeamId=null) returns combined minutes (1900)", () => {
    const stats = aggregateSeasonBlocks(blocks, null);
    expect(stats).not.toBeNull();
    expect(stats!.minutes).toBe(1900);
  });
});

describe("mid-season transfer — computeCallUpScore differs meaningfully by minutes source", () => {
  // All other signals are held neutral (age=27, caps=0, no rating, no MV, no injury, steady form)
  // so the only variable is which minutes figure is passed in.

  it("correct new-club minutes (1500) → score 42", () => {
    // fraction=1500/2700=0.556; round((0.556−0.5)×30)=round(1.67)=+2; base=40+2=42
    expect(computeCallUpScore(neutralPlayer(), "steady", 1500, null, false)).toBe(42);
  });

  it("stale old-club minutes (400) → score 29", () => {
    // fraction=400/2700=0.148; round((0.148−0.5)×30)=round(−10.56)=−11; base=40−11=29
    expect(computeCallUpScore(neutralPlayer(), "steady", 400, null, false)).toBe(29);
  });

  it("stale old-club score (29) differs meaningfully from correct new-club score (42)", () => {
    const correctScore = computeCallUpScore(neutralPlayer(), "steady", 1500, null, false)!;
    const staleScore = computeCallUpScore(neutralPlayer(), "steady", 400, null, false)!;
    // 13-point difference — equivalent to crossing multiple score brackets
    expect(correctScore - staleScore).toBe(13);
  });

  it("unscoped inflated minutes (1900) also differ from correct new-club score", () => {
    // fraction=1900/2700=0.704; round((0.704−0.5)×30)=round(6.11)=+6; score=46
    const correctScore = computeCallUpScore(neutralPlayer(), "steady", 1500, null, false)!;
    const inflatedScore = computeCallUpScore(neutralPlayer(), "steady", 1900, null, false)!;
    expect(inflatedScore).toBe(46);
    expect(inflatedScore).not.toBe(correctScore);
  });

  it("end-to-end: aggregateSeasonBlocks(new club) minutes fed to computeCallUpScore yields 42", () => {
    const blocks: AfSeasonStatBlock[] = [
      makeBlock({ teamId: OLD_TEAM_ID, minutes: 400 }),
      makeBlock({ teamId: NEW_TEAM_ID, minutes: 1500 }),
    ];
    const stats = aggregateSeasonBlocks(blocks, NEW_TEAM_ID);
    expect(stats).not.toBeNull();
    const score = computeCallUpScore(neutralPlayer(), "steady", stats!.minutes, null, false);
    expect(score).toBe(42);
  });

  it("end-to-end: stale aggregateSeasonBlocks(old club) minutes fed to computeCallUpScore yields 29", () => {
    const blocks: AfSeasonStatBlock[] = [
      makeBlock({ teamId: OLD_TEAM_ID, minutes: 400 }),
      makeBlock({ teamId: NEW_TEAM_ID, minutes: 1500 }),
    ];
    const stats = aggregateSeasonBlocks(blocks, OLD_TEAM_ID);
    expect(stats).not.toBeNull();
    const score = computeCallUpScore(neutralPlayer(), "steady", stats!.minutes, null, false);
    expect(score).toBe(29);
  });
});
