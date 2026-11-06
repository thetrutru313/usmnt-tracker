/**
 * The 5-minute cron tick: which matches it checks, status/score updates,
 * lineup and goal alerts, post-match stats timing, and the endpoint's auth.
 *
 * Dev database with throwaway rows (removed in afterAll). API-Football,
 * the post-match stats sync and web-push are mocked. Ticks run with NOW in
 * July 2099, so real dev matches are never in a window.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  afFetch: vi.fn(),
  postMatch: vi.fn(),
}));

vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() },
}));
vi.mock("../apiFootballSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../apiFootballSync")>()),
  afFetch: mocks.afFetch,
}));
vi.mock("../playerStatsSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../playerStatsSync")>()),
  syncStatsForFinishedFixture: mocks.postMatch,
}));

import webpush from "web-push";
import request from "supertest";
import app from "../../app.js";
import {
  db,
  anonUsersTable,
  clubsTable,
  fixturePlayersTable,
  fixturesTable,
  playersTable,
  pushEventsTable,
  pushSubscriptionsTable,
  userFollowsTable,
} from "@workspace/db";
import { eq, inArray, like, or } from "drizzle-orm";
import { generateToken, hashToken } from "../tokenUtils";
import { findDueFixtures, runTick, POST_MATCH_DELAY_MS } from "../tick";

const NOW = new Date("2099-07-01T15:00:00Z");
const MIN = 60_000;
const RUN = Date.now();
const KEYS = { p256dh: "B".repeat(87), auth: "A".repeat(22) };
const ALL_ON = {
  kickoff: true, lineups: true, goals: true, ratings: true,
  announcements: true, injuries: true, transfers: true,
};
const EP = {
  mine: `https://web.push.apple.com/__tick-mine-${RUN}`,
  all: `https://web.push.apple.com/__tick-all-${RUN}`,
};
const API_A = 1_800_000_000 + Math.floor(Math.random() * 50_000_000);
const API_B = API_A + 1;
const apiFix = API_A + 10; // fixture API ids: apiFix + 0..4

const ids = {
  club: 0, a: 0, b: 0, userMine: 0, userAll: 0,
  pre: 0, live: 0, past: 0, far: 0, done: 0,
};
const savedEnv: Record<string, string | undefined> = {};

/** API-Football /fixtures?id= responses for the test matches. */
function apiResponse(path: string) {
  const id = Number(new URLSearchParams(path.split("?")[1]).get("id"));
  const base = (short: string, elapsed: number | null, home: number | null, away: number | null) => ({
    fixture: { id, date: "", status: { short, elapsed }, venue: { name: null } },
    league: { name: "Test League" },
    teams: { home: { id: 1, name: "Home FC", logo: null }, away: { id: 2, name: "Away FC", logo: null } },
    goals: { home, away },
  });
  if (id === apiFix + 0) {
    return [{ ...base("NS", null, null, null), lineups: [
      { startXI: [{ player: { id: API_A, name: "A" } }], substitutes: [{ player: { id: API_B, name: "B" } }] },
    ] }];
  }
  if (id === apiFix + 1) {
    return [{ ...base("2H", 55, 1, 0), events: [
      { time: { elapsed: 23, extra: null }, player: { id: API_A, name: "A" }, assist: { id: null, name: null }, type: "Goal", detail: "Normal Goal" },
      { time: { elapsed: 50, extra: null }, player: { id: 999, name: "Someone Else" }, assist: { id: API_A, name: "A" }, type: "Goal", detail: "Normal Goal" },
      { time: { elapsed: 52, extra: null }, player: { id: API_A, name: "A" }, assist: { id: null, name: null }, type: "Goal", detail: "Missed Penalty" },
    ] }];
  }
  if (id === apiFix + 2) return [base("1H", 10, 0, 0)];
  return [];
}

beforeAll(async () => {
  for (const k of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "CRON_SECRET"]) savedEnv[k] = process.env[k];
  process.env["VAPID_PUBLIC_KEY"] = "test-public-key";
  process.env["VAPID_PRIVATE_KEY"] = "test-private-key";
  process.env["VAPID_SUBJECT"] = "https://usmnt-tracker.replit.app";

  const [club] = await db.insert(clubsTable)
    .values({ name: `__tick-club-${RUN}__`, league: "Test League", country: "Test" })
    .returning({ id: clubsTable.id });
  ids.club = club!.id;
  const player = (name: string, apiId: number) => ({
    name, slug: `${name}-${RUN}`, position: "MF", category: "prospect", clubId: ids.club,
    age: 22, nationalTeamCaps: 0, nationalTeamGoals: 0, worldCupRoster: false, apiFootballPlayerId: apiId,
  });
  const [a, b] = await db.insert(playersTable)
    .values([player("__tick-player-a__", API_A), player("__tick-player-b__", API_B)])
    .returning({ id: playersTable.id });
  ids.a = a!.id;
  ids.b = b!.id;

  const [u1, u2] = await db.insert(anonUsersTable)
    .values([{ tokenHash: hashToken(generateToken()) }, { tokenHash: hashToken(generateToken()) }])
    .returning({ id: anonUsersTable.id });
  ids.userMine = u1!.id;
  ids.userAll = u2!.id;
  await db.insert(userFollowsTable).values({ anonUserId: ids.userMine, playerId: ids.a });
  await db.insert(pushSubscriptionsTable).values([
    { anonUserId: ids.userMine, endpoint: EP.mine, ...KEYS, prefs: { ...ALL_ON, scope: "mine" } },
    { anonUserId: ids.userAll, endpoint: EP.all, ...KEYS, prefs: { ...ALL_ON, scope: "all" } },
  ]);

  const fixture = (i: number, offsetMin: number, status: string) => ({
    apiFootballFixtureId: apiFix + i, competition: "Test League", status,
    kickoff: new Date(NOW.getTime() + offsetMin * MIN), venue: "Test Park",
    homeTeam: "Home FC", awayTeam: "Away FC",
  });
  const rows = await db.insert(fixturesTable).values([
    fixture(0, 40, "scheduled"), // lineups out, kicks off in 40 min
    fixture(1, -30, "live"),     // goals happening
    fixture(2, -10, "scheduled"),// started 10 min ago, not yet marked live
    fixture(3, 180, "scheduled"),// too far off
    fixture(4, -180, "finished"),// finished, waiting for post-match stats
  ]).returning({ id: fixturesTable.id });
  [ids.pre, ids.live, ids.past, ids.far, ids.done] = rows.map((r) => r.id) as [number, number, number, number, number];
  await db.insert(fixturePlayersTable).values([
    { fixtureId: ids.pre, playerId: ids.a }, { fixtureId: ids.pre, playerId: ids.b },
    { fixtureId: ids.live, playerId: ids.a },
    { fixtureId: ids.past, playerId: ids.b },
    { fixtureId: ids.far, playerId: ids.a },
    { fixtureId: ids.done, playerId: ids.a }, { fixtureId: ids.done, playerId: ids.b },
  ]);
}, 30_000);

afterAll(async () => {
  const fixtureIds = [ids.pre, ids.live, ids.past, ids.far, ids.done].filter(Boolean);
  if (fixtureIds.length) {
    await db.delete(pushEventsTable).where(or(
      ...fixtureIds.map((f) => like(pushEventsTable.key, `%:${f}`)),
      ...fixtureIds.map((f) => like(pushEventsTable.key, `%:${f}:%`)),
    ));
    await db.delete(fixturePlayersTable).where(inArray(fixturePlayersTable.fixtureId, fixtureIds));
    await db.delete(fixturesTable).where(inArray(fixturesTable.id, fixtureIds));
  }
  const playerIds = [ids.a, ids.b].filter(Boolean);
  if (playerIds.length) await db.delete(userFollowsTable).where(inArray(userFollowsTable.playerId, playerIds));
  const userIds = [ids.userMine, ids.userAll].filter(Boolean);
  if (userIds.length) await db.delete(anonUsersTable).where(inArray(anonUsersTable.id, userIds));
  if (playerIds.length) await db.delete(playersTable).where(inArray(playersTable.id, playerIds));
  if (ids.club) await db.delete(clubsTable).where(eq(clubsTable.id, ids.club));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(() => {
  mocks.afFetch.mockReset();
  mocks.afFetch.mockImplementation(async (path: string) => apiResponse(path));
  mocks.postMatch.mockReset();
  mocks.postMatch.mockResolvedValue(undefined);
  vi.mocked(webpush.sendNotification).mockReset();
  vi.mocked(webpush.sendNotification).mockResolvedValue({ statusCode: 201, body: "", headers: {} });
});

function received(device: keyof typeof EP): { title: string; body: string; url?: string }[] {
  return vi.mocked(webpush.sendNotification).mock.calls
    .filter(([target]) => (target as { endpoint: string }).endpoint === EP[device])
    .map(([, payload]) => JSON.parse(payload as string));
}

describe("cron tick", () => {
  it("1: checks matches that are live, about to start, or past kickoff — not ones hours away or finished", async () => {
    const due = (await findDueFixtures(NOW)).map((f) => f.id);
    expect(due).toEqual(expect.arrayContaining([ids.pre, ids.live, ids.past]));
    expect(due).not.toContain(ids.far);
    expect(due).not.toContain(ids.done);
  });

  it("2: updates status and score, sends lineup and goal alerts, and doesn't run post-match stats yet", async () => {
    const summary = await runTick(NOW);
    expect(summary.fixturesChecked).toBe(3);

    const [past] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, ids.past));
    expect(past).toMatchObject({ status: "live", elapsedMinute: 10, homeScore: 0, awayScore: 0 });
    const [live] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, ids.live));
    expect(live).toMatchObject({ status: "live", elapsedMinute: 55, homeScore: 1, awayScore: 0 });

    const mine = received("mine");
    expect(mine.find((p) => p.title === "Lineups: Home FC vs Away FC")?.body).toBe("__tick-player-a__ starts");
    expect(received("all").find((p) => p.title === "Lineups: Home FC vs Away FC")?.body)
      .toBe("__tick-player-a__ starts · __tick-player-b__ on the bench");
    expect(mine.find((p) => p.title === "Goal: __tick-player-a__")?.body).toBe("Home FC 1–0 Away FC · 23′");
    expect(mine.find((p) => p.title === "Assist: __tick-player-a__")?.body).toBe("Sets up Someone Else · Home FC 1–0 Away FC · 50′");
    expect(mine.filter((p) => p.title.startsWith("Goal:"))).toHaveLength(1); // missed penalty ignored

    expect(mocks.postMatch).not.toHaveBeenCalled();
  });

  it("3: never repeats an alert, and stops checking a match before kickoff once its lineups are in", async () => {
    await runTick(NOW);
    expect(received("mine")).toHaveLength(0);
    expect((await findDueFixtures(NOW)).map((f) => f.id)).not.toContain(ids.pre);
  });

  it("4: runs post-match stats once, after the delay, with the match's players", async () => {
    const later = new Date(NOW.getTime() + POST_MATCH_DELAY_MS + MIN);
    await runTick(later);
    expect(mocks.postMatch).toHaveBeenCalledTimes(1);
    expect([...mocks.postMatch.mock.calls[0]![0]].sort()).toEqual([ids.a, ids.b].sort());

    await runTick(new Date(later.getTime() + 5 * MIN));
    expect(mocks.postMatch).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/cron/tick", () => {
  it("5: is unavailable when CRON_SECRET isn't set", async () => {
    delete process.env["CRON_SECRET"];
    await request(app).post("/api/cron/tick").set({ Authorization: "Bearer anything" }).expect(503);
  });

  it("6: refuses a missing or wrong secret", async () => {
    process.env["CRON_SECRET"] = `tick-secret-${RUN}`;
    await request(app).post("/api/cron/tick").expect(401);
    await request(app).post("/api/cron/tick").set({ Authorization: "Bearer wrong" }).expect(401);
  });

  it("7: runs (or reports a recent run) with the right secret", async () => {
    process.env["CRON_SECRET"] = `tick-secret-${RUN}`;
    const res = await request(app).post("/api/cron/tick").set({ Authorization: `Bearer tick-secret-${RUN}` }).expect(200);
    expect("skipped" in res.body || "fixturesChecked" in res.body).toBe(true);
  });
});
