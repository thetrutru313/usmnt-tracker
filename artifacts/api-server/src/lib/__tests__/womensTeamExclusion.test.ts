/**
 * Regression guard: this tracker is the United States MEN'S National Team
 * only (see replit.md's "Scope" section). Women's teams, players, and
 * competitions must never reach `clubs` or `player_candidates`.
 *
 * This app has TWO independent admission points that could let a women's
 * team into the pool, and both must refuse it on their own — a future
 * refactor that moves club creation elsewhere must not silently reopen the
 * hole by relying on only one of them:
 *   1. `ensureClubForTeam` (apiFootballSync.ts) — must refuse to insert or
 *      return a `clubs` row for a women's-side team name.
 *   2. `discoverUSProspects` (playerDiscovery.ts) — must skip squad-scanning
 *      a women's club even if one already exists in `clubs` (e.g. a legacy
 *      row from before this filter existed).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// isWomensTeamName / isWomensLeagueName — pure function unit tests
// ---------------------------------------------------------------------------

describe("isWomensTeamName", () => {
  it("matches an end-anchored ' W' suffix", async () => {
    const { isWomensTeamName } = await import("../apiFootballSync.js");
    expect(isWomensTeamName("Houston Dash W")).toBe(true);
    expect(isWomensTeamName("USA W")).toBe(true);
    expect(isWomensTeamName("  Portland Thorns W  ")).toBe(true); // trims first
  });

  it("does NOT match a substring occurrence of ' W' that isn't at the end", async () => {
    const { isWomensTeamName } = await import("../apiFootballSync.js");
    // These are real/plausible men's club names — a substring match would
    // wrongly exclude them; only a trailing " W" may match.
    expect(isWomensTeamName("Wimbledon AFC")).toBe(false);
    expect(isWomensTeamName("Watford")).toBe(false);
    expect(isWomensTeamName("West Ham United")).toBe(false);
  });

  it("does not match ordinary club names that don't end in a space + W", async () => {
    const { isWomensTeamName } = await import("../apiFootballSync.js");
    expect(isWomensTeamName("Cardiff City")).toBe(false);
    expect(isWomensTeamName("Sporting KC")).toBe(false);
    expect(isWomensTeamName("BW Lienen")).toBe(false); // ends in "n", not " W"
  });
});

describe("isWomensLeagueName", () => {
  it("matches known women's-league name patterns case-insensitively", async () => {
    const { isWomensLeagueName } = await import("../apiFootballSync.js");
    expect(isWomensLeagueName("NWSL")).toBe(true);
    expect(isWomensLeagueName("nwsl women")).toBe(true);
    expect(isWomensLeagueName("Frauen-Bundesliga")).toBe(true);
    expect(isWomensLeagueName("Serie A Femminile")).toBe(true);
    expect(isWomensLeagueName("Liga MX Femenil")).toBe(true);
    expect(isWomensLeagueName("Damallsvenskan")).toBe(true);
    expect(isWomensLeagueName("UEFA Women's Champions League")).toBe(true);
  });

  it("does not match ordinary men's league names", async () => {
    const { isWomensLeagueName } = await import("../apiFootballSync.js");
    expect(isWomensLeagueName("Premier League")).toBe(false);
    expect(isWomensLeagueName("MLS")).toBe(false);
    expect(isWomensLeagueName(null)).toBe(false);
    expect(isWomensLeagueName(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Admission point 1: ensureClubForTeam must refuse a women's team
// ---------------------------------------------------------------------------

const { mockDb, tClubs, mockLogger } = vi.hoisted(() => {
  const tClubs = { _table: "clubs" };
  const mockDb = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { mockDb, tClubs, mockLogger };
});

vi.mock("@workspace/db", () => ({
  db: mockDb,
  clubsTable: tClubs,
  playersTable: {},
  apiFootballTeamsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, val: unknown) => ({ _eq: [_col, val] }),
  and: (...args: unknown[]) => ({ _and: args }),
  sql: Object.assign(
    (..._args: unknown[]) => ({ _sql: true }),
    { raw: (..._args: unknown[]) => ({ _sqlRaw: true }) },
  ),
}));

vi.mock("../logger.js", () => ({
  logger: mockLogger,
}));

describe("ensureClubForTeam — rejects a women's team at the club-table admission point", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for 'Houston Dash W' without ever touching the DB", async () => {
    const { ensureClubForTeam } = await import("../apiFootballSync.js");

    const result = await ensureClubForTeam(2998, "Houston Dash W", null);

    expect(result).toBeNull();
    // Must reject before any select/insert — the check runs first.
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("logs loudly, naming the team, when it rejects", async () => {
    const { ensureClubForTeam } = await import("../apiFootballSync.js");

    await ensureClubForTeam(1718, "USA W", null);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: 1718, teamName: "USA W" }),
      expect.stringContaining("men's-only"),
    );
  });

  it("still allows a legitimate men's club through (no false positive)", async () => {
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 5, name: "Columbus Crew" }]),
      }),
    });

    const { ensureClubForTeam } = await import("../apiFootballSync.js");
    const result = await ensureClubForTeam(200, "Columbus Crew", null);

    expect(result).toEqual({ id: 5, name: "Columbus Crew" });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Admission point 2: discoverUSProspects must skip a women's club already
// present in `clubs`, independent of ensureClubForTeam having run at all.
// ---------------------------------------------------------------------------

describe("discoverUSProspects — skips a women's club already present in clubs_table", () => {
  it("never calls /players/squads for a club whose name ends in ' W'", async () => {
    vi.resetModules();

    const tCandidates = { _table: "player_candidates" };
    const tPlayers = { _table: "players" };
    const tEligibilitySignals = { _table: "eligibility_signals" };

    const discoveryDb = {
      select: vi.fn(),
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation(() => ({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1, isNew: new Date() }]),
          }),
        })),
      })),
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      })),
      delete: vi.fn().mockImplementation(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    };

    const discoveryLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const discoveryAfFetch = vi.fn();

    vi.doMock("@workspace/db", () => ({
      db: discoveryDb,
      playerCandidatesTable: tCandidates,
      playersTable: tPlayers,
      clubsTable: tClubs,
      eligibilitySignalsTable: tEligibilitySignals,
      serverConfigTable: {},
    }));

    vi.doMock("drizzle-orm", () => ({
      eq: (_col: unknown, _val: unknown) => ({ _eq: [_col, _val] }),
      asc: (_col: unknown) => ({ _asc: _col }),
      and: (...args: unknown[]) => ({ _and: args }),
      or: (...args: unknown[]) => ({ _or: args }),
      isNull: (_col: unknown) => ({ _isNull: _col }),
      isNotNull: (_col: unknown) => ({ _isNotNull: _col }),
      desc: (_col: unknown) => ({ _desc: _col }),
      gte: (_col: unknown, _val: unknown) => ({ _gte: [_col, _val] }),
      inArray: (_col: unknown, _vals: unknown) => ({ _inArray: [_col, _vals] }),
      lt: (_col: unknown, _val: unknown) => ({ _lt: [_col, _val] }),
      count: () => ({ _count: true }),
      sql: Object.assign(
        (_strings: TemplateStringsArray, ..._values: unknown[]) => ({ _sql: true }),
        { raw: (_val: string) => ({ _sqlRaw: _val }) },
      ),
    }));

    vi.doMock("../logger.js", () => ({ logger: discoveryLogger }));

    vi.doMock("../apiFootballSync.js", () => ({
      afFetch: discoveryAfFetch,
      isWomensTeamName: (name: string) => /\sW$/.test(name.trim()),
    }));

    vi.doMock("../playerStatsSync.js", () => ({
      isFriendlyLeague: vi.fn().mockReturnValue(false),
    }));

    vi.doMock("../evaluateEligibility.js", () => ({
      evaluateEligibility: vi.fn().mockReturnValue({ score: 60, status: "US_ELIGIBLE_PROSPECT", signals: [] }),
      detectSeniorNonUsCaps: vi.fn().mockReturnValue(false),
      countNationalTeamCaps: vi.fn().mockReturnValue({ seniorCaps: 0, youthCaps: 0 }),
    }));

    vi.doMock("../eligibilitySignalsConfig.js", () => ({
      getMinEligibilityScore: vi.fn().mockReturnValue(30),
      getMaxCandidateAge: vi.fn().mockReturnValue(23),
      getWeightFingerprint: vi.fn().mockReturnValue("test-fingerprint"),
      getResolvedWeights: vi.fn().mockReturnValue({}),
      SIGNAL_REGISTRY: {},
    }));

    vi.doMock("../playerClubSync.js", () => ({
      ageFromBirthDate: vi.fn().mockReturnValue(21),
    }));

    vi.doMock("../qualityScore.js", () => ({
      computeQualityScore: vi.fn().mockReturnValue(50),
    }));

    const WOMENS_CLUB = { id: 1869, name: "USA W", apiFootballTeamId: 1718 };
    const MENS_CLUB = { id: 5, name: "Columbus Crew", apiFootballTeamId: 200 };

    let callCount = 0;
    discoveryDb.select.mockImplementation(() => {
      const n = callCount++;
      let resolved: unknown;
      if (n === 0) resolved = [WOMENS_CLUB, MENS_CLUB]; // clubs
      else if (n === 1) resolved = []; // tracked players
      else resolved = []; // existing candidates
      return { from: vi.fn().mockResolvedValue(resolved) };
    });

    discoveryAfFetch.mockImplementation((path: string) => {
      if (path.includes(`/players/squads?team=${WOMENS_CLUB.apiFootballTeamId}`)) {
        // If discoverUSProspects ever calls this, the test below will fail
        // because it returns a female player who'd then need to be skipped
        // downstream too — the assertion is that this URL is never hit.
        return Promise.resolve([
          { team: { id: WOMENS_CLUB.apiFootballTeamId, name: WOMENS_CLUB.name }, players: [{ id: 9001, name: "T. Rodman" }] },
        ]);
      }
      if (path.includes(`/players/squads?team=${MENS_CLUB.apiFootballTeamId}`)) {
        return Promise.resolve([{ team: { id: MENS_CLUB.apiFootballTeamId, name: MENS_CLUB.name }, players: [] }]);
      }
      return Promise.resolve([]);
    });

    const { discoverUSProspects } = await import("../playerDiscovery.js");
    await discoverUSProspects();

    const squadCalls = discoveryAfFetch.mock.calls
      .map((args) => args[0] as string)
      .filter((path) => path.includes("/players/squads"));

    expect(squadCalls.some((p) => p.includes(`team=${WOMENS_CLUB.apiFootballTeamId}`))).toBe(false);
    expect(squadCalls.some((p) => p.includes(`team=${MENS_CLUB.apiFootballTeamId}`))).toBe(true);

    expect(discoveryLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ clubId: WOMENS_CLUB.id, clubName: WOMENS_CLUB.name }),
      expect.stringContaining("men's-only"),
    );

    vi.doUnmock("@workspace/db");
    vi.doUnmock("drizzle-orm");
    vi.doUnmock("../logger.js");
    vi.doUnmock("../apiFootballSync.js");
    vi.doUnmock("../playerStatsSync.js");
    vi.doUnmock("../evaluateEligibility.js");
    vi.doUnmock("../eligibilitySignalsConfig.js");
    vi.doUnmock("../playerClubSync.js");
    vi.doUnmock("../qualityScore.js");
  });
});
