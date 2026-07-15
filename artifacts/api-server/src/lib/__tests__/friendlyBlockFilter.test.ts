import { describe, it, expect } from "vitest";
import { isFriendlyLeague, aggregateSeasonBlocks } from "../playerStatsSync.js";
import type { AfSeasonStatBlock } from "../playerStatsSync.js";

// ---------------------------------------------------------------------------
// Helper: build a minimal AfSeasonStatBlock fixture
// ---------------------------------------------------------------------------
function makeBlock(overrides: {
  leagueName: string;
  teamId?: number;
  minutes?: number;
  lineups?: number;
  goals?: number;
  assists?: number;
}): AfSeasonStatBlock {
  return {
    team: { id: overrides.teamId ?? 1, name: "Test Club" },
    league: { name: overrides.leagueName, season: 2025 },
    games: {
      minutes: overrides.minutes ?? 90,
      lineups: overrides.lineups ?? 1,
      position: "Midfielder",
      rating: "7.00",
    },
    goals: {
      total: overrides.goals ?? 0,
      assists: overrides.assists ?? 0,
      conceded: null,
      saves: null,
    },
    shots: { total: 1 },
    passes: { total: 40, key: 2, accuracy: "85" },
    tackles: { total: 3, interceptions: 1 },
    duels: { total: 8, won: 4 },
  };
}

// ---------------------------------------------------------------------------
// isFriendlyLeague — pattern tests
// ---------------------------------------------------------------------------
describe("isFriendlyLeague", () => {
  it('returns true for "Friendlies Clubs" (club preseason friendlies)', () => {
    expect(isFriendlyLeague("Friendlies Clubs")).toBe(true);
  });

  it('returns true for "Friendlies" (national-team friendlies)', () => {
    expect(isFriendlyLeague("Friendlies")).toBe(true);
  });

  it('returns true for variant casing "FRIENDLIES CLUBS"', () => {
    expect(isFriendlyLeague("FRIENDLIES CLUBS")).toBe(true);
  });

  it('returns true for "Club Friendlies 2026" (hypothetical future rename)', () => {
    expect(isFriendlyLeague("Club Friendlies 2026")).toBe(true);
  });

  it('returns true for "International Friendly" (another possible name)', () => {
    expect(isFriendlyLeague("International Friendly")).toBe(true);
  });

  it('returns false for "Serie A"', () => {
    expect(isFriendlyLeague("Serie A")).toBe(false);
  });

  it('returns false for "Premier League"', () => {
    expect(isFriendlyLeague("Premier League")).toBe(false);
  });

  it('returns false for "UEFA Champions League"', () => {
    expect(isFriendlyLeague("UEFA Champions League")).toBe(false);
  });

  it('returns false for "MLS"', () => {
    expect(isFriendlyLeague("MLS")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// aggregateSeasonBlocks — filtering behaviour
// ---------------------------------------------------------------------------
describe("aggregateSeasonBlocks", () => {
  const CLUB_TEAM_ID = 42;

  it("filters out a block whose league is 'Friendlies Clubs'", () => {
    const blocks = [makeBlock({ leagueName: "Friendlies Clubs", teamId: CLUB_TEAM_ID, goals: 3 })];
    expect(aggregateSeasonBlocks(blocks, CLUB_TEAM_ID)).toBeNull();
  });

  it("filters out a block whose league is 'Friendlies' (national-team block)", () => {
    const blocks = [makeBlock({ leagueName: "Friendlies", teamId: CLUB_TEAM_ID, goals: 2 })];
    expect(aggregateSeasonBlocks(blocks, CLUB_TEAM_ID)).toBeNull();
  });

  it("passes through a block whose league is 'Serie A'", () => {
    const blocks = [makeBlock({ leagueName: "Serie A", teamId: CLUB_TEAM_ID, goals: 5, minutes: 810 })];
    const result = aggregateSeasonBlocks(blocks, CLUB_TEAM_ID);
    expect(result).not.toBeNull();
    expect(result!.goals).toBe(5);
    expect(result!.minutes).toBe(810);
  });

  it("filters out a block with a team-id mismatch even if the league name is competitive", () => {
    // team id 99 ≠ CLUB_TEAM_ID — represents a national-team block sneaking through
    const blocks = [makeBlock({ leagueName: "CONCACAF Nations League", teamId: 99, goals: 3 })];
    expect(aggregateSeasonBlocks(blocks, CLUB_TEAM_ID)).toBeNull();
  });

  it("team-id mismatch filter works independently of the friendly-name filter", () => {
    // A block that would also match the friendly pattern but is dropped first by team-id mismatch
    const blocks = [makeBlock({ leagueName: "Friendlies", teamId: 99, goals: 1 })];
    expect(aggregateSeasonBlocks(blocks, CLUB_TEAM_ID)).toBeNull();
  });

  it("only sums the club blocks when mixed with friendlies and a national-team block", () => {
    const blocks = [
      makeBlock({ leagueName: "Bundesliga", teamId: CLUB_TEAM_ID, goals: 4, assists: 2, minutes: 720 }),
      makeBlock({ leagueName: "DFB Pokal", teamId: CLUB_TEAM_ID, goals: 1, assists: 1, minutes: 90 }),
      makeBlock({ leagueName: "Friendlies Clubs", teamId: CLUB_TEAM_ID, goals: 2 }), // preseason — must be excluded
      makeBlock({ leagueName: "Friendlies", teamId: 7, goals: 3 }), // national-team friendly — excluded by both filters
    ];
    const result = aggregateSeasonBlocks(blocks, CLUB_TEAM_ID);
    expect(result).not.toBeNull();
    expect(result!.goals).toBe(5); // 4 + 1, not 2 + 3
    expect(result!.assists).toBe(3); // 2 + 1
    expect(result!.minutes).toBe(810); // 720 + 90
  });

  it("returns null when all blocks are filtered out (no real club minutes remain)", () => {
    const blocks = [
      makeBlock({ leagueName: "Friendlies Clubs", teamId: CLUB_TEAM_ID }),
      makeBlock({ leagueName: "Friendlies", teamId: 7 }),
    ];
    expect(aggregateSeasonBlocks(blocks, CLUB_TEAM_ID)).toBeNull();
  });

  it("passes all blocks through when clubTeamId is null (no team-id filter applied)", () => {
    const blocks = [
      makeBlock({ leagueName: "MLS", teamId: 10, goals: 3 }),
      makeBlock({ leagueName: "Friendlies Clubs", teamId: 10, goals: 5 }), // still filtered by league name
    ];
    const result = aggregateSeasonBlocks(blocks, null);
    expect(result).not.toBeNull();
    expect(result!.goals).toBe(3); // friendly still excluded; MLS block passes
  });
});
