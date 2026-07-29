/**
 * Confirms the commitment sweep never falsely flags a player who competes
 * in a Mexican club league (or any other CONCACAF club competition) as
 * committed to a non-US national team.
 *
 * The two-layer guard in detectNonUsCommitment:
 *   Layer 1 — team identity: only teams with national=true are treated as
 *             national-team appearances.  Liga MX clubs, CONCACAF Champions
 *             Cup participants, and other club sides all have national=false
 *             and are excluded at this layer.
 *   Layer 2 — stat-block lookup: even if layer 1 somehow produced a false
 *             positive, only blocks whose team.id is in the verified national-
 *             team set are counted.
 *
 * This file focuses on two complementary cases:
 *   1. A Liga MX club player whose stat blocks include Liga MX,
 *      CONCACAF Champions Cup, and a friendly competition — none of which
 *      should trigger a commitment flag (confidence: "NONE").
 *
 *   2. A dual-national player who plays for a Liga MX club AND for the
 *      Mexican national team competitively — the national-team block must
 *      be detected with confidence: "HIGH", but only the national-team block.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be established before any imports
// ---------------------------------------------------------------------------

const { mockAfFetch } = vi.hoisted(() => ({
  mockAfFetch: vi.fn(),
}));

vi.mock("../apiFootballSync.js", () => ({
  afFetch: mockAfFetch,
}));

// Use the real isFriendlyLeague so our test exercises the actual classification
// logic rather than a stub.
import { detectNonUsCommitment, type CommitmentDetectionResult } from "../commitmentTracker.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const PLAYER_ID = 55555;

/** Liga MX club — national flag must be false */
const LIGA_MX_CLUB_ID = 3001; // e.g. Club América
const LIGA_MX_CLUB_ID_2 = 3002; // e.g. Chivas de Guadalajara (Champions Cup entry)

/** Mexico national team — national flag must be true */
const MEXICO_NT_ID = 45;

/** USA national team — must never appear in non-US results */
const USA_NT_ID = 2384;

type TeamEntry = { team: { id: number; name: string; national?: boolean } };
type StatBlock = {
  team: { id: number; name: string };
  league: { name: string; season: number };
  games: { lineups: number | null; minutes: number | null };
};

function teamEntry(id: number, name: string, national: boolean): TeamEntry {
  return { team: { id, name, national } };
}

function statBlock(teamId: number, teamName: string, leagueName: string, lineups: number, season = 2025): StatBlock {
  return {
    team: { id: teamId, name: teamName },
    league: { name: leagueName, season },
    games: { lineups, minutes: lineups * 80 },
  };
}

// ---------------------------------------------------------------------------
// Case 1 — Liga MX club player: no national=true team anywhere
//
// Stat blocks include:
//   • Liga MX (domestic league — club)
//   • CONCACAF Champions Cup (continental club tournament — still a club)
//   • Club Friendly (pre-season exhibition — club)
//
// Layer 1 catches this: /players/teams returns only clubs (national=false),
// so detectNonUsCommitment returns NONE immediately without ever fetching
// season stats.
// ---------------------------------------------------------------------------

describe("detectNonUsCommitment — Liga MX club player with CONCACAF club competition stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns NONE when /players/teams lists only clubs (Liga MX club + no national team)", async () => {
    // Layer 1: /players/teams — only club entries, no national=true
    mockAfFetch.mockResolvedValueOnce([
      teamEntry(LIGA_MX_CLUB_ID, "Club América", false),
    ]);
    // Layer 2 stat fetch should NOT be called — early exit

    const result: CommitmentDetectionResult = await detectNonUsCommitment(PLAYER_ID);

    expect(result.confidence).toBe("NONE");
    expect(result.detections).toHaveLength(0);
    expect(result.reason).toBeNull();
    // Confirm only the /players/teams call was made (early-exit optimisation)
    expect(mockAfFetch).toHaveBeenCalledTimes(1);
  });

  it("returns NONE even when stat blocks would contain Liga MX, CONCACAF Champions Cup, and Friendlies", async () => {
    // /players/teams — still only club entries
    mockAfFetch.mockResolvedValueOnce([
      teamEntry(LIGA_MX_CLUB_ID, "Club América", false),
      teamEntry(LIGA_MX_CLUB_ID_2, "Chivas de Guadalajara", false),
    ]);
    // If stat blocks were fetched (they shouldn't be), they would look like this:
    // Liga MX, CONCACAF Champions Cup, and a pre-season friendly.
    // We don't stub the /players?id calls because they should never fire.

    const result: CommitmentDetectionResult = await detectNonUsCommitment(PLAYER_ID);

    expect(result.confidence).toBe("NONE");
    expect(result.detections).toHaveLength(0);
    // Early-exit: stat blocks never fetched
    expect(mockAfFetch).toHaveBeenCalledTimes(1);
  });

  it("returns NONE for a player listed in CONCACAF Champions Cup even though the competition name contains 'CONCACAF'", async () => {
    // Regression guard: 'CONCACAF' in a competition name must never be treated
    // as evidence of national-team commitment.  The team-identity layer (not the
    // competition name) is the authoritative filter.
    mockAfFetch.mockResolvedValueOnce([
      teamEntry(LIGA_MX_CLUB_ID, "Rayados de Monterrey", false),
    ]);
    // Hypothetical stat blocks that would never be fetched due to early exit
    // (included as documentation of what Layer 2 would ignore anyway):
    //   statBlock(LIGA_MX_CLUB_ID, "Rayados de Monterrey", "Liga MX", 28)
    //   statBlock(LIGA_MX_CLUB_ID, "Rayados de Monterrey", "CONCACAF Champions Cup", 6)
    //   statBlock(LIGA_MX_CLUB_ID, "Rayados de Monterrey", "Club Friendly", 2)

    const result: CommitmentDetectionResult = await detectNonUsCommitment(PLAYER_ID);

    expect(result.confidence).toBe("NONE");
    expect(mockAfFetch).toHaveBeenCalledTimes(1); // only Layer 1 fired
  });

  it("returns NONE for a player whose stat blocks include a Friendly competition but no verified national team", async () => {
    // Edge case: friendly leagues may also match isFriendlyLeague() — confirm
    // the club filter (Layer 1) short-circuits before that even matters.
    mockAfFetch.mockResolvedValueOnce([
      teamEntry(LIGA_MX_CLUB_ID, "Cruz Azul", false),
    ]);

    const result: CommitmentDetectionResult = await detectNonUsCommitment(PLAYER_ID);

    expect(result.confidence).toBe("NONE");
    expect(mockAfFetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Case 2 — Dual-national at a Liga MX club who also plays for Mexico NT
//
// /players/teams includes both the Liga MX club (national=false) and the
// Mexican national team (national=true).  The stat blocks include:
//   • Liga MX stats for the club (must be ignored — club)
//   • CONCACAF Champions Cup stats for the club (must be ignored — club)
//   • World Cup Qualification CONCACAF stats for Mexico NT (must be detected)
//
// Expected result: confidence HIGH, detection for Mexico NT only.
// ---------------------------------------------------------------------------

describe("detectNonUsCommitment — dual-national with Liga MX club + Mexico national team", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns HIGH confidence and flags only the Mexico NT block, ignoring Liga MX and CONCACAF club blocks", async () => {
    // Layer 1: /players/teams — club entry + Mexico NT
    mockAfFetch.mockResolvedValueOnce([
      teamEntry(LIGA_MX_CLUB_ID, "Club América", false),
      teamEntry(MEXICO_NT_ID, "Mexico", true),
    ]);

    // Layer 2: /players?id&season — current season
    mockAfFetch.mockResolvedValueOnce([
      {
        player: { id: PLAYER_ID },
        statistics: [
          statBlock(LIGA_MX_CLUB_ID, "Club América", "Liga MX", 28),                               // club — must be ignored
          statBlock(LIGA_MX_CLUB_ID, "Club América", "CONCACAF Champions Cup", 6),                 // club competition — must be ignored
          statBlock(LIGA_MX_CLUB_ID, "Club América", "Club Friendly", 2),                          // club friendly — must be ignored
          statBlock(MEXICO_NT_ID, "Mexico", "World Cup Qualification CONCACAF", 4),                // national team competitive — must be detected
        ],
      },
    ]);
    // Remaining season fetches return empty
    mockAfFetch.mockResolvedValue([]);

    const result: CommitmentDetectionResult = await detectNonUsCommitment(PLAYER_ID);

    expect(result.confidence).toBe("HIGH");
    expect(result.detections).toHaveLength(1);
    expect(result.detections[0]!.teamName).toBe("Mexico");
    expect(result.detections[0]!.teamId).toBe(MEXICO_NT_ID);
    expect(result.detections[0]!.kind).toBe("competitive");
    expect(result.detections[0]!.lineups).toBe(4);
    // Club América blocks must not appear in detections
    expect(result.detections.every((d) => d.teamId !== LIGA_MX_CLUB_ID)).toBe(true);
    expect(result.reason).toMatch(/Mexico/);
  });

  it("returns HIGH confidence when the Mexico NT block is from CONCACAF Nations League (not World Cup quals)", async () => {
    // Confirm that ANY competitive national-team competition triggers HIGH —
    // not just World Cup qualification.
    mockAfFetch.mockResolvedValueOnce([
      teamEntry(LIGA_MX_CLUB_ID, "Chivas de Guadalajara", false),
      teamEntry(MEXICO_NT_ID, "Mexico", true),
    ]);

    mockAfFetch.mockResolvedValueOnce([
      {
        player: { id: PLAYER_ID },
        statistics: [
          statBlock(LIGA_MX_CLUB_ID, "Chivas de Guadalajara", "Liga MX", 22),
          statBlock(MEXICO_NT_ID, "Mexico", "CONCACAF Nations League", 3),
        ],
      },
    ]);
    mockAfFetch.mockResolvedValue([]);

    const result: CommitmentDetectionResult = await detectNonUsCommitment(PLAYER_ID);

    expect(result.confidence).toBe("HIGH");
    expect(result.detections[0]!.teamName).toBe("Mexico");
    expect(result.detections[0]!.kind).toBe("competitive");
  });

  it("returns LOW confidence when the only Mexico NT appearance is a Friendly", async () => {
    // Even for a real national-team block, friendly-only = LOW not HIGH
    mockAfFetch.mockResolvedValueOnce([
      teamEntry(LIGA_MX_CLUB_ID, "Club Tigres UANL", false),
      teamEntry(MEXICO_NT_ID, "Mexico", true),
    ]);

    mockAfFetch.mockResolvedValueOnce([
      {
        player: { id: PLAYER_ID },
        statistics: [
          statBlock(LIGA_MX_CLUB_ID, "Club Tigres UANL", "Liga MX", 30),
          statBlock(MEXICO_NT_ID, "Mexico", "Friendlies", 1),
        ],
      },
    ]);
    mockAfFetch.mockResolvedValue([]);

    const result: CommitmentDetectionResult = await detectNonUsCommitment(PLAYER_ID);

    expect(result.confidence).toBe("LOW");
    expect(result.detections[0]!.kind).toBe("friendly");
    expect(result.reason).toMatch(/manual review/);
  });

  it("does not count USA national team appearances as non-US commitment evidence even when Mexico NT is also present", async () => {
    // Sanity check: a dual-national who played for both USA and Mexico — only
    // Mexico should appear in detections.
    mockAfFetch.mockResolvedValueOnce([
      teamEntry(LIGA_MX_CLUB_ID, "Club América", false),
      teamEntry(USA_NT_ID, "United States", true),  // excluded by USA guard
      teamEntry(MEXICO_NT_ID, "Mexico", true),
    ]);

    mockAfFetch.mockResolvedValueOnce([
      {
        player: { id: PLAYER_ID },
        statistics: [
          statBlock(LIGA_MX_CLUB_ID, "Club América", "Liga MX", 20),
          statBlock(USA_NT_ID, "United States", "CONCACAF Gold Cup", 2),      // USA — must not count
          statBlock(MEXICO_NT_ID, "Mexico", "Copa América", 3),               // Mexico competitive
        ],
      },
    ]);
    mockAfFetch.mockResolvedValue([]);

    const result: CommitmentDetectionResult = await detectNonUsCommitment(PLAYER_ID);

    expect(result.confidence).toBe("HIGH");
    expect(result.detections.every((d) => d.teamId !== USA_NT_ID)).toBe(true);
    expect(result.detections.every((d) => d.teamId !== LIGA_MX_CLUB_ID)).toBe(true);
    expect(result.detections.some((d) => d.teamId === MEXICO_NT_ID)).toBe(true);
  });
});
