import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, clubsTable, playersTable, fixturesTable, fixturePlayersTable, matchLogsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import app from "../../app";
import { syncSeniorNtSquads } from "../usmntSync";
import type { AfFixtureListItem, AfFixturePlayersTeam } from "../playerStatsSync";

const sandbox = vi.hoisted(() => ({ transaction: null as unknown }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: new Proxy(actual.db, {
      get(target, property) {
        const source = (sandbox.transaction ?? target) as typeof actual.db;
        const value = Reflect.get(source, property);
        return typeof value === "function" ? value.bind(source) : value;
      },
    }),
  };
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const now = new Date("2026-10-10T12:00:00Z");
const base = { isNationalTeam: true, ntLevel: "SENIOR", status: "finished", kickoff: new Date("2026-10-09T00:00:00Z"), competition: "International Friendly", homeTeam: "USA", awayTeam: "Canada", venue: "Test" };
function squad(size = 11): AfFixturePlayersTeam[] {
  return [{ team: { id: 2384, name: "USA" }, players: Array.from({ length: size }, (_, i) => ({
    player: { id: i + 101, name: `Player ${i + 1}` },
    statistics: [{ games: { minutes: i === 0 ? 90 : null, rating: "7.4", position: "M" }, goals: { total: 1, assists: 0 } }],
  })) }];
}
const fixtureItem = (id: number): AfFixtureListItem => ({
  fixture: { id, date: base.kickoff.toISOString(), status: { short: "FT" } },
  teams: { home: { id: 2384, name: "USA" }, away: { id: 5529, name: "Canada" } },
  goals: { home: 1, away: 0 }, league: { name: base.competition },
});
const options = () => ({
  now: () => now,
  fetchPlayers: vi.fn(async (_id: number) => squad()),
  fetchFixture: vi.fn(async (id: number) => fixtureItem(id)),
});
async function isolated(check: (tx: Tx) => Promise<void>) {
  const rollback = new Error("rollback isolated squad test");
  try {
    await db.transaction(async (tx) => {
      sandbox.transaction = tx;
      for (const table of ["clubs", "players", "fixtures", "fixture_players", "match_logs"]) {
        await tx.execute(sql.raw(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`));
      }
      await tx.insert(clubsTable).values({ id: 1, name: "Test club", league: "Test", country: "USA" });
      await tx.insert(playersTable).values(Array.from({ length: 4 }, (_, i) => ({
        id: i + 1, name: `Player ${i + 1}`, slug: `test-player-${i + 1}`, position: "MF",
        category: "current", age: 23, clubId: 1, apiFootballPlayerId: i + 101,
      })));
      await check(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    sandbox.transaction = null;
  }
}
const log = (playerId: number, apiId: number) => ({
  playerId, apiFootballFixtureId: apiId, date: "2026-10-09", opponent: "Canada", competition: base.competition,
  result: "W 1-0", minutes: 90, goals: 0, assists: 0, isNationalTeam: true, cycle: "2030 World Cup",
});

describe("syncSeniorNtSquads — transaction-local temp tables, injected API and time", () => {
  it("1: B1 links logged pool players even outside the API window, with no duplicates", async () => {
    await isolated(async (tx) => {
      await tx.insert(fixturesTable).values({ ...base, id: 1, apiFootballFixtureId: 901, kickoff: new Date("2026-01-01") });
      await tx.insert(matchLogsTable).values([log(1, 901), log(2, 901)]);
      const opts = options();
      expect(await syncSeniorNtSquads(opts)).toMatchObject({ fixturesLinkedFromLogs: 1, linksInserted: 2, apiCallsMade: 0 });
      expect(await tx.select().from(fixturePlayersTable)).toEqual([
        expect.objectContaining({ playerId: 1, clubId: null }),
        expect.objectContaining({ playerId: 2, clubId: null }),
      ]);
      expect(await syncSeniorNtSquads(opts)).toMatchObject({ linksInserted: 0, apiCallsMade: 0 });
      expect(opts.fetchPlayers).not.toHaveBeenCalled();
    });
  });
  it("2: unused tracked substitute is linked and returned with matchLog null by the real route", async () => {
    await isolated(async (tx) => {
      await tx.insert(fixturesTable).values({ ...base, id: 1, apiFootballFixtureId: 902 });
      await syncSeniorNtSquads(options());
      const response = await request(app).get("/api/fixtures/1").expect(200);
      expect(response.body.trackedPlayers).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 2, matchLog: null }),
      ]));
    });
  });
  it("3: inserts a missing appearance log using the shared field mapping", async () => {
    await isolated(async (tx) => {
      await tx.insert(fixturesTable).values({ ...base, id: 1, apiFootballFixtureId: 903 });
      const result = await syncSeniorNtSquads(options());
      expect(result.logsInserted).toBe(1);
      expect(await tx.select().from(matchLogsTable)).toEqual([
        expect.objectContaining({ playerId: 1, minutes: 90, goals: 1, assists: 0, rating: 7.4, conceded: 0, result: "W 1-0", cycle: "2030 World Cup" }),
      ]);
    });
  });
  it("4: removes only unlogged outsiders with club_id NULL", async () => {
    await isolated(async (tx) => {
      await tx.insert(fixturesTable).values({ ...base, id: 1, apiFootballFixtureId: 904 });
      await tx.insert(fixturePlayersTable).values([
        { fixtureId: 1, playerId: 3, clubId: null }, { fixtureId: 1, playerId: 4, clubId: 1 },
      ]);
      await tx.insert(matchLogsTable).values(log(2, 904));
      const opts = options();
      opts.fetchPlayers.mockResolvedValue([{ ...squad(14)[0]!, players: squad(14)[0]!.players.filter((p) => ![102, 103, 104].includes(p.player.id)) }]);
      const result = await syncSeniorNtSquads(opts);
      expect(result.linksRemoved).toBe(1);
      expect((await tx.select().from(fixturePlayersTable)).map((link) => link.playerId).sort()).toEqual([1, 2, 4]);
      expect((await tx.select().from(fixturePlayersTable)).find((link) => link.playerId === 4)!.clubId).toBe(1);
    });
  });
  it("5: full and old thin squads are stamped, recent thin squads stay pending", async () => {
    await isolated(async (tx) => {
      await tx.insert(fixturesTable).values([
        { ...base, id: 1, apiFootballFixtureId: 905 },
        { ...base, id: 2, apiFootballFixtureId: 906 },
        { ...base, id: 3, apiFootballFixtureId: 907, kickoff: new Date("2026-10-06T00:00:00Z") },
      ]);
      const opts = options();
      opts.fetchPlayers.mockImplementation(async (id: number) => id === 905 ? squad() : squad(3));
      await syncSeniorNtSquads(opts);
      const rows = await tx.select().from(fixturesTable).orderBy(fixturesTable.id);
      expect(rows.map((f) => f.squadSyncedAt)).toEqual([now, null, now]);
    });
  });
  it("6: with no work left pending, a second run has zero changes and zero fetches", async () => {
    await isolated(async (tx) => {
      await tx.insert(fixturesTable).values({ ...base, id: 1, apiFootballFixtureId: 908 });
      const opts = options();
      await syncSeniorNtSquads(opts);
      opts.fetchPlayers.mockClear(); opts.fetchFixture.mockClear();
      expect(await syncSeniorNtSquads(opts)).toEqual({ fixturesLinkedFromLogs: 0, linksInserted: 0, fixturesSquadSynced: 0, logsInserted: 0, linksRemoved: 0, apiCallsMade: 0 });
      expect(opts.fetchPlayers).not.toHaveBeenCalled();
      expect(opts.fetchFixture).not.toHaveBeenCalled();
    });
  });
  it("6b: already-stamped fixtures are never fetched while others remain pending", async () => {
    await isolated(async (tx) => {
      await tx.insert(fixturesTable).values([
        { ...base, id: 1, apiFootballFixtureId: 909, squadSyncedAt: now },
        { ...base, id: 2, apiFootballFixtureId: 910 },
      ]);
      const opts = options();
      await syncSeniorNtSquads(opts);
      expect(opts.fetchPlayers).toHaveBeenCalledExactlyOnceWith(910);
    });
  });
  it("7: excludes club, youth, scheduled and negative API-ID fixtures", async () => {
    await isolated(async (tx) => {
      await tx.insert(fixturesTable).values([
        { ...base, id: 1, apiFootballFixtureId: 911, isNationalTeam: false },
        { ...base, id: 2, apiFootballFixtureId: 912, ntLevel: "U20" },
        { ...base, id: 3, apiFootballFixtureId: 913, status: "scheduled" },
        { ...base, id: 4, apiFootballFixtureId: -914 },
      ]);
      await tx.insert(matchLogsTable).values([log(1, 911), log(1, 912), log(1, 913), log(1, -914)]);
      const opts = options();
      expect(await syncSeniorNtSquads(opts)).toMatchObject({ linksInserted: 0, apiCallsMade: 0 });
      expect(await tx.select().from(fixturePlayersTable)).toHaveLength(0);
      expect((await tx.select().from(fixturesTable)).every((f) => f.squadSyncedAt === null)).toBe(true);
      expect(opts.fetchPlayers).not.toHaveBeenCalled();
    });
  });
  it("8: syncs at most six, most-recent-first, and leaves the seventh for the next run", async () => {
    await isolated(async (tx) => {
      await tx.insert(fixturesTable).values(Array.from({ length: 7 }, (_, i) => ({ ...base, id: i + 1, apiFootballFixtureId: 920 + i, kickoff: new Date(`2026-10-0${i + 1}`) })));
      const opts = options();
      expect((await syncSeniorNtSquads(opts)).fixturesSquadSynced).toBe(6);
      expect(opts.fetchPlayers.mock.calls.map((args) => args[0])).toEqual([926, 925, 924, 923, 922, 921]);
      expect((await tx.select().from(fixturesTable).where(eq(fixturesTable.id, 1)))[0]!.squadSyncedAt).toBeNull();
      opts.fetchPlayers.mockClear();
      expect((await syncSeniorNtSquads(opts)).fixturesSquadSynced).toBe(1);
      expect(opts.fetchPlayers).toHaveBeenCalledExactlyOnceWith(920);
    });
  });
});
