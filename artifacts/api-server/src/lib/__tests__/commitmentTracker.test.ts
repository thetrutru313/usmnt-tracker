/**
 * Unit tests for the commitment tracking pipeline.
 *
 * All API-Football calls are mocked.  The core correctness property under test:
 *
 *   1. A player in a CONCACAF club competition (e.g. Liga MX, CONCACAF Liga de
 *      Campeones) is NEVER flagged — even though the competition names contain
 *      "CONCACAF".  The team-identity guard (national=true) blocks these.
 *
 *   2. A player with a verified non-US national team entry (national=true) and
 *      a competitive appearance is classified HIGH confidence.
 *
 *   3. A player with a verified non-US national team entry but only friendly
 *      appearances is classified LOW confidence.
 *
 *   4. A player whose /players/teams response contains no national=true entries
 *      is classified NONE — stat blocks are never even fetched.
 *
 *   5. USA national team appearances (team id 2384 or name "United States"/"USA")
 *      are never counted as non-US commitment evidence.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockAfFetch } = vi.hoisted(() => {
  return { mockAfFetch: vi.fn() };
});

vi.mock("../apiFootballSync.js", () => ({
  afFetch: mockAfFetch,
}));

// The module under test only calls isFriendlyLeague from playerStatsSync,
// so we use the real implementation (no mock needed).
import {
  detectNonUsCommitment,
  fetchPlayerNationalTeams,
  type CommitmentDetectionResult,
} from "../commitmentTracker.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type TeamEntry = {
  team: { id: number; name: string; national?: boolean };
};

type StatBlock = {
  team: { id: number; name: string };
  league: { name: string; season: number };
  games: { lineups: number | null; minutes: number | null };
};

function makeTeamEntry(id: number, name: string, national: boolean): TeamEntry {
  return { team: { id, name, national } };
}

function makeStatBlock(teamId: number, leagueName: string, lineups: number, season = 2025): StatBlock {
  return {
    team: { id: teamId, name: "Team" },
    league: { name: leagueName, season },
    games: { lineups, minutes: lineups * 90 },
  };
}

const PLAYER_ID = 9999;
const MEXICO_TEAM_ID = 45;
const LIGA_MX_CLUB_TEAM_ID = 200; // a Liga MX club — national=false
const USA_TEAM_ID = 2384;

// ---------------------------------------------------------------------------
// fetchPlayerNationalTeams — unit tests
// ---------------------------------------------------------------------------

describe("fetchPlayerNationalTeams", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty map when /players/teams returns only clubs (national=false)", async () => {
    mockAfFetch.mockResolvedValueOnce([
      makeTeamEntry(LIGA_MX_CLUB_TEAM_ID, "Club América", false),
      makeTeamEntry(300, "FC Barcelona", false),
    ]);
    const result = await fetchPlayerNationalTeams(PLAYER_ID);
    expect(result.size).toBe(0);
  });

  it("returns an empty map when /players/teams returns only the USA national team", async () => {
    mockAfFetch.mockResolvedValueOnce([
      makeTeamEntry(USA_TEAM_ID, "United States", true),
    ]);
    const result = await fetchPlayerNationalTeams(PLAYER_ID);
    expect(result.size).toBe(0);
  });

  it("returns an empty map when /players/teams includes 'USA' by name (string guard)", async () => {
    mockAfFetch.mockResolvedValueOnce([
      makeTeamEntry(99999, "USA", true), // hypothetical duplicate id — name guard catches it
    ]);
    const result = await fetchPlayerNationalTeams(PLAYER_ID);
    expect(result.size).toBe(0);
  });

  it("returns Mexico when /players/teams includes Mexico with national=true", async () => {
    mockAfFetch.mockResolvedValueOnce([
      makeTeamEntry(LIGA_MX_CLUB_TEAM_ID, "Club América", false),
      makeTeamEntry(MEXICO_TEAM_ID, "Mexico", true),
    ]);
    const result = await fetchPlayerNationalTeams(PLAYER_ID);
    expect(result.size).toBe(1);
    expect(result.get(MEXICO_TEAM_ID)).toBe("Mexico");
  });

  it("returns an empty map on API failure, without throwing", async () => {
    mockAfFetch.mockRejectedValueOnce(new Error("network error"));
    const result = await fetchPlayerNationalTeams(PLAYER_ID);
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// detectNonUsCommitment — core false-positive guard tests
// ---------------------------------------------------------------------------

describe("detectNonUsCommitment — false-positive guard (club competitions never trigger)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns NONE when player is at a Mexican CLUB with no national=true team", async () => {
    // Call 1: /players/teams — only club entries
    mockAfFetch.mockResolvedValueOnce([
      makeTeamEntry(LIGA_MX_CLUB_TEAM_ID, "Club América", false),
    ]);
    // /players?id&season is never called because there are no national teams
    const result: CommitmentDetectionResult = await detectNonUsCommitment(PLAYER_ID);
    expect(result.confidence).toBe("NONE");
    expect(result.detections).toHaveLength(0);
    expect(mockAfFetch).toHaveBeenCalledTimes(1); // only the teams call
  });

  it("returns NONE for a player with Liga MX + CONCACAF Liga de Campeones appearances", async () => {
    // Both are club competitions — national=false on the team entry
    mockAfFetch.mockResolvedValueOnce([
      makeTeamEntry(LIGA_MX_CLUB_TEAM_ID, "Rayados de Monterrey", false),
    ]);
    const result: CommitmentDetectionResult = await detectNonUsCommitment(PLAYER_ID);
    expect(result.confidence).toBe("NONE");
  });

  it("returns NONE even when stat blocks contain 'CONCACAF' competition name but team is a club", async () => {
    // /players/teams returns only a club (national=false)
    mockAfFetch.mockResolvedValueOnce([
      makeTeamEntry(LIGA_MX_CLUB_TEAM_ID, "LAFC", false),
    ]);
    // Stat blocks would include "CONCACAF Champions Cup" but we never get here
    // because fetchPlayerNationalTeams returned an empty map and detectNonUsCommitment
    // returns early without calling /players?id&season.
    const result: CommitmentDetectionResult = await detectNonUsCommitment(PLAYER_ID);
    expect(result.confidence).toBe("NONE");
    // Stat blocks are NOT fetched — confirms the early-exit optimization
    expect(mockAfFetch).toHaveBeenCalledTimes(1);
  });

  it("returns NONE for a club friendly even when team entry is absent (no national=true)", async () => {
    mockAfFetch.mockResolvedValueOnce([
      makeTeamEntry(LIGA_MX_CLUB_TEAM_ID, "Some Club", false),
    ]);
    const result: CommitmentDetectionResult = await detectNonUsCommitment(PLAYER_ID);
    expect(result.confidence).toBe("NONE");
  });
});

// ---------------------------------------------------------------------------
// detectNonUsCommitment — verified national team cases
// ---------------------------------------------------------------------------

describe("detectNonUsCommitment — verified non-US national team detections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns HIGH confidence for a verified national team competitive appearance", async () => {
    // /players/teams: Mexico is national=true
    mockAfFetch.mockResolvedValueOnce([
      makeTeamEntry(LIGA_MX_CLUB_TEAM_ID, "Club América", false),
      makeTeamEntry(MEXICO_TEAM_ID, "Mexico", true),
    ]);
    // /players?id&season (three seasons tried): return data for the first
    mockAfFetch.mockResolvedValueOnce([
      {
        player: { id: PLAYER_ID },
        statistics: [
          makeStatBlock(LIGA_MX_CLUB_TEAM_ID, "Liga MX", 20), // club block — ignored
          makeStatBlock(MEXICO_TEAM_ID, "World Cup Qualification CONCACAF", 3), // national team competitive
        ],
      },
    ]);
    // remaining season fetches (years -1, -2) — unused
    mockAfFetch.mockResolvedValue([]);

    const result: CommitmentDetectionResult = await detectNonUsCommitment(PLAYER_ID);
    expect(result.confidence).toBe("HIGH");
    expect(result.detections).toHaveLength(1);
    expect(result.detections[0]!.teamName).toBe("Mexico");
    expect(result.detections[0]!.kind).toBe("competitive");
    expect(result.reason).toMatch(/Mexico/);
  });

  it("returns LOW confidence for a verified national team with friendly-only appearances", async () => {
    mockAfFetch.mockResolvedValueOnce([
      makeTeamEntry(MEXICO_TEAM_ID, "Mexico", true),
    ]);
    mockAfFetch.mockResolvedValueOnce([
      {
        player: { id: PLAYER_ID },
        statistics: [
          makeStatBlock(MEXICO_TEAM_ID, "Friendlies", 1), // friendly only
        ],
      },
    ]);
    mockAfFetch.mockResolvedValue([]);

    const result: CommitmentDetectionResult = await detectNonUsCommitment(PLAYER_ID);
    expect(result.confidence).toBe("LOW");
    expect(result.detections[0]!.kind).toBe("friendly");
    expect(result.reason).toMatch(/manual review/);
  });

  it("returns NONE when verified national team is present but zero lineups in all blocks", async () => {
    mockAfFetch.mockResolvedValueOnce([
      makeTeamEntry(MEXICO_TEAM_ID, "Mexico", true),
    ]);
    mockAfFetch.mockResolvedValueOnce([
      {
        player: { id: PLAYER_ID },
        statistics: [
          makeStatBlock(MEXICO_TEAM_ID, "World Cup Qualification CONCACAF", 0), // listed but never played
        ],
      },
    ]);
    mockAfFetch.mockResolvedValue([]);

    const result: CommitmentDetectionResult = await detectNonUsCommitment(PLAYER_ID);
    expect(result.confidence).toBe("NONE");
  });

  it("ignores USA national team blocks even when national=true on that entry", async () => {
    mockAfFetch.mockResolvedValueOnce([
      makeTeamEntry(USA_TEAM_ID, "United States", true), // USA — excluded from non-US set
    ]);
    const result: CommitmentDetectionResult = await detectNonUsCommitment(PLAYER_ID);
    expect(result.confidence).toBe("NONE");
    expect(mockAfFetch).toHaveBeenCalledTimes(1); // early exit, no stat fetch
  });

  it("returns HIGH when player has both USA appearances and Mexico competitive appearances", async () => {
    mockAfFetch.mockResolvedValueOnce([
      makeTeamEntry(USA_TEAM_ID, "United States", true),  // excluded
      makeTeamEntry(MEXICO_TEAM_ID, "Mexico", true),      // included
    ]);
    mockAfFetch.mockResolvedValueOnce([
      {
        player: { id: PLAYER_ID },
        statistics: [
          makeStatBlock(USA_TEAM_ID, "CONCACAF Gold Cup", 2), // USA — team not in non-US set
          makeStatBlock(MEXICO_TEAM_ID, "CONCACAF Nations League", 1), // Mexico competitive
        ],
      },
    ]);
    mockAfFetch.mockResolvedValue([]);

    const result: CommitmentDetectionResult = await detectNonUsCommitment(PLAYER_ID);
    expect(result.confidence).toBe("HIGH");
    expect(result.detections.every((d) => d.teamName !== "United States")).toBe(true);
  });

  it("prefers HIGH over LOW when a player has both competitive and friendly appearances for a non-US team", async () => {
    mockAfFetch.mockResolvedValueOnce([
      makeTeamEntry(MEXICO_TEAM_ID, "Mexico", true),
    ]);
    mockAfFetch.mockResolvedValueOnce([
      {
        player: { id: PLAYER_ID },
        statistics: [
          makeStatBlock(MEXICO_TEAM_ID, "Friendlies", 2),                     // friendly
          makeStatBlock(MEXICO_TEAM_ID, "Copa América", 4),                   // competitive
        ],
      },
    ]);
    mockAfFetch.mockResolvedValue([]);

    const result: CommitmentDetectionResult = await detectNonUsCommitment(PLAYER_ID);
    expect(result.confidence).toBe("HIGH");
  });
});
