import { describe, it, expect } from "vitest";
import { computeFormTier } from "../playerStatsSync.js";
import type { AggregatedSeasonStats } from "../playerStatsSync.js";

// ---------------------------------------------------------------------------
// Helper: build a minimal AggregatedSeasonStats fixture
// ---------------------------------------------------------------------------
function makeStats(overrides: { minutes?: number; avgRating?: number | null }): AggregatedSeasonStats {
  return {
    minutes: overrides.minutes ?? 450,
    starts: 5,
    goals: 0,
    assists: 0,
    shots: 0,
    keyPasses: 0,
    passCompletionPct: null,
    tackles: 0,
    interceptions: 0,
    duelsWonPct: null,
    savePct: null,
    avgRating: overrides.avgRating !== undefined ? overrides.avgRating : 7.0,
  };
}

// ---------------------------------------------------------------------------
// Confidence-minute gate: < 270 minutes → always "steady"
// ---------------------------------------------------------------------------
describe("computeFormTier — confidence-minute gate", () => {
  it("returns steady when last5 is null", () => {
    expect(computeFormTier(null, null, 7.0)).toEqual({ trend: "steady", trending: false });
  });

  it("returns steady when last5 minutes is exactly 0", () => {
    expect(computeFormTier(makeStats({ minutes: 0 }), null, 7.0)).toEqual({ trend: "steady", trending: false });
  });

  it("returns steady when last5 minutes is 269 (one below threshold)", () => {
    // A player rated well above baseline but with too few minutes
    expect(computeFormTier(makeStats({ minutes: 269, avgRating: 9.0 }), null, 6.0)).toEqual({
      trend: "steady",
      trending: false,
    });
  });

  it("does NOT gate at exactly 270 minutes (minimum confidence threshold)", () => {
    // 270 minutes with a strong above-baseline rating should fire the normal path
    const result = computeFormTier(makeStats({ minutes: 270, avgRating: 7.5 }), null, 7.0);
    // score = 50 * (7.5 - 7.0) = 25 → on_fire
    expect(result.trend).toBe("on_fire");
  });

  it("returns steady when last5.avgRating is null (no ratings recorded)", () => {
    expect(computeFormTier(makeStats({ minutes: 450, avgRating: null }), null, 7.0)).toEqual({
      trend: "steady",
      trending: false,
    });
  });

  it("returns steady when seasonAvgRating is null (no season baseline)", () => {
    expect(computeFormTier(makeStats({ minutes: 450, avgRating: 7.5 }), null, null)).toEqual({
      trend: "steady",
      trending: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Tier boundaries — no prev5 (trajectory term absent)
// Formula: score = 50 × (last5Avg − seasonAvg)
//   ≥  25 → on_fire
//   ≥  12 → rising
//   > −12 → steady
//   > −25 → falling
//        → ice_cold
// ---------------------------------------------------------------------------
describe("computeFormTier — tier boundaries without prev5", () => {
  it("on_fire at exactly score 25 (delta = 0.50)", () => {
    // score = 50 * 0.50 = 25
    const result = computeFormTier(makeStats({ avgRating: 7.5 }), null, 7.0);
    expect(result).toEqual({ trend: "on_fire", trending: true });
  });

  it("on_fire above score 25 (delta = 0.60)", () => {
    // score = 50 * 0.60 = 30
    const result = computeFormTier(makeStats({ avgRating: 7.6 }), null, 7.0);
    expect(result).toEqual({ trend: "on_fire", trending: true });
  });

  it("rising at exactly score 12 (delta = 0.24)", () => {
    // score = 50 * 0.24 = 12
    const result = computeFormTier(makeStats({ avgRating: 7.24 }), null, 7.0);
    expect(result).toEqual({ trend: "rising", trending: true });
  });

  it("rising between score 12 and 25 (delta = 0.40)", () => {
    // score = 50 * 0.40 = 20
    const result = computeFormTier(makeStats({ avgRating: 7.4 }), null, 7.0);
    expect(result).toEqual({ trend: "rising", trending: true });
  });

  it("steady just below score 12 (delta ≈ 0.239)", () => {
    // score = 50 * 0.239 = 11.95 → steady
    const result = computeFormTier(makeStats({ avgRating: 7.239 }), null, 7.0);
    expect(result).toEqual({ trend: "steady", trending: false });
  });

  it("steady at delta = 0 (last5 exactly matches season baseline)", () => {
    const result = computeFormTier(makeStats({ avgRating: 7.0 }), null, 7.0);
    expect(result).toEqual({ trend: "steady", trending: false });
  });

  it("falling at exactly score −12 (delta = −0.24)", () => {
    // score = 50 * −0.24 = −12; score > −12 is false → falling
    const result = computeFormTier(makeStats({ avgRating: 6.76 }), null, 7.0);
    expect(result).toEqual({ trend: "falling", trending: false });
  });

  it("falling between score −25 and −12 (delta = −0.40)", () => {
    // score = 50 * −0.40 = −20
    const result = computeFormTier(makeStats({ avgRating: 6.6 }), null, 7.0);
    expect(result).toEqual({ trend: "falling", trending: false });
  });

  it("ice_cold at exactly score −25 (delta = −0.50)", () => {
    // score = 50 * −0.50 = −25; score > −25 is false → ice_cold
    const result = computeFormTier(makeStats({ avgRating: 6.5 }), null, 7.0);
    expect(result).toEqual({ trend: "ice_cold", trending: false });
  });

  it("ice_cold below score −25 (delta = −0.70)", () => {
    // score = 50 * −0.70 = −35
    const result = computeFormTier(makeStats({ avgRating: 6.3 }), null, 7.0);
    expect(result).toEqual({ trend: "ice_cold", trending: false });
  });
});

// ---------------------------------------------------------------------------
// Trajectory term — only applied when prev5.avgRating is present
// Formula with prev5: score = 50 × (last5Avg − seasonAvg) + 30 × (last5Avg − prev5Avg)
// ---------------------------------------------------------------------------
describe("computeFormTier — trajectory term (with prev5)", () => {
  it("trajectory term pushes a borderline rising score into on_fire", () => {
    // Without prev5: score = 50 * (7.3 − 7.0) = 15 → rising
    // With prev5 (rising trajectory): score = 15 + 30 * (7.3 − 6.9) = 15 + 12 = 27 → on_fire
    const last5 = makeStats({ avgRating: 7.3 });
    const prev5 = makeStats({ avgRating: 6.9 });
    expect(computeFormTier(last5, prev5, 7.0)).toEqual({ trend: "on_fire", trending: true });
  });

  it("trajectory term pulls a borderline rising score down into steady", () => {
    // Without prev5: score = 50 * (7.24 − 7.0) = 12 → rising
    // With falling trajectory: score = 12 + 30 * (7.24 − 7.5) = 12 + (−7.8) = 4.2 → steady
    const last5 = makeStats({ avgRating: 7.24 });
    const prev5 = makeStats({ avgRating: 7.5 });
    expect(computeFormTier(last5, prev5, 7.0)).toEqual({ trend: "steady", trending: false });
  });

  it("trajectory term is NOT applied when prev5 is null", () => {
    // Same last5/season as above — without the prev5 drag it stays rising
    const last5 = makeStats({ avgRating: 7.24 });
    expect(computeFormTier(last5, null, 7.0)).toEqual({ trend: "rising", trending: true });
  });

  it("trajectory term is NOT applied when prev5.avgRating is null", () => {
    // prev5 exists but has no rating → trajectory term skipped
    const last5 = makeStats({ avgRating: 7.24 });
    const prev5 = makeStats({ avgRating: null });
    // score should still be 12 → rising (same as no prev5)
    expect(computeFormTier(last5, prev5, 7.0)).toEqual({ trend: "rising", trending: true });
  });

  it("trajectory term is applied symmetrically for a negative trajectory", () => {
    // Without prev5: score = 50 * (6.76 − 7.0) = −12 → falling
    // prev5 avg was lower, so trajectory is positive: 30 * (6.76 − 6.5) = 7.8
    // Combined: −12 + 7.8 = −4.2 → steady
    const last5 = makeStats({ avgRating: 6.76 });
    const prev5 = makeStats({ avgRating: 6.5 });
    expect(computeFormTier(last5, prev5, 7.0)).toEqual({ trend: "steady", trending: false });
  });

  it("prev5 with zero minutes still contributes its avgRating to trajectory", () => {
    // Confidence gate only applies to last5; prev5 minutes are not checked
    const last5 = makeStats({ minutes: 450, avgRating: 7.3 });
    const prev5 = makeStats({ minutes: 0, avgRating: 6.9 }); // 0 minutes but rating present
    // score = 50*(7.3−7.0) + 30*(7.3−6.9) = 15 + 12 = 27 → on_fire
    expect(computeFormTier(last5, prev5, 7.0)).toEqual({ trend: "on_fire", trending: true });
  });
});

// ---------------------------------------------------------------------------
// Trajectory gate — last5 < prev5 must never produce rising / on_fire
// ---------------------------------------------------------------------------
describe("computeFormTier — trajectory gate (last5 < prev5 cannot be rising/on_fire)", () => {
  it("caps at steady when season delta is large-positive but trajectory is downward", () => {
    // season avg 6.0, prior-5 7.5, last-5 6.8
    // score = 50*(6.8−6.0) + 30*(6.8−7.5) = 40 − 21 = +19 → would be rising without gate
    // gate: last5 (6.8) < prev5 (7.5) → cap at steady
    const last5 = makeStats({ avgRating: 6.8 });
    const prev5 = makeStats({ avgRating: 7.5 });
    expect(computeFormTier(last5, prev5, 6.0)).toEqual({ trend: "steady", trending: false });
  });

  it("caps at steady when score would reach on_fire but trajectory is downward", () => {
    // season avg 5.5, prior-5 8.0, last-5 7.0
    // score = 50*(7.0−5.5) + 30*(7.0−8.0) = 75 − 30 = +45 → would be on_fire without gate
    // gate: last5 (7.0) < prev5 (8.0) → cap at steady
    const last5 = makeStats({ avgRating: 7.0 });
    const prev5 = makeStats({ avgRating: 8.0 });
    expect(computeFormTier(last5, prev5, 5.5)).toEqual({ trend: "steady", trending: false });
  });

  it("still reaches falling when trajectory is downward and score is negative", () => {
    // season avg 7.5, prior-5 7.8, last-5 6.7
    // score = 50*(6.7−7.5) + 30*(6.7−7.8) = −40 − 33 = −73 → ice_cold
    // gate does NOT affect falling/ice_cold — only blocks rising/on_fire
    const last5 = makeStats({ avgRating: 6.7 });
    const prev5 = makeStats({ avgRating: 7.8 });
    expect(computeFormTier(last5, prev5, 7.5)).toEqual({ trend: "ice_cold", trending: false });
  });

  it("gate is inactive when prev5 is null — no trajectory data, no penalty", () => {
    // Without prev5, there is no trajectory to evaluate; season delta alone drives the tier
    // score = 50*(6.8−6.0) = +40 → on_fire (no gate applies)
    const last5 = makeStats({ avgRating: 6.8 });
    expect(computeFormTier(last5, null, 6.0)).toEqual({ trend: "on_fire", trending: true });
  });

  it("gate is inactive when prev5.avgRating is null", () => {
    // prev5 exists but has no rating — trajectory term is skipped, so gate also skips
    const last5 = makeStats({ avgRating: 6.8 });
    const prev5 = makeStats({ avgRating: null });
    expect(computeFormTier(last5, prev5, 6.0)).toEqual({ trend: "on_fire", trending: true });
  });

  it("rising is still awarded when last5 equals prev5 exactly (flat trajectory)", () => {
    // Boundary: last5 === prev5 → trajectoryIsDown is false → gate inactive
    // score = 50*(7.3−7.0) + 30*(7.3−7.3) = 15 + 0 = 15 → rising
    const last5 = makeStats({ avgRating: 7.3 });
    const prev5 = makeStats({ avgRating: 7.3 });
    expect(computeFormTier(last5, prev5, 7.0)).toEqual({ trend: "rising", trending: true });
  });
});

// ---------------------------------------------------------------------------
// "trending" flag — must be true for on_fire and rising only
// ---------------------------------------------------------------------------
describe("computeFormTier — trending flag", () => {
  it("trending is true for on_fire", () => {
    const result = computeFormTier(makeStats({ avgRating: 7.5 }), null, 7.0);
    expect(result.trend).toBe("on_fire");
    expect(result.trending).toBe(true);
  });

  it("trending is true for rising", () => {
    const result = computeFormTier(makeStats({ avgRating: 7.24 }), null, 7.0);
    expect(result.trend).toBe("rising");
    expect(result.trending).toBe(true);
  });

  it("trending is false for steady", () => {
    const result = computeFormTier(makeStats({ avgRating: 7.0 }), null, 7.0);
    expect(result.trend).toBe("steady");
    expect(result.trending).toBe(false);
  });

  it("trending is false for falling", () => {
    const result = computeFormTier(makeStats({ avgRating: 6.76 }), null, 7.0);
    expect(result.trend).toBe("falling");
    expect(result.trending).toBe(false);
  });

  it("trending is false for ice_cold", () => {
    const result = computeFormTier(makeStats({ avgRating: 6.5 }), null, 7.0);
    expect(result.trend).toBe("ice_cold");
    expect(result.trending).toBe(false);
  });

  it("trending is false when gate prevents scoring (steady fallback)", () => {
    const result = computeFormTier(makeStats({ minutes: 100, avgRating: 9.0 }), null, 5.0);
    expect(result.trending).toBe(false);
  });
});
