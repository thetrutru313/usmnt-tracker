/**
 * Regression guard: confirms that `computeFormTier` receives the correct
 * season baseline after a player transfers clubs mid-season.
 *
 * ## Why this matters
 * `syncPlayerStatsAndInjuries` derives `seasonAvgRating` by calling
 * `aggregateSeasonBlocks(blocks, clubTeamId)` where `clubTeamId` is the
 * player's *current* club's API-Football team ID.  If the filtering were
 * absent (or broken), blocks from the player's old club would inflate or
 * deflate the baseline, and `computeFormTier` would silently produce the
 * wrong tier badge.
 *
 * ## What is tested
 * 1. When the API returns stat blocks for both the old club AND the new club
 *    in the same season, `aggregateSeasonBlocks` scoped to the *new* club's
 *    team ID includes only new-club blocks.
 * 2. `aggregateSeasonBlocks` scoped to the *old* club's team ID returns the
 *    old-club figures — confirming the filtering is directional and correct.
 * 3. `computeFormTier` called with the new-club baseline (as the sync path
 *    does after a transfer) produces the correct tier, not the tier that
 *    would result from mixing in the stale old-club data.
 * 4. Friendly-league blocks are excluded regardless of team ID — a transfer
 *    window preseason friendly at the new club does not pollute the baseline.
 * 5. The "no data for new club yet" edge case: when the player has just
 *    joined and the API has no competitive blocks for the new club yet,
 *    `aggregateSeasonBlocks` returns null, and `computeFormTier` degrades
 *    gracefully to "steady" (not to a stale old-club tier).
 */

import { describe, it, expect } from "vitest";
import {
  aggregateSeasonBlocks,
  computeFormTier,
  aggregateFromMatchLogs,
  isFriendlyLeague,
} from "../playerStatsSync.js";
import type { AfSeasonStatBlock, RealMatchLog } from "../playerStatsSync.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const OLD_CLUB_TEAM_ID = 101;
const NEW_CLUB_TEAM_ID = 202;

/** Build a minimal AfSeasonStatBlock for a given team and league. */
function makeBlock(
  teamId: number,
  teamName: string,
  leagueName: string,
  overrides: {
    minutes?: number;
    lineups?: number;
    rating?: string | null;
    goals?: number;
    assists?: number;
  } = {},
): AfSeasonStatBlock {
  return {
    team: { id: teamId, name: teamName },
    league: { name: leagueName, season: 2025 },
    games: {
      minutes: overrides.minutes ?? 900,
      lineups: overrides.lineups ?? 10,
      position: "Midfielder",
      rating: overrides.rating !== undefined ? overrides.rating : "7.00",
    },
    goals: { total: overrides.goals ?? 2, assists: overrides.assists ?? 3, conceded: null, saves: null },
    shots: { total: 10 },
    passes: { total: 500, key: 20, accuracy: "82" },
    tackles: { total: 30, interceptions: 10 },
    duels: { total: 80, won: 45 },
  };
}

/** Build a minimal RealMatchLog for new-club fixtures. */
function makeLog(rating: number | null, minutes = 90): RealMatchLog {
  return {
    apiFootballFixtureId: Math.floor(Math.random() * 1_000_000),
    date: "2025-04-01",
    opponent: "Some FC",
    competition: "Bundesliga",
    result: "W 2-1",
    minutes,
    goals: 0,
    assists: 1,
    conceded: null,
    rating,
    isNationalTeam: false,
  };
}

// ---------------------------------------------------------------------------
// 1. aggregateSeasonBlocks — correct club filtering after a transfer
// ---------------------------------------------------------------------------

describe("aggregateSeasonBlocks — club-transfer filtering", () => {
  // A player played for the old club (Jan–mid-season) and transferred to the
  // new club (rest of season).  API-Football returns one block per team per
  // competition.
  const oldClubBlock = makeBlock(OLD_CLUB_TEAM_ID, "Old Club", "Bundesliga", {
    minutes: 630,
    lineups: 7,
    rating: "6.70", // below-average at old club
    goals: 1,
    assists: 0,
  });
  const newClubBlock = makeBlock(NEW_CLUB_TEAM_ID, "New Club", "Bundesliga", {
    minutes: 450,
    lineups: 5,
    rating: "7.60", // strong at new club
    goals: 2,
    assists: 3,
  });

  it("includes only new-club block when scoped to new club's team ID", () => {
    const agg = aggregateSeasonBlocks([oldClubBlock, newClubBlock], NEW_CLUB_TEAM_ID);
    expect(agg).not.toBeNull();
    // minutes and rating must come from new-club block only
    expect(agg!.minutes).toBe(450);
    // avgRating weighted by minutes — single block so it equals the block rating
    expect(agg!.avgRating).toBeCloseTo(7.6, 5);
  });

  it("includes only old-club block when scoped to old club's team ID", () => {
    const agg = aggregateSeasonBlocks([oldClubBlock, newClubBlock], OLD_CLUB_TEAM_ID);
    expect(agg).not.toBeNull();
    expect(agg!.minutes).toBe(630);
    expect(agg!.avgRating).toBeCloseTo(6.7, 5);
  });

  it("includes ALL non-friendly blocks when clubTeamId is null (no guard)", () => {
    const agg = aggregateSeasonBlocks([oldClubBlock, newClubBlock], null);
    expect(agg).not.toBeNull();
    // Both blocks' minutes are summed
    expect(agg!.minutes).toBe(630 + 450);
  });
});

// ---------------------------------------------------------------------------
// 2. computeFormTier — correct tier with new-club baseline vs stale baseline
// ---------------------------------------------------------------------------

describe("computeFormTier — correct tier after club transfer", () => {
  // Match logs at the new club: player is performing well (avg ~7.6)
  const newClubLogs: RealMatchLog[] = [
    makeLog(7.8),
    makeLog(7.5),
    makeLog(7.6),
    makeLog(7.4),
    makeLog(7.7),
  ];
  const last5 = aggregateFromMatchLogs(newClubLogs);
  expect(last5).not.toBeNull();

  // Scenario A: correct new-club season baseline (7.6 avg)
  // score = 50 × (last5Avg − 7.6) — last5Avg ≈ 7.6, so near 0 → steady
  it("produces steady when last5 matches new-club baseline", () => {
    const newClubSeasonAvg = 7.6;
    const { trend } = computeFormTier(last5, null, newClubSeasonAvg);
    // score ≈ 0, so should be steady (within ±12 range)
    expect(trend).toBe("steady");
  });

  // Scenario B: stale old-club season baseline (6.7 avg — old club's poor form)
  // score = 50 × (7.6 − 6.7) = 45 → on_fire (WRONG — inflated by stale data)
  it("would produce on_fire with stale old-club baseline (demonstrating the bug scenario)", () => {
    const oldClubSeasonAvg = 6.7;
    const { trend } = computeFormTier(last5, null, oldClubSeasonAvg);
    expect(trend).toBe("on_fire");
  });

  // This confirms the functions are correct when called with the right inputs.
  // The sync path guards this by passing `current?.agg.avgRating` where
  // `current` is derived from `aggregateSeasonBlocks(blocks, clubTeamId)` —
  // scoped to the player's current (new) club.
  it("produces correct tier when aggregateSeasonBlocks is scoped to new club", () => {
    const oldClubBlock = makeBlock(OLD_CLUB_TEAM_ID, "Old Club", "Bundesliga", {
      minutes: 630,
      rating: "6.70",
    });
    const newClubBlock = makeBlock(NEW_CLUB_TEAM_ID, "New Club", "Bundesliga", {
      minutes: 450,
      rating: "7.60",
    });

    // Simulate what the sync path does: aggregate with the new club's team ID
    const newClubSeasonStats = aggregateSeasonBlocks(
      [oldClubBlock, newClubBlock],
      NEW_CLUB_TEAM_ID,
    );
    expect(newClubSeasonStats).not.toBeNull();

    const { trend } = computeFormTier(last5, null, newClubSeasonStats!.avgRating);
    // last5Avg ≈ 7.6, newClubSeasonAvg ≈ 7.6 → score ≈ 0 → steady
    expect(trend).toBe("steady");
  });

  it("produces inflated on_fire when old-club blocks are not filtered out", () => {
    const oldClubBlock = makeBlock(OLD_CLUB_TEAM_ID, "Old Club", "Bundesliga", {
      minutes: 630,
      rating: "6.70",
    });
    const newClubBlock = makeBlock(NEW_CLUB_TEAM_ID, "New Club", "Bundesliga", {
      minutes: 450,
      rating: "7.60",
    });

    // Simulate the broken path: aggregate without team-ID guard (null)
    const mixedStats = aggregateSeasonBlocks([oldClubBlock, newClubBlock], null);
    expect(mixedStats).not.toBeNull();

    // Mixed average: (6.7×630 + 7.6×450) / (630+450) ≈ 7.075
    const { trend: wrongTrend } = computeFormTier(last5, null, mixedStats!.avgRating);
    // last5Avg ≈ 7.6 vs mixed baseline ≈ 7.075 → score ≈ 26 → on_fire (wrong)
    expect(wrongTrend).toBe("on_fire");
  });
});

// ---------------------------------------------------------------------------
// 3. Friendly-league blocks are excluded regardless of team ID
// ---------------------------------------------------------------------------

describe("aggregateSeasonBlocks — friendlies excluded after transfer", () => {
  it("drops new-club preseason friendly block, includes only new-club league block", () => {
    const friendlyBlock = makeBlock(NEW_CLUB_TEAM_ID, "New Club", "Friendlies Clubs", {
      minutes: 120,
      rating: "8.50", // inflated preseason rating — must not pollute baseline
    });
    const leagueBlock = makeBlock(NEW_CLUB_TEAM_ID, "New Club", "Bundesliga", {
      minutes: 450,
      rating: "7.60",
    });

    const agg = aggregateSeasonBlocks([friendlyBlock, leagueBlock], NEW_CLUB_TEAM_ID);
    expect(agg).not.toBeNull();
    // Only the league block's minutes and rating should contribute
    expect(agg!.minutes).toBe(450);
    expect(agg!.avgRating).toBeCloseTo(7.6, 5);
  });

  it("isFriendlyLeague correctly identifies preseason friendly leagues", () => {
    expect(isFriendlyLeague("Friendlies Clubs")).toBe(true);
    expect(isFriendlyLeague("Club Friendlies")).toBe(true);
    expect(isFriendlyLeague("International Friendlies")).toBe(true);
    expect(isFriendlyLeague("Bundesliga")).toBe(false);
    expect(isFriendlyLeague("Major League Soccer")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Edge case: player just transferred — no competitive blocks for new club yet
// ---------------------------------------------------------------------------

describe("aggregateSeasonBlocks + computeFormTier — no new-club data yet", () => {
  it("returns null when new club has no competitive blocks yet", () => {
    const oldClubBlock = makeBlock(OLD_CLUB_TEAM_ID, "Old Club", "Bundesliga", {
      minutes: 900,
      rating: "6.70",
    });

    // Only old-club data exists; filtering to new club returns nothing
    const agg = aggregateSeasonBlocks([oldClubBlock], NEW_CLUB_TEAM_ID);
    expect(agg).toBeNull();
  });

  it("computeFormTier falls back to steady when season baseline is null (new transfer, no baseline)", () => {
    // Match logs exist at new club but no season baseline yet
    const logs: RealMatchLog[] = [
      makeLog(7.8),
      makeLog(7.5),
      makeLog(7.6),
      makeLog(7.4),
      makeLog(7.7),
    ];
    const last5 = aggregateFromMatchLogs(logs);
    expect(last5).not.toBeNull();

    // seasonAvgRating is null because aggregateSeasonBlocks returned null
    const { trend, trending } = computeFormTier(last5, null, null);
    // No baseline → confidence gate fires → steady (not a stale old-club tier)
    expect(trend).toBe("steady");
    expect(trending).toBe(false);
  });

  it("also returns null (baseline) when only friendly blocks exist for the new club", () => {
    const friendlyBlock = makeBlock(NEW_CLUB_TEAM_ID, "New Club", "Friendlies Clubs", {
      minutes: 120,
      rating: "7.50",
    });

    const agg = aggregateSeasonBlocks([friendlyBlock], NEW_CLUB_TEAM_ID);
    // Friendly blocks filtered out → null
    expect(agg).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Multiple competitions at new club are correctly aggregated together
// ---------------------------------------------------------------------------

describe("aggregateSeasonBlocks — multi-competition aggregation for new club", () => {
  it("sums minutes across all league/cup competitions at new club", () => {
    const leagueBlock = makeBlock(NEW_CLUB_TEAM_ID, "New Club", "Bundesliga", {
      minutes: 360,
      rating: "7.50",
    });
    const cupBlock = makeBlock(NEW_CLUB_TEAM_ID, "New Club", "DFB Pokal", {
      minutes: 120,
      rating: "7.80",
    });
    // Old club block for same season — must be excluded
    const oldClubBlock = makeBlock(OLD_CLUB_TEAM_ID, "Old Club", "Bundesliga", {
      minutes: 630,
      rating: "6.70",
    });

    const agg = aggregateSeasonBlocks([leagueBlock, cupBlock, oldClubBlock], NEW_CLUB_TEAM_ID);
    expect(agg).not.toBeNull();
    // Total minutes: only new-club blocks
    expect(agg!.minutes).toBe(360 + 120);
    // Weighted avg rating: (7.5×360 + 7.8×120) / 480
    const expectedAvg = (7.5 * 360 + 7.8 * 120) / 480;
    expect(agg!.avgRating).toBeCloseTo(expectedAvg, 5);
  });

  it("computeFormTier uses multi-competition new-club baseline correctly", () => {
    const leagueBlock = makeBlock(NEW_CLUB_TEAM_ID, "New Club", "Bundesliga", {
      minutes: 360,
      rating: "7.50",
    });
    const cupBlock = makeBlock(NEW_CLUB_TEAM_ID, "New Club", "DFB Pokal", {
      minutes: 120,
      rating: "7.80",
    });
    const oldClubBlock = makeBlock(OLD_CLUB_TEAM_ID, "Old Club", "Bundesliga", {
      minutes: 630,
      rating: "6.70",
    });

    const seasonStats = aggregateSeasonBlocks(
      [leagueBlock, cupBlock, oldClubBlock],
      NEW_CLUB_TEAM_ID,
    );
    expect(seasonStats).not.toBeNull();

    // last5: player's last 5 games are at or above their new-club average
    const logs: RealMatchLog[] = [
      makeLog(7.9),
      makeLog(7.8),
      makeLog(7.7),
      makeLog(7.9),
      makeLog(8.0),
    ];
    const last5 = aggregateFromMatchLogs(logs);
    expect(last5).not.toBeNull();

    // last5Avg ≈ 7.86, newClubSeasonAvg ≈ 7.575
    // score = 50 × (7.86 − 7.575) ≈ 14.25 → rising
    const { trend, trending } = computeFormTier(last5, null, seasonStats!.avgRating);
    expect(trend).toBe("rising");
    expect(trending).toBe(true);
  });
});
