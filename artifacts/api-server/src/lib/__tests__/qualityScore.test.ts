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
  it("a 17-year-old with 600 minutes in the Bundesliga outranks a 22-year-old with 2500 minutes in the same league", async () => {
    const young = await computeQualityScore({
      statistics: [clubBlock(78, "Bundesliga", { minutes: 600, lineups: 7, appearences: 8, rating: "7.00" })],
      minutes: 600,
      starts: 7,
      rating: "7.00",
      age: 17,
    });
    const older = await computeQualityScore({
      statistics: [clubBlock(78, "Bundesliga", { minutes: 2500, lineups: 28, appearences: 28, rating: "7.00" })],
      minutes: 2500,
      starts: 28,
      rating: "7.00",
      age: 22,
    });
    expect(young.score).toBeGreaterThan(older.score);
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
  it("returns the table value at each boundary and clamps outside it", () => {
    expect(ageMultiplierFor(16)).toBe(2.0);
    expect(ageMultiplierFor(10)).toBe(2.0); // clamps for anything younger than the table's floor
    expect(ageMultiplierFor(17)).toBe(1.8);
    expect(ageMultiplierFor(22)).toBe(1.0);
    expect(ageMultiplierFor(23)).toBe(0.9);
    expect(ageMultiplierFor(30)).toBe(0.9); // clamps at the table's ceiling
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
});
