import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { fixturesTable } from "@workspace/db";
import type { AfFixture } from "../fixtureReconciliation.js";
import type { StoredNationalTeamFixture } from "../nationalTeamFixtureUpdate.js";

type Row = StoredNationalTeamFixture & { id: number; homeTeam: string; awayTeam: string };
type Update = Partial<typeof fixturesTable.$inferInsert>;
const state = vi.hoisted(() => ({
  rows: [] as Row[],
  updates: [] as Update[],
  deletes: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      select: () => ({ from: () => ({ where: async () => state.rows }) }),
      update: () => ({
        set: (payload: Update) => ({
          where: async () => { state.updates.push(payload); },
        }),
      }),
      delete: () => ({ where: state.deletes }),
    },
  };
});
vi.mock("../logger.js", () => ({
  logger: { info: state.info, warn: state.warn, error: vi.fn() },
}));

const currentSeason = "/fixtures?team=2384&season=2027";
const previousSeason = "/fixtures?team=2384&season=2026";
const nextWindow = "/fixtures?team=2384&next=10";
const lastWindow = "/fixtures?team=2384&last=10";
const allPaths = [currentSeason, previousSeason, nextWindow, lastWindow];
let responses: Map<string, AfFixture[]>;
let rejected: Set<string>;
let requested: string[];

function stored(apiId = 927001, id = 1): Row {
  return {
    id, apiFootballFixtureId: apiId, homeTeam: "USA", awayTeam: "Haiti",
    status: "scheduled", homeScore: null, awayScore: null,
    kickoff: new Date("2027-03-25T16:00:00Z"), kickoffTimeTbd: true,
    venue: "TBD", city: null, ntLevel: "SENIOR",
  };
}

function provider(id = 927001, short = "NS"): AfFixture & { league: { season: number } } {
  return {
    fixture: {
      id, date: "2027-03-25T18:00:00Z", status: { short, elapsed: null },
      venue: { name: "Confirmed Stadium", city: "Confirmed City" },
    },
    teams: {
      home: { id: 2384, name: "USA", logo: "usa.png" },
      away: { id: 2386, name: "Haiti", logo: "haiti.png" },
    },
    league: { name: "CONCACAF Nations League", season: 2025 },
    goals: { home: short === "FT" ? 2 : null, away: short === "FT" ? 1 : null },
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
  responses = new Map(allPaths.map(path => [path, []]));
  rejected = new Set();
  requested = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
    const parsed = new URL(String(url));
    const path = parsed.pathname + parsed.search;
    if (path === "/teams?search=USA") {
      return new Response(JSON.stringify({
        response: [{ team: { id: 2384, name: "USA", national: true } }], errors: [],
      }));
    }
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
  const { syncNationalTeamFixtures } = await import("../apiFootballSync.js");
  const pending = syncNationalTeamFixtures();
  // Exercise the real shared throttle without waiting for wall-clock sleeps.
  await vi.runAllTimersAsync();
  return pending;
}

function updateLogs() {
  return state.info.mock.calls.filter(([, message]) => message === "NT fixture sync: updated fixture");
}

describe("season-independent senior USA fixture windows — change verifying", () => {
  it("2027-01-05: next-only season-2025 fixture applies status and venue updates", async () => {
    state.rows = [stored()];
    responses.set(nextWindow, [provider(927001, "PST")]);
    const result = await runSync();
    expect(result.fixturesUpdated).toBe(1);
    expect(state.updates).toEqual([expect.objectContaining({
      status: "postponed", homeScore: null, awayScore: null,
      venue: "Confirmed Stadium", city: "Confirmed City",
    })]);
    // Preserve Prompt 25: a postponed API fixture does not replace kickoff.
    expect(state.updates[0]).not.toHaveProperty("kickoff");
  });

  it("2027-01-05: next-only NS fixture applies all schedule-detail fields", async () => {
    state.rows = [stored()];
    responses.set(nextWindow, [provider()]);
    const result = await runSync();
    expect(result.fixturesUpdated).toBe(1);
    expect(state.updates).toEqual([expect.objectContaining({
      status: "scheduled", kickoff: new Date("2027-03-25T18:00:00Z"),
      kickoffTimeTbd: false, venue: "Confirmed Stadium", city: "Confirmed City",
    })]);
    for (const field of ["kickoff", "kickoffTimeTbd", "venue", "city"]) {
      expect(state.info).toHaveBeenCalledWith(
        expect.objectContaining({ fixtureId: 1, afFixtureId: 927001, field }),
        "NT fixture sync: schedule detail changed",
      );
    }
  });

  it("2027-03-29: last-only season-2025 FT fixture applies the final score", async () => {
    vi.setSystemTime(new Date("2027-03-29T12:00:00Z"));
    state.rows = [stored()];
    responses.set(lastWindow, [provider(927001, "FT")]);
    const result = await runSync();
    expect(result.fixturesUpdated).toBe(1);
    expect(state.updates).toEqual([expect.objectContaining({
      status: "finished", homeScore: 2, awayScore: 1, elapsedMinute: null,
    })]);
  });

  it("2027-03-20: a next-only fixture binds a negative sentinel within one day", async () => {
    vi.setSystemTime(new Date("2027-03-20T12:00:00Z"));
    state.rows = [stored(-927001)];
    responses.set(nextWindow, [provider()]);
    const result = await runSync();
    expect(result).toMatchObject({ fixturesUpdated: 1, idsBound: 1, phantomsPurged: 0 });
    expect(state.updates).toEqual([expect.objectContaining({
      apiFootballFixtureId: 927001, homeLogoUrl: "usa.png", awayLogoUrl: "haiti.png",
    })]);
    expect(state.deletes).not.toHaveBeenCalled();
  });

  it.each(allPaths)("a failed %s still uses all three other responses and logs WARN", async failedPath => {
    vi.setSystemTime(new Date("2027-03-29T12:00:00Z"));
    rejected.add(failedPath);
    const successfulIds: number[] = [];
    allPaths.forEach((path, index) => {
      const id = 927010 + index;
      state.rows.push(stored(id, index + 1));
      responses.set(path, [provider(id, "FT")]);
      if (path !== failedPath) successfulIds.push(id);
    });
    const result = await runSync();
    expect(result.fixturesUpdated).toBe(3);
    expect(state.updates).toHaveLength(3);
    expect(requested).toEqual(allPaths);
    expect(updateLogs().map(([data]) => data.afFixtureId)).toEqual(successfulIds);
    expect(state.warn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining("fetch failed"),
    );
  });
});

describe("senior NT fixture-fetch regression guards — green before and after", () => {
  it("a duplicate in season and next produces one update and one fixture-update log", async () => {
    state.rows = [{ ...stored(), venue: "Confirmed Stadium" }];
    const match = provider(927001, "FT");
    responses.set(currentSeason, [match]);
    responses.set(nextWindow, [match]);
    const result = await runSync();
    expect(result.fixturesUpdated).toBe(1);
    expect(state.updates).toHaveLength(1);
    expect(updateLogs()).toHaveLength(1);
  });

  it.each([currentSeason, previousSeason])("a failed %s leaves the other season usable", async failedPath => {
    state.rows = [stored()];
    rejected.add(failedPath);
    responses.set(failedPath === currentSeason ? previousSeason : currentSeason, [provider(927001, "FT")]);
    const result = await runSync();
    expect(result.fixturesUpdated).toBe(1);
    expect(state.updates).toEqual([expect.objectContaining({
      status: "finished", homeScore: 2, awayScore: 1,
    })]);
    expect(state.warn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining("fetch failed"),
    );
  });
});
