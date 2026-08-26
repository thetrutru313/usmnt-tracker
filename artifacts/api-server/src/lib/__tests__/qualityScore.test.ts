import { describe, it, expect, vi, beforeEach } from "vitest";

// league_strength lookups go through the DB (@workspace/db). Mock it so this
// suite runs as a pure unit test without a live database, and so we control
// exactly which league ids are "classified" vs. unknown.
const mockLeagueRows = [
  { apiFootballLeagueId: 78, name: "Bundesliga", coefficient: "1.00" },
  { apiFootballLeagueId: 255, name: "USL Championship", coefficient: "0.30" },
  { apiFootballLeagueId: 39, name: "Premier League", coefficient: "1.00" },
];

vi.mock("@workspace/db", () => {
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => Promise.resolve(mockLeagueRows)),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => Promise.resolve()),
      })),
    },
    leagueStrengthTable: {},
  };
});

import {
  computeQualityScore,
  ageMultiplierFor,
  computePerformanceSubtotal,
  resolveLeagueCoefficient,
  selectPrimaryLeagueBlock,
  isCupCompetition,
  normalizeRawScore,
  _resetLeagueStrengthCacheForTesting,
  type QualityStatBlock,
} from "../qualityScore";
import { logger } from "../logger";

function clubBlock(
  leagueId: number,
  leagueName: string,
  opts: { lineups?: number; minutes?: number; appearences?: number; rating?: string | null } = {},
): QualityStatBlock {
  return {
    team: { id: 1, name: "Club FC" },
    league: { id: leagueId, name: leagueName, season: 2025 },
    games: {
      lineups: opts.lineups ?? 10,
      minutes: opts.minutes ?? 900,
      appearences: opts.appearences ?? opts.lineups ?? 10,
      position: "MF",
      rating: opts.rating ?? "7.00",
    },
  };
}

beforeEach(() => {
  _resetLeagueStrengthCacheForTesting();
});

describe("quality score — ranking scenarios", () => {
  it("a 17-year-old with 600 minutes in USL Championship outranks a 22-year-old with 2500 minutes in the same league", async () => {
    // Uses a lower-tier league (not Bundesliga) so neither profile clamps at
    // the 100 ceiling — that would make the comparison meaningless rather
    // than false. The tuning-scenario tests below cover top-tier leagues.
    const young = await computeQualityScore({
      statistics: [clubBlock(255, "USL Championship", { minutes: 600, lineups: 7, appearences: 8, rating: "7.00" })],
      minutes: 600,
      starts: 7,
      rating: "7.00",
      age: 17,
    });
    const older = await computeQualityScore({
      statistics: [clubBlock(255, "USL Championship", { minutes: 2500, lineups: 28, appearences: 28, rating: "7.00" })],
      minutes: 2500,
      starts: 28,
      rating: "7.00",
      age: 22,
    });
    expect(young.score).toBeGreaterThan(older.score);
    expect(young.score).toBeLessThan(100);
    expect(older.score).toBeLessThan(100);
  });

  it("a 22-year-old with 2500 minutes in the Bundesliga outranks the same player profile in USL Championship", async () => {
    const bundesliga = await computeQualityScore({
      statistics: [clubBlock(78, "Bundesliga", { minutes: 2500, lineups: 28, appearences: 28, rating: "7.00" })],
      minutes: 2500,
      starts: 28,
      rating: "7.00",
      age: 22,
    });
    const usl = await computeQualityScore({
      statistics: [clubBlock(255, "USL Championship", { minutes: 2500, lineups: 28, appearences: 28, rating: "7.00" })],
      minutes: 2500,
      starts: 28,
      rating: "7.00",
      age: 22,
    });
    expect(bundesliga.score).toBeGreaterThan(usl.score);
  });

  it("a 22-year-old with 3000 minutes in USL Championship does NOT outrank a 17-year-old with 400 minutes in the Premier League", async () => {
    const usl = await computeQualityScore({
      statistics: [clubBlock(255, "USL Championship", { minutes: 3000, lineups: 33, appearences: 33, rating: "7.00" })],
      minutes: 3000,
      starts: 33,
      rating: "7.00",
      age: 22,
    });
    const prem = await computeQualityScore({
      statistics: [clubBlock(39, "Premier League", { minutes: 400, lineups: 4, appearences: 5, rating: "6.50" })],
      minutes: 400,
      starts: 4,
      rating: "6.50",
      age: 17,
    });
    expect(prem.score).toBeGreaterThan(usl.score);
  });

  it("uses the unknown-league default coefficient and logs a warning naming the league/id when the league id is not classified", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);
    const coefficient = await resolveLeagueCoefficient(999999, "Some Obscure League");
    expect(coefficient).toBe(0.25);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ leagueId: 999999, leagueName: "Some Obscure League" }),
      expect.stringContaining("unclassified league"),
    );
    warnSpy.mockRestore();
  });

  it("ignores rating below the minutes floor instead of letting a small sample skew the score", () => {
    const withoutRating = computePerformanceSubtotal({ minutes: 150, starts: 2, appearances: 2, rating: 9.0 });
    const withoutRatingField = computePerformanceSubtotal({ minutes: 150, starts: 2, appearances: 2, rating: null });
    // Below the 300-minute floor, a sky-high single-game rating (9.0) must not
    // move the subtotal at all relative to having no rating on file.
    expect(withoutRating).toBeCloseTo(withoutRatingField, 10);

    // Above the floor, the same rating clearly changes the outcome — proving
    // the floor itself, not some other bug, is what suppressed it below.
    const withRatingAboveFloor = computePerformanceSubtotal({ minutes: 400, starts: 4, appearances: 4, rating: 9.0 });
    const withoutRatingAboveFloor = computePerformanceSubtotal({ minutes: 400, starts: 4, appearances: 4, rating: null });
    expect(withRatingAboveFloor).toBeGreaterThan(withoutRatingAboveFloor);
  });

  it("a hand-tuned coefficient survives reseeding (insert-if-missing, never upsert)", async () => {
    // Simulate a hand-tuned override already present for league 78 (0.42,
    // not the shipped default of 1.00). seedLeagueStrengthDefaults must not
    // touch it.
    const insertMock = vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) }));
    const dbModule = await import("@workspace/db");
    (dbModule.db.select as any).mockReturnValueOnce({
      from: vi.fn(() =>
        Promise.resolve([
          { id: 78 }, // already present -> must be excluded from the insert batch
        ]),
      ),
    });
    (dbModule.db.insert as any) = insertMock;

    const { seedLeagueStrengthDefaults } = await import("../qualityScore");
    await seedLeagueStrengthDefaults();

    expect(insertMock).toHaveBeenCalledTimes(1);
    const insertedRows = insertMock.mock.calls[0]
      ? (insertMock.mock.results[0]!.value.values as any).mock.calls[0][0]
      : [];
    expect(insertedRows.some((r: any) => r.apiFootballLeagueId === 78)).toBe(false);
  });
});

describe("ageMultiplierFor", () => {
  it("returns the table value at each boundary and collapses hard past the prospect window", () => {
    expect(ageMultiplierFor(16)).toBe(2.0);
    expect(ageMultiplierFor(10)).toBe(2.0); // clamps for anything younger than the table's floor
    expect(ageMultiplierFor(17)).toBe(1.8);
    expect(ageMultiplierFor(18)).toBe(1.6);
    expect(ageMultiplierFor(19)).toBe(1.4);
    expect(ageMultiplierFor(20)).toBe(1.25);
    expect(ageMultiplierFor(21)).toBe(1.1);
    expect(ageMultiplierFor(22)).toBe(1.0);
    expect(ageMultiplierFor(23)).toBe(0.85);
    expect(ageMultiplierFor(24)).toBe(0.4);
    expect(ageMultiplierFor(25)).toBe(0.2);
    expect(ageMultiplierFor(26)).toBe(0.1);
    expect(ageMultiplierFor(31)).toBe(0.1); // clamps at the table's floor — the tail never recovers
    expect(ageMultiplierFor(null)).toBe(1.0); // no age evidence — neutral
  });
});

describe("selectPrimaryLeagueBlock", () => {
  it("picks the highest-minutes club block and excludes friendlies/national-team blocks", () => {
    const blocks: QualityStatBlock[] = [
      clubBlock(78, "Bundesliga", { minutes: 900 }),
      clubBlock(39, "Premier League", { minutes: 200 }),
      { team: { id: 2, name: "USA" }, league: { id: 1, name: "Friendlies", season: 2025 }, games: { lineups: 1, minutes: 90, appearences: 1, position: "MF", rating: null } },
    ];
    const primary = selectPrimaryLeagueBlock(blocks);
    expect(primary?.league.id).toBe(78);
  });

  it("never picks a domestic or continental cup as the primary league, even with more minutes than the real league", () => {
    const blocks: QualityStatBlock[] = [
      { ...clubBlock(78, "Bundesliga", { minutes: 2000 }), team: { id: 10, name: "Bayern Munich" } },
      { ...clubBlock(9999, "DFB Pokal", { minutes: 200 }), team: { id: 10, name: "Bayern Munich" } },
    ];
    const primary = selectPrimaryLeagueBlock(blocks);
    expect(primary?.league.id).toBe(78);
    expect(primary?.league.name).toBe("Bundesliga");
  });

  it("returns null (never a cup) when a candidate has only cup appearances", () => {
    const blocks: QualityStatBlock[] = [
      clubBlock(9998, "Coppa Italia", { minutes: 300 }),
      clubBlock(9997, "Leagues Cup", { minutes: 150 }),
    ];
    expect(selectPrimaryLeagueBlock(blocks)).toBeNull();
  });
});

describe("isCupCompetition", () => {
  it("recognizes common domestic/continental cups and leaves real leagues alone", () => {
    expect(isCupCompetition("DFB Pokal")).toBe(true);
    expect(isCupCompetition("Coppa Italia")).toBe(true);
    expect(isCupCompetition("Leagues Cup")).toBe(true);
    expect(isCupCompetition("FA Cup")).toBe(true);
    expect(isCupCompetition("UEFA Champions League")).toBe(true);
    expect(isCupCompetition("Major League Soccer")).toBe(false);
    expect(isCupCompetition("USL Championship")).toBe(false);
    expect(isCupCompetition("Bundesliga")).toBe(false);
  });
});

describe("normalizeRawScore", () => {
  it("preserves rank order exactly — a purely monotonic raw-to-display mapping", () => {
    // All values stay under the 0.7 ceiling so none clamp to 100 — clamped
    // ties are an expected, separate property of a bounded 0-100 scale, not
    // something this monotonicity test is meant to exercise.
    const rawValues = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65];
    const scored = rawValues.map((raw) => ({ raw, score: normalizeRawScore(raw) }));
    const byRawDesc = [...scored].sort((a, b) => b.raw - a.raw);
    const byScoreDesc = [...scored].sort((a, b) => b.score - a.score);
    // Every raw value here is distinct enough that a monotonic mapping cannot
    // tie or invert their order (ties are only possible once several raws
    // clamp to 100, which is not the case in this sample).
    expect(byScoreDesc.map((s) => s.raw)).toEqual(byRawDesc.map((s) => s.raw));
  });

  it("spreads a typical pool across the scale instead of compressing it into the bottom third", () => {
    // A strong-but-not-maximal candidate (e.g. 0.55 raw, roughly what a
    // young MLS starter scores) should land in the 70s-80s, not the 20s.
    expect(normalizeRawScore(0.55)).toBeGreaterThanOrEqual(70);
  });
});

describe("computeQualityScore — league team propagation", () => {
  it("reports the primary league's team as leagueTeamName/leagueTeamId, not just its league", async () => {
    const result = await computeQualityScore({
      statistics: [{ ...clubBlock(78, "Bundesliga", { minutes: 900 }), team: { id: 157, name: "Bayern Munich" } }],
      minutes: 900,
      starts: 10,
      rating: "7.00",
      age: 19,
    });
    expect(result.inputs.leagueTeamId).toBe(157);
    expect(result.inputs.leagueTeamName).toBe("Bayern Munich");
  });
});

describe("quality score — required tuning scenarios", () => {
  it("a 26-year-old with 3000 minutes in Serie A ranks below a 19-year-old with 800 minutes in Serie A", async () => {
    const veteran = await computeQualityScore({
      statistics: [clubBlock(135, "Serie A", { minutes: 3000, lineups: 33, appearences: 33, rating: "7.20" })],
      minutes: 3000,
      starts: 33,
      rating: "7.20",
      age: 26,
    });
    const prospect = await computeQualityScore({
      statistics: [clubBlock(135, "Serie A", { minutes: 800, lineups: 9, appearences: 10, rating: "6.80" })],
      minutes: 800,
      starts: 9,
      rating: "6.80",
      age: 19,
    });
    expect(prospect.score).toBeGreaterThan(veteran.score);
  });

  it("a Bundesliga player with 2000 league minutes and 200 DFB Pokal minutes is scored with the Bundesliga coefficient, not the fallback", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);
    const result = await computeQualityScore({
      statistics: [
        clubBlock(78, "Bundesliga", { minutes: 2000, lineups: 22, appearences: 22, rating: "7.00" }),
        clubBlock(9999, "DFB Pokal", { minutes: 200, lineups: 2, appearences: 2, rating: "7.50" }),
      ],
      minutes: 2000,
      starts: 22,
      rating: "7.00",
      age: 21,
    });
    expect(result.inputs.leagueId).toBe(78);
    expect(result.inputs.coefficient).toBe(1.0); // Bundesliga's real coefficient, not the 0.25 fallback
    warnSpy.mockRestore();
  });

  it("a player with only cup appearances gets the unknown-league coefficient and logs a warning", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);
    const result = await computeQualityScore({
      statistics: [clubBlock(9998, "Coppa Italia", { minutes: 300, lineups: 3, appearences: 3, rating: "7.00" })],
      minutes: 300,
      starts: 3,
      rating: "7.00",
      age: 20,
    });
    expect(result.inputs.leagueId).toBeNull();
    expect(result.inputs.coefficient).toBe(0.25);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ leagueName: null }),
      expect.stringContaining("no league id"),
    );
    warnSpy.mockRestore();
  });
});
