/**
 * Player profile: recent matches (club and USMNT fetched separately, unused
 * senior squad appearances included), upcoming matches, and caps per cycle.
 * Dev database with a throwaway player, clubs and fixtures (removed in afterAll).
 * Past matches are dated 2020 and upcoming ones 2099, so no real window or
 * page is affected.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { db, clubsTable, fixturePlayersTable, fixturesTable, matchLogsTable, playerStatsTable, playersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const RUN = Date.now();
const API = 1_950_000_000 + Math.floor(Math.random() * 40_000_000);
const CYCLE = "__test cycle__";
const ids = { club: 0, oldClub: 0, player: 0, played: 0, unused: 0, upClub: 0, upOldClub: 0, upFriendly: 0, upNt: 0, justFinished: 0 };

type Match = { id: number; fixtureId: number | null; isNationalTeam: boolean; didNotPlay?: boolean; opponent: string; result: string; minutes: number; rating: number | null; kickoff?: string | null };
async function profile() {
  const res = await request(app).get(`/api/players/${ids.player}`).expect(200);
  return res.body as { matchLog: Match[]; upcomingFixtures: { id: number }[]; cycleCaps: number; nationalTeamStats: { season: string } };
}

beforeAll(async () => {
  const [club, oldClub] = await db.insert(clubsTable).values([
    { name: `__pm-club-${RUN}__`, league: "Test League", country: "Test" },
    { name: `__pm-old-club-${RUN}__`, league: "Test League", country: "Test" },
  ]).returning({ id: clubsTable.id });
  [ids.club, ids.oldClub] = [club!.id, oldClub!.id];
  const [player] = await db.insert(playersTable).values({
    name: "__pm-player__", slug: `__pm-player-${RUN}`, position: "DF", category: "fringe", clubId: ids.club,
    age: 24, nationalTeamCaps: 3, nationalTeamGoals: 0, worldCupRoster: false,
  }).returning({ id: playersTable.id });
  ids.player = player!.id;

  const senior = { isNationalTeam: true, ntLevel: "SENIOR", venue: "Test Park", competition: "International Friendly" };
  const club_ = { venue: "Test Park", competition: `__pm-league-${RUN}` };
  const rows = await db.insert(fixturesTable).values([
    { ...senior, apiFootballFixtureId: API, homeTeam: "USA", awayTeam: "Brazil", kickoff: new Date("2020-03-01T00:00:00Z"), status: "finished", homeScore: 1, awayScore: 0 },
    { ...senior, apiFootballFixtureId: API + 1, homeTeam: "Peru", awayTeam: "USA", kickoff: new Date("2020-03-05T00:00:00Z"), status: "finished", homeScore: 2, awayScore: 2 },
    { ...club_, homeTeam: `__pm-club-${RUN}__`, awayTeam: "Rival FC", kickoff: new Date("2099-01-10T15:00:00Z") },
    { ...club_, homeTeam: `__pm-old-club-${RUN}__`, awayTeam: "Rival FC", kickoff: new Date("2099-01-11T15:00:00Z") },
    { ...club_, competition: "Friendlies Clubs", homeTeam: `__pm-club-${RUN}__`, awayTeam: "Friendly FC", kickoff: new Date("2099-01-12T15:00:00Z") },
    { ...senior, homeTeam: "USA", awayTeam: `__pm-opp-${RUN}`, kickoff: new Date("2099-01-20T00:00:00Z") },
    { ...club_, homeTeam: `__pm-club-${RUN}__`, awayTeam: "Earlier FC", kickoff: new Date(Date.now() - 60 * 60 * 1000), status: "finished" },
  ]).returning({ id: fixturesTable.id });
  [ids.played, ids.unused, ids.upClub, ids.upOldClub, ids.upFriendly, ids.upNt, ids.justFinished] = rows.map((r) => r.id) as [number, number, number, number, number, number, number];

  await db.insert(fixturePlayersTable).values([
    { fixtureId: ids.played, playerId: ids.player, clubId: null },
    { fixtureId: ids.unused, playerId: ids.player, clubId: null },
    { fixtureId: ids.upClub, playerId: ids.player, clubId: ids.club },
    { fixtureId: ids.upOldClub, playerId: ids.player, clubId: ids.oldClub },
    { fixtureId: ids.upFriendly, playerId: ids.player, clubId: ids.club },
    { fixtureId: ids.upNt, playerId: ids.player, clubId: null },
    { fixtureId: ids.justFinished, playerId: ids.player, clubId: ids.club },
  ]);

  // 12 club matches, all newer than both USMNT matches.
  const clubLogs = Array.from({ length: 12 }, (_, i) => ({
    playerId: ids.player, date: `2020-04-${String(i + 10).padStart(2, "0")}`, opponent: `Club opp ${i}`,
    competition: `__pm-league-${RUN}`, result: "W 1-0", minutes: 90, goals: 0, assists: 0, rating: 7, isNationalTeam: false,
  }));
  await db.insert(matchLogsTable).values([
    ...clubLogs,
    // Played: one sub appearance (no start) in the cycle.
    { playerId: ids.player, apiFootballFixtureId: API, date: "2020-03-01", opponent: "Brazil", competition: "International Friendly",
      result: "W 1-0", minutes: 20, goals: 0, assists: 0, rating: 6.8, isNationalTeam: true, cycle: CYCLE },
  ]);
  await db.insert(playerStatsTable).values({
    playerId: ids.player, periodType: "national_team_cycle", season: CYCLE, minutes: 20, starts: 0,
  });
}, 30_000);

afterAll(async () => {
  if (ids.player) {
    await db.delete(matchLogsTable).where(eq(matchLogsTable.playerId, ids.player));
    await db.delete(playerStatsTable).where(eq(playerStatsTable.playerId, ids.player));
    await db.delete(fixturePlayersTable).where(eq(fixturePlayersTable.playerId, ids.player));
  }
  const fixtureIds = Object.entries(ids).filter(([k, v]) => !["club", "oldClub", "player"].includes(k) && v).map(([, v]) => v);
  if (fixtureIds.length) await db.delete(fixturesTable).where(inArray(fixturesTable.id, fixtureIds));
  if (ids.player) await db.delete(playersTable).where(eq(playersTable.id, ids.player));
  await db.delete(clubsTable).where(inArray(clubsTable.id, [ids.club, ids.oldClub].filter(Boolean)));
});

describe("player profile — recent matches", () => {
  it("1: USMNT matches are still there after a long run of newer club matches", async () => {
    const { matchLog } = await profile();
    const usmnt = matchLog.filter((m) => m.isNationalTeam);
    expect(usmnt.map((m) => m.opponent)).toEqual(["Peru", "Brazil"]);
    expect(matchLog.filter((m) => !m.isNationalTeam)).toHaveLength(10);
  });

  it("2: a squad match without minutes shows as an unused sub, with the score from the US side", async () => {
    const { matchLog } = await profile();
    expect(matchLog.find((m) => m.opponent === "Peru")).toMatchObject({
      didNotPlay: true, minutes: 0, rating: null, result: "D 2-2", fixtureId: ids.unused,
    });
    expect(matchLog.find((m) => m.opponent === "Brazil")).toMatchObject({ didNotPlay: false, minutes: 20, fixtureId: ids.played });
  });

  it("3: matches linked to a fixture carry its kickoff, so the app can show the viewer's local date", async () => {
    const { matchLog } = await profile();
    expect(matchLog.find((m) => m.opponent === "Brazil")!.kickoff).toBe("2020-03-01T00:00:00.000Z");
  });
});

describe("player profile — upcoming matches and caps", () => {
  it("4: lists club and USMNT matches, but not club friendlies, a previous club's matches, or a finished one", async () => {
    const { upcomingFixtures } = await profile();
    const shown = upcomingFixtures.map((f) => f.id);
    expect(shown).toEqual([ids.upClub, ids.upNt]);
  });

  it("5: caps this cycle counts appearances, including off the bench", async () => {
    const p = await profile();
    expect(p.nationalTeamStats.season).toBe(CYCLE);
    expect(p.cycleCaps).toBe(1);
  });
});
