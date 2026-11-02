import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: number; name: string; wikipediaTitle: string | null; nationalTeamCaps: number; nationalTeamGoals: number };
const state = vi.hoisted(() => ({
  rows: [] as Row[],
  writes: [] as Record<string, unknown>[],
  warn: vi.fn(), error: vi.fn(), info: vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  playersTable: { id: "id", name: "name", wikipediaTitle: "title", nationalTeamCaps: "caps", nationalTeamGoals: "goals" },
  db: {
    select: () => ({ from: async () => state.rows }),
    update: () => ({ set: (payload: Record<string, unknown>) => ({
      where: async () => { state.writes.push(payload); },
    }) }),
  },
}));
vi.mock("../logger", () => ({ logger: { warn: state.warn, error: state.error, info: state.info } }));

const oldSenior = (caps = 90, goals = 33) => `{{Infobox football biography
| nationalteam1 = [[United States men's national under-17 soccer team|United States U17]]
| nationalcaps1 = 12
| nationalgoals1 = 7
| nationalteam3 = [[United States men's national soccer team|United States]]
| nationalcaps3 = ${caps}
| nationalgoals3 = ${goals}
}}`;
const newSenior = oldSenior().replaceAll("nationalteam", "national_team").replaceAll("nationalcaps", "national_caps").replaceAll("nationalgoals", "national_goals") + `
| national_team2 = [[United States men's national under-15 soccer team|United States U15]]
| national_caps2 = 9
| national_goals2 = 5`;
const youthOnly = `{{Infobox soccer biography
| nationalteam1 = [[United States men's national under-17 soccer team|United States U17]]
| nationalcaps1 = 12
| nationalgoals1 = 7
}}`;
let pages: Record<string, string>;
let downloadFails: boolean;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
  state.rows = [{ id: 1, name: "Test Player", wikipediaTitle: "Test Player", nationalTeamCaps: 90, nationalTeamGoals: 33 }];
  state.writes = [];
  pages = { "Test Player": oldSenior() };
  downloadFails = false;
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (downloadFails) throw new Error("mock download failure");
    return new Response(JSON.stringify({
      query: { pages: Object.fromEntries(Object.entries(pages).map(([title, text], i) => [i + 1, {
        pageid: i + 1, title, index: i + 1, revisions: [{ slots: { main: { "*": text } } }],
      }])) },
    }));
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function run() {
  const { syncNationalTeamCapsAndGoals } = await import("../nationalTeamSync");
  const pending = syncNationalTeamCapsAndGoals();
  await vi.runAllTimersAsync();
  return pending;
}
function lastStats() {
  return state.writes.filter(p => "nationalTeamCaps" in p).at(-1);
}
function expectGuard(field: string, stored: number, parsed: number | null) {
  expect(state.warn).toHaveBeenCalledWith(expect.objectContaining({
    player: "Test Player", field, stored, parsed,
  }), expect.any(String));
}

describe("change-verifying sync behavior", () => {
  it("reads new-format senior 90/33 with indexed youth entries excluded", async () => {
    state.rows[0].nationalTeamCaps = 0;
    state.rows[0].nationalTeamGoals = 0;
    pages["Test Player"] = newSenior;
    await run();
    expect(lastStats()).toEqual({ nationalTeamCaps: 90, nationalTeamGoals: 33 });
  });
  it("resolver accepts a new-format US national team entry", async () => {
    state.rows[0].wikipediaTitle = null;
    pages["Test Player"] = newSenior;
    expect((await run()).playersResolved).toBe(1);
    expect(state.writes).toContainEqual({ wikipediaTitle: "Test Player" });
  });
  it("keeps stored totals and warns when no senior entry exists", async () => {
    pages["Test Player"] = youthOnly;
    await run();
    expect(lastStats()).toEqual({ nationalTeamCaps: 90, nationalTeamGoals: 33 });
    expectGuard("caps", 90, null);
    expectGuard("goals", 33, null);
  });
  it("keeps 90 caps when Wikipedia says 85 and warns", async () => {
    pages["Test Player"] = oldSenior(85, 33);
    await run();
    expect(lastStats()).toEqual({ nationalTeamCaps: 90, nationalTeamGoals: 33 });
    expectGuard("caps", 90, 85);
  });
  it("writes increased caps independently of decreased goals", async () => {
    pages["Test Player"] = oldSenior(91, 32);
    await run();
    expect(lastStats()).toEqual({ nationalTeamCaps: 91, nationalTeamGoals: 33 });
    expectGuard("goals", 33, 32);
  });
  it("writes increased goals independently of decreased caps", async () => {
    pages["Test Player"] = oldSenior(89, 34);
    await run();
    expect(lastStats()).toEqual({ nationalTeamCaps: 90, nationalTeamGoals: 34 });
    expectGuard("caps", 90, 89);
  });
  it("alarms above 20%, counting each initially capped player only once", async () => {
    state.rows = Array.from({ length: 4 }, (_, i) => ({
      id: i + 1, name: i ? `Other ${i}` : "Test Player", wikipediaTitle: `Page ${i}`, nationalTeamCaps: 90, nationalTeamGoals: 33,
    }));
    pages = Object.fromEntries(state.rows.map((p, i) => [p.wikipediaTitle!, oldSenior(i ? 90 : 85, i ? 33 : 32)]));
    await run();
    expect(state.error).toHaveBeenCalledWith(expect.objectContaining({
      cappedPlayers: 4, cappedPlayersGuarded: 1,
    }), "national-team infobox format may have changed");
  });
  it("counts goals-only guard toward the alarm", async () => {
    pages["Test Player"] = oldSenior(91, 32);
    await run();
    expect(state.error).toHaveBeenCalledWith(expect.objectContaining({
      cappedPlayers: 1, cappedPlayersGuarded: 1,
    }), "national-team infobox format may have changed");
  });
  it("classifies full piped team text, not only the link target", async () => {
    pages["Test Player"] = oldSenior().replace("national soccer team|United States", "national soccer team|United States under-17");
    await run();
    expect(lastStats()).toEqual({ nationalTeamCaps: 90, nationalTeamGoals: 33 });
    expectGuard("caps", 90, null);
  });
});

describe("existing-behavior regression guards", () => {
  it("reads old-format senior totals", async () => {
    await run();
    expect(lastStats()).toEqual({ nationalTeamCaps: 90, nationalTeamGoals: 33 });
  });
  it("keeps youth-only uncapped players at 0/0", async () => {
    state.rows[0].nationalTeamCaps = state.rows[0].nationalTeamGoals = 0;
    pages["Test Player"] = youthOnly;
    await run();
    expect(lastStats()).toEqual({ nationalTeamCaps: 0, nationalTeamGoals: 0 });
  });
  it("does not write when download fails", async () => {
    downloadFails = true;
    await run();
    expect(state.writes).toEqual([]);
    expect(state.error).not.toHaveBeenCalled();
  });
  it("does not treat national_team_update as an entry", async () => {
    state.rows[0].wikipediaTitle = null;
    pages["Test Player"] = "{{Infobox football biography\n| national_team_update = United States\n}}";
    expect((await run()).playersResolved).toBe(0);
    expect(state.writes).toEqual([]);
  });
  it("does not alarm at exactly 20%", async () => {
    state.rows = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1, name: `Player ${i}`, wikipediaTitle: `Page ${i}`, nationalTeamCaps: 90, nationalTeamGoals: 33,
    }));
    pages = Object.fromEntries(state.rows.map((p, i) => [p.wikipediaTitle!, oldSenior(i ? 90 : 85)]));
    await run();
    expect(state.error).not.toHaveBeenCalled();
  });
});
