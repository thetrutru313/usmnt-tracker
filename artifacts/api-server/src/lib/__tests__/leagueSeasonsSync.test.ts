import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => {
  const stats = {}, config = {}, clubs = {}, players = {};
  const writes: { table: unknown; payload: Record<string, unknown> }[] = [];
  const chain = (data: unknown[]) => Object.assign(Promise.resolve(data), { where: vi.fn().mockResolvedValue(data) });
  return {
    stats, config, clubs, players, writes,
    db: {
      select: vi.fn(() => ({ from: vi.fn((table) => chain(table === clubs
        ? [{ id: 1, name: "Danish club", apiFootballTeamId: 10 }]
        : table === players ? [{ id: 1, name: "Dane", clubId: 1, apiFootballPlayerId: 100 }] : [])) })),
      delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
      insert: vi.fn((table) => ({ values: vi.fn((payload) => {
        writes.push({ table, payload });
        return { then: (resolve: (v: unknown) => void) => resolve(undefined), onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) };
      }) })),
    },
    load: vi.fn(),
    fetch: vi.fn(),
  };
});
vi.mock("@workspace/db", () => ({ db: mocks.db, clubsTable: mocks.clubs, playersTable: mocks.players, playerStatsTable: mocks.stats, serverConfigTable: mocks.config, matchLogsTable: {}, injuriesTable: {} }));
vi.mock("../leagueSeasons", async (original) => ({ ...await original<typeof import("../leagueSeasons")>(), loadLeagueSeasons: mocks.load }));
vi.mock("../apiFootballSync", () => ({ afFetch: mocks.fetch, resolveTeamId: vi.fn().mockResolvedValue(10), FINISHED_STATUSES: new Set(["FT"]) }));
vi.mock("../playerClubSync", () => ({ ensurePlayerApiFootballIds: vi.fn(), ageFromBirthDate: () => null }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { syncPlayerStatsAndInjuries } from "../playerStatsSync";
afterEach(() => vi.useRealTimers());
it("A6 Danish sync avoids early UEFA season, stores primary league IDs, and overwrites empty needsRows", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-10T12:00:00Z"));
  mocks.load.mockResolvedValue([
    { apiFootballLeagueId: 119, leagueName: "Superliga", apiSeason: 2025, displayLabel: "2025/2026", startDate: "2025-07-18" },
    { apiFootballLeagueId: 119, leagueName: "Superliga", apiSeason: 2026, displayLabel: "2026/2027", startDate: "2026-07-24" },
  ]);
  mocks.fetch.mockImplementation(async (path: string) => {
    if (!path.startsWith("/players?id=100") || path.endsWith("2024")) return [];
    const year = Number(path.split("season=")[1]);
    return [{ player: { id: 100, birth: { date: null } }, statistics: [{
      team: { id: 10, name: "Danish club" },
      league: { id: year === 2026 ? 3 : 119, name: year === 2026 ? "UEFA Europa League" : "Superliga", season: year },
      games: { minutes: 90, lineups: 1, appearences: 1, position: "Midfielder", rating: "7.0" },
      goals: {}, shots: {}, passes: {}, tackles: {}, duels: {},
    }] }];
  });
  await syncPlayerStatsAndInjuries(0);
  const stats = mocks.writes.filter((w) => w.table === mocks.stats).map((w) => w.payload);
  expect(stats.find((r) => r.periodType === "season")).toMatchObject({ season: "2025", apiFootballLeagueId: 119 });
  expect(stats.filter((r) => r.periodType === "season_all")).toEqual(expect.arrayContaining([
    expect.objectContaining({ season: "2025", apiFootballLeagueId: 119 }),
    expect.objectContaining({ season: "2026", apiFootballLeagueId: null }),
  ]));
  const config = mocks.writes.find((w) => w.table === mocks.config && w.payload.key === "leagueSeasons.needsRows");
  expect(config).toBeDefined();
  expect(JSON.parse(String(config!.payload.value))).toEqual({ checkedAt: "2026-07-10T12:00:00.000Z", leagues: [] });
  expect(mocks.load).toHaveBeenCalledTimes(1);
});
