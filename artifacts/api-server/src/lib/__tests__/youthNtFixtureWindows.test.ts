import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { fixturesTable } from "@workspace/db";
import type { AfFixture } from "../fixtureReconciliation.js";

type Row = typeof fixturesTable.$inferSelect;
type Update = Partial<typeof fixturesTable.$inferInsert>;
const state = vi.hoisted(() => ({
  rows: [] as Row[], updates: [] as { id: number; payload: Update }[],
  lookups: [] as number[], deleted: [] as number[],
  info: vi.fn(), warn: vi.fn(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const parameter = (condition: SQL) => Number(new PgDialect().sqlToQuery(condition).params[0]);
  return {
    ...actual,
    db: {
      select: (columns: Record<string, unknown>) => ({
        from: () => ({
          where: async (condition: SQL) => {
            if ("kickoff" in columns) return state.rows; // actual purge's candidate query
            const apiId = parameter(condition);
            state.lookups.push(apiId);
            return state.rows.filter(row => row.apiFootballFixtureId === apiId);
          },
        }),
      }),
      update: () => ({
        set: (payload: Update) => ({
          where: async (condition: SQL) => {
            const id = parameter(condition);
            state.updates.push({ id, payload });
            Object.assign(state.rows.find(row => row.id === id)!, payload);
          },
        }),
      }),
      delete: () => ({
        where: async (condition: SQL) => { state.deleted.push(parameter(condition)); },
      }),
      insert: () => ({ values: vi.fn(() => { throw new Error("Unexpected insert in update-only test"); }) }),
    },
  };
});
vi.mock("../logger.js", () => ({
  logger: { info: state.info, warn: state.warn, error: vi.fn() },
}));

const teams = [10306, 12522, 17883, 27072];
const paths = (team: number) => [
  `/fixtures?team=${team}&season=2027`, `/fixtures?team=${team}&season=2026`,
  `/fixtures?team=${team}&next=10`, `/fixtures?team=${team}&last=10`,
];
const [currentSeason, previousSeason, nextWindow, lastWindow] = paths(10306);
let responses: Map<string, AfFixture[]>;
let rejected: Set<string>;
let requested: string[];

function stored(apiId = 930001, id = 1, group = "U20"): Row {
  return {
    id, apiFootballFixtureId: apiId, isNationalTeam: true, ntLevel: group,
    homeTeam: `United States ${group}`, awayTeam: `Brazil ${group}`,
    competition: `World Cup ${group}`, kickoff: new Date("2027-03-25T18:00:00Z"),
    status: "scheduled", homeScore: null, awayScore: null, elapsedMinute: null,
    venue: "Test stadium", city: null, homeLogoUrl: null, awayLogoUrl: null,
    kickoffTimeTbd: false, tvNetwork: null, streamingService: null, broadcastSetByAdmin: false,
    createdAt: new Date("2027-01-01T00:00:00Z"), squadSyncedAt: null, broadcastLink: null,
  };
}
function provider(id = 930001, short = "FT"): AfFixture & { league: { season: number } } {
  return {
    fixture: {
      id, date: "2027-03-25T18:00:00Z", status: { short, elapsed: short === "1H" ? 20 : null },
      venue: { name: "Test stadium" },
    },
    teams: {
      home: { id: 10306, name: "United States U20", logo: null },
      away: { id: 19000, name: "Brazil U20", logo: null },
    },
    league: { name: "World Cup U20", season: 2025 },
    goals: { home: 2, away: 1 },
  };
}
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2027-01-05T12:00:00Z"));
  vi.stubEnv("API_FOOTBALL_KEY", "mock-provider-credential");
  state.rows = [];
  state.updates = [];
  state.lookups = [];
  state.deleted = [];
  responses = new Map(teams.flatMap(paths).map(path => [path, []]));
  rejected = new Set();
  requested = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
    const parsed = new URL(String(url));
    const path = parsed.pathname + parsed.search;
    requested.push(path);
    if (rejected.has(path)) throw new Error("mock provider outage");
    if (!responses.has(path)) throw new Error("Unexpected mocked provider path: " + path);
    return new Response(JSON.stringify({ response: responses.get(path), errors: [] }));
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function runSync() {
  const { syncYouthNtFixtures } = await import("../apiFootballSync.js");
  const pending = syncYouthNtFixtures();
  await vi.runAllTimersAsync(); // exercise the real shared throttle, with no real HTTP
  return pending;
}
function completedU20() {
  return state.info.mock.calls.find(([data, message]) =>
    data?.teamId === 10306 && message === "Youth NT fixture sync: finished processing team")?.[0];
}
function fetchWarnings() {
  return state.warn.mock.calls.filter(([, message]) => String(message).includes("fetch failed"));
}

describe("youth season-independent windows — change-verifying", () => {
  it("1: 2027-01-05 updates a fixture found only in next, under season 2025", async () => {
    state.rows = [stored()];
    responses.set(nextWindow, [provider(930001, "1H")]);
    const result = await runSync();
    expect(result.fixturesUpdated).toBe(1);
    expect(state.updates).toEqual([{ id: 1, payload: {
      status: "live", homeScore: 2, awayScore: 1, elapsedMinute: 20,
    } }]);
    expect(state.deleted).not.toContain(1);
  });
  it("2: 2027-03-29 updates a last-only FT fixture with its final score", async () => {
    vi.setSystemTime(new Date("2027-03-29T12:00:00Z"));
    state.rows = [stored()];
    responses.set(lastWindow, [provider()]);
    expect((await runSync()).fixturesUpdated).toBe(1);
    expect(state.updates).toEqual([{ id: 1, payload: {
      status: "finished", homeScore: 2, awayScore: 1, elapsedMinute: null,
    } }]);
  });
  it.each([nextWindow, lastWindow])("3: a failed %s blocks only that team's purge", async failedPath => {
    state.rows = [stored(), stored(930002, 2, "U17")];
    rejected.add(failedPath);
    const result = await runSync();
    expect(result.failures).toBe(1);
    expect(state.deleted).not.toContain(1);
    expect(state.deleted).toContain(2); // the other team still has complete data
    expect(state.warn).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: 10306, fetchComplete: false }),
      expect.stringContaining("no US-participant fixtures"),
    );
    expect(fetchWarnings()).toHaveLength(1);
  });
  it.each(paths(10306))("4: if %s fails, all three successful responses are used", async failedPath => {
    rejected.add(failedPath);
    const survivingIds: number[] = [];
    paths(10306).forEach((path, index) => {
      const apiId = 930010 + index;
      state.rows.push(stored(apiId, index + 10));
      responses.set(path, [provider(apiId)]);
      if (path !== failedPath) survivingIds.push(index + 10);
    });
    const result = await runSync();
    expect(result.fixturesUpdated).toBe(3);
    expect(result.failures).toBe(1);
    expect(state.updates.map(update => update.id)).toEqual(survivingIds);
    expect(requested).toEqual(teams.flatMap(paths));
    expect(completedU20()).toMatchObject({ fetchComplete: false });
    expect(state.deleted).not.toContain(10 + paths(10306).indexOf(failedPath));
    expect(fetchWarnings()).toHaveLength(1);
  });
});

describe("youth season-fetch regression guards — green before and after", () => {
  it("5: season fixture is processed once, including when next/last overlap after expansion", async () => {
    state.rows = [stored()];
    const match = provider();
    responses.set(currentSeason, [match]);
    responses.set(nextWindow, [match]);
    responses.set(lastWindow, [match]);
    const result = await runSync();
    expect(result.fixturesUpdated).toBe(1);
    expect(state.lookups).toEqual([match.fixture.id]);
    expect(state.updates).toHaveLength(1);
  });
  it.each([currentSeason, previousSeason])("6: failed %s remains incomplete but uses the other season", async failedPath => {
    state.rows = [stored(), stored(930002, 2)];
    rejected.add(failedPath);
    responses.set(failedPath === currentSeason ? previousSeason : currentSeason, [provider()]);
    const result = await runSync();
    expect(result).toMatchObject({ failures: 1, fixturesUpdated: 1, phantomsPurged: 0 });
    expect(completedU20()).toMatchObject({ fetchComplete: false });
    expect(state.deleted).not.toContain(2);
    expect(fetchWarnings()).toHaveLength(1);
  });
});

describe("Olympic-cycle teams (U23 / U21) — change-verifying", () => {
  it("7: the U21 team (where API-Football lists the 2026 'U-23' camp) is fetched and its fixtures kept up to date", async () => {
    state.rows = [stored(930050, 50, "U21")];
    const match = provider(930050);
    match.teams.home = { id: 8221, name: "Scotland U21", logo: null };
    match.teams.away = { id: 27072, name: "USA U21", logo: null };
    responses.set("/fixtures?team=27072&next=10", [match]);
    const result = await runSync();
    expect(requested).toEqual(expect.arrayContaining([...paths(17883), ...paths(27072)]));
    expect(result.fixturesUpdated).toBe(1);
    expect(state.updates).toEqual([{ id: 50, payload: {
      status: "finished", homeScore: 2, awayScore: 1, elapsedMinute: null,
    } }]);
    expect(state.deleted).not.toContain(50);
  });

  it("8: USA U21 and United States U23 are classified, so they stay off the senior Schedule", async () => {
    const { deriveNtLevel } = await import("../apiFootballSync.js");
    expect(deriveNtLevel("Scotland U21", "USA U21")).toBe("U21");
    expect(deriveNtLevel("United States U23", "Japan U23")).toBe("U23");
    expect(deriveNtLevel("United States U20", "Georgia U21")).toBe("U20");
  });

  it("9: a US U20 match against a U21 opponent is never purged on the U21 team's data", async () => {
    state.rows = [{ ...stored(930060, 60, "U20"), awayTeam: "Georgia U21" }];
    rejected.add(nextWindow); // U20 data incomplete; U17, U23 and U21 complete and empty
    await runSync();
    expect(state.deleted).not.toContain(60);
  });
});
