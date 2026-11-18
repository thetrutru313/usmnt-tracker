/**
 * March 2027 Nations League Finals placeholders, and seeding that survives
 * the NT sync renaming a placeholder when it binds it.
 *
 * - The canonical list has the USA vs Mexico semifinal (Mar 25) and a
 *   "USA vs TBD" final / third-place match (Mar 28).
 * - Binding can rename a row: "USA vs TBD" gets its real opponent, and a pair
 *   the API lists the other way round is swapped. The next startup seed must
 *   still recognise the row as the same match and not insert a new
 *   placeholder.
 *
 * DB tests run in a rolled-back transaction with temp tables shadowing
 * fixtures and fixture_players, with synthetic 2099 matches.
 */
import { describe, expect, it } from "vitest";
import { db, fixturesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { seedSeniorSentinelFixtures, SENIOR_SENTINEL_FIXTURES, type MatchDef } from "../ntFixtureSeeds";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const base = {
  homeLogoUrl: "https://media.api-sports.io/football/teams/2384.png",
  awayLogoUrl: null,
  competition: "__finals_test__",
  kickoffTimeTbd: true,
  venue: "SoFi Stadium", city: "Inglewood, CA", tvNetwork: "TNT", streamingService: "HBO Max",
};
const SEMI: MatchDef = {
  ...base, sentinelId: -9901, homeTeam: "USA", awayTeam: "Mexico",
  kickoffUtc: "2099-03-26 00:00:00+00",
  windowStart: "2099-03-24 00:00:00+00", windowEnd: "2099-03-26 23:59:59+00",
};
const SUNDAY: MatchDef = {
  ...base, sentinelId: -9902, homeTeam: "USA", awayTeam: "TBD",
  kickoffUtc: "2099-03-29 00:00:00+00",
  windowStart: "2099-03-28 12:00:00+00", windowEnd: "2099-03-30 23:59:59+00",
};

async function sandbox(check: (tx: Tx) => Promise<void>) {
  const rollback = new Error("rollback isolated finals seed test");
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`CREATE TEMP TABLE fixtures (LIKE public.fixtures INCLUDING ALL) ON COMMIT DROP`);
      await tx.execute(sql`CREATE TEMP TABLE fixture_players (LIKE public.fixture_players INCLUDING ALL) ON COMMIT DROP`);
      await check(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}
const rows = (tx: Tx) => tx.select().from(fixturesTable).orderBy(fixturesTable.kickoff);

describe("March 2027 Finals entries", () => {
  it("1: the list has the Mexico semifinal and a TBD Sunday match at SoFi, both Time TBD on the right US dates", () => {
    const semi = SENIOR_SENTINEL_FIXTURES.find((m) => m.sentinelId === -2008);
    const sunday = SENIOR_SENTINEL_FIXTURES.find((m) => m.sentinelId === -2009);
    expect(semi).toMatchObject({
      homeTeam: "USA", awayTeam: "Mexico", competition: "CONCACAF Nations League",
      kickoffUtc: "2027-03-26 00:00:00+00", kickoffTimeTbd: true,
      venue: "SoFi Stadium", city: "Inglewood, CA", tvNetwork: "TNT", streamingService: "HBO Max",
    });
    expect(sunday).toMatchObject({
      homeTeam: "USA", awayTeam: "TBD", competition: "CONCACAF Nations League",
      kickoffUtc: "2027-03-29 00:00:00+00", kickoffTimeTbd: true, awayLogoUrl: null,
      venue: "SoFi Stadium", city: "Inglewood, CA", tvNetwork: "TNT", streamingService: "HBO Max",
    });
    // 00:00 UTC is 5 PM PDT the day before: Mar 25 and Mar 28 in US time.
    // Windows don't overlap, so Sunday's placeholder can't claim a semifinal.
    expect(Date.parse(semi!.windowEnd)).toBeLessThan(Date.parse(sunday!.windowStart));
  });
});

describe("startup seed and placeholders renamed by binding", () => {
  it("2: a bound Sunday placeholder with its real opponent is not seeded again", async () => {
    await sandbox(async (tx) => {
      await seedSeniorSentinelFixtures(tx, [SEMI, SUNDAY]);
      const sunday = (await rows(tx)).find((r) => r.apiFootballFixtureId === -9902)!;
      await tx.execute(sql`UPDATE fixtures SET api_football_fixture_id = 9990002, home_team = 'Canada', away_team = 'USA' WHERE id = ${sunday.id}`);
      await seedSeniorSentinelFixtures(tx, [SEMI, SUNDAY]);
      expect((await rows(tx)).map((r) => [r.apiFootballFixtureId, r.homeTeam, r.awayTeam])).toEqual([
        [-9901, "USA", "Mexico"],
        [9990002, "Canada", "USA"],
      ]);
    });
  });

  it("3: a bound semifinal the API lists as Mexico v USA is not seeded again", async () => {
    await sandbox(async (tx) => {
      await seedSeniorSentinelFixtures(tx, [SEMI]);
      await tx.execute(sql`UPDATE fixtures SET api_football_fixture_id = 9990001, home_team = 'Mexico', away_team = 'USA' WHERE api_football_fixture_id = -9901`);
      await seedSeniorSentinelFixtures(tx, [SEMI]);
      expect((await rows(tx)).map((r) => [r.apiFootballFixtureId, r.homeTeam, r.awayTeam])).toEqual([
        [9990001, "Mexico", "USA"],
      ]);
    });
  });

  it("4: from empty, both placeholders are inserted, and seeding again changes nothing (existing behaviour)", async () => {
    await sandbox(async (tx) => {
      await seedSeniorSentinelFixtures(tx, [SEMI, SUNDAY]);
      await seedSeniorSentinelFixtures(tx, [SEMI, SUNDAY]);
      expect((await rows(tx)).map((r) => [r.apiFootballFixtureId, r.homeTeam, r.awayTeam, r.kickoffTimeTbd])).toEqual([
        [-9901, "USA", "Mexico", true],
        [-9902, "USA", "TBD", true],
      ]);
    });
  });
});
