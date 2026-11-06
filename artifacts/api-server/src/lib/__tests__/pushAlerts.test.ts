/**
 * Push alert scanners (kickoff, ratings, injuries, transfers), announcements,
 * and the admin announcement endpoint.
 *
 * Uses the dev database with throwaway rows (removed in afterAll) and a mocked
 * `web-push`. Every scanner is run with NOW in 2099 and the test fixtures,
 * injuries and transfers are dated around it, so real dev data is never in a
 * scan window. Only calls to this file's own devices are asserted on (other
 * test files may have devices in the database at the same time).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";

vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() },
}));

import webpush from "web-push";
import request from "supertest";
import app from "../../app.js";
import {
  db,
  adminSessionsTable,
  anonUsersTable,
  clubsTable,
  fixturePlayersTable,
  fixturesTable,
  injuriesTable,
  matchLogsTable,
  playersTable,
  pushEventsTable,
  pushSubscriptionsTable,
  transfersTable,
  userFollowsTable,
} from "@workspace/db";
import { eq, inArray, like, or } from "drizzle-orm";
import { generateToken, hashToken } from "../tokenUtils";
import {
  sendAnnouncement,
  sendInjuryAlerts,
  sendKickoffReminders,
  sendRatingAlerts,
  sendTransferAlerts,
} from "../pushAlerts";

const NOW = new Date("2099-06-01T12:00:00Z");
const MIN = 60_000;
const RUN = Date.now();
const KEYS = { p256dh: "B".repeat(87), auth: "A".repeat(22) };
const ALL_ON = {
  kickoff: true, lineups: true, goals: true, ratings: true,
  announcements: true, injuries: true, transfers: true,
};

// Devices: "mine" follows player A only; "all" gets every player but has
// ratings off; "quiet" has announcements off.
const EP = {
  mine: `https://web.push.apple.com/__alerts-mine-${RUN}`,
  all: `https://web.push.apple.com/__alerts-all-${RUN}`,
  quiet: `https://web.push.apple.com/__alerts-quiet-${RUN}`,
};

const ids = {
  club: 0, a: 0, b: 0, userMine: 0, userAll: 0, userQuiet: 0,
  kickoffFixture: 0, friendlyFixture: 0, finishedFixture: 0, transfer: 0,
};
const ADMIN_TOKEN = generateToken();
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "ADMIN_PASSWORD"]) savedEnv[k] = process.env[k];
  process.env["VAPID_PUBLIC_KEY"] = "test-public-key";
  process.env["VAPID_PRIVATE_KEY"] = "test-private-key";
  process.env["VAPID_SUBJECT"] = "https://usmnt-tracker.replit.app";
  process.env["ADMIN_PASSWORD"] = `alerts-test-${RUN}`;

  const [club] = await db.insert(clubsTable)
    .values({ name: `__alerts-club-${RUN}__`, league: "Test League", country: "Test" })
    .returning({ id: clubsTable.id });
  ids.club = club!.id;

  const player = (name: string) => ({
    name, slug: `${name}-${RUN}`, position: "MF", category: "prospect", clubId: ids.club,
    age: 22, nationalTeamCaps: 0, nationalTeamGoals: 0, worldCupRoster: false,
  });
  const [a, b] = await db.insert(playersTable)
    .values([player("__alerts-player-a__"), player("__alerts-player-b__")])
    .returning({ id: playersTable.id });
  ids.a = a!.id;
  ids.b = b!.id;

  const users = await db.insert(anonUsersTable)
    .values([{ tokenHash: hashToken(generateToken()) }, { tokenHash: hashToken(generateToken()) }, { tokenHash: hashToken(generateToken()) }])
    .returning({ id: anonUsersTable.id });
  [ids.userMine, ids.userAll, ids.userQuiet] = users.map((u) => u.id) as [number, number, number];
  await db.insert(userFollowsTable).values({ anonUserId: ids.userMine, playerId: ids.a });
  await db.insert(pushSubscriptionsTable).values([
    { anonUserId: ids.userMine, endpoint: EP.mine, ...KEYS, prefs: { ...ALL_ON, scope: "mine" } },
    { anonUserId: ids.userAll, endpoint: EP.all, ...KEYS, prefs: { ...ALL_ON, ratings: false, scope: "all" } },
    { anonUserId: ids.userQuiet, endpoint: EP.quiet, ...KEYS, prefs: { ...ALL_ON, announcements: false, scope: "all" } },
  ]);

  const apiBase = 1_900_000_000 + Math.floor(Math.random() * 90_000_000);
  const fixture = (offsetMin: number, extra: Partial<typeof fixturesTable.$inferInsert>, i: number) => ({
    apiFootballFixtureId: apiBase + i,
    competition: "Test League",
    kickoff: new Date(NOW.getTime() + offsetMin * MIN),
    venue: "Test Park",
    homeTeam: "Home FC",
    awayTeam: "Away FC",
    ...extra,
  });
  const [kick, friendly, finished] = await db.insert(fixturesTable).values([
    fixture(20, { status: "scheduled" }, 0),
    fixture(10, { status: "scheduled", competition: "Friendlies Clubs" }, 1),
    fixture(-180, { status: "finished", homeScore: 2, awayScore: 1 }, 2),
  ]).returning({ id: fixturesTable.id, apiId: fixturesTable.apiFootballFixtureId });
  ids.kickoffFixture = kick!.id;
  ids.friendlyFixture = friendly!.id;
  ids.finishedFixture = finished!.id;
  await db.insert(fixturePlayersTable).values([
    { fixtureId: kick!.id, playerId: ids.a }, { fixtureId: kick!.id, playerId: ids.b },
    { fixtureId: friendly!.id, playerId: ids.a },
    { fixtureId: finished!.id, playerId: ids.a }, { fixtureId: finished!.id, playerId: ids.b },
  ]);
  const log = (playerId: number, minutes: number, goals: number, rating: number) => ({
    playerId, apiFootballFixtureId: finished!.apiId, date: "2099-06-01", opponent: "Away FC",
    competition: "Test League", result: "W", minutes, goals, assists: 0, rating,
  });
  await db.insert(matchLogsTable).values([log(ids.a, 90, 1, 7.8), log(ids.b, 60, 0, 6.5)]);

  await db.insert(injuriesTable).values({
    playerId: ids.b, bodyPart: "Hamstring Injury", status: "active",
    latestUpdate: "Ruled out", startDate: "2099-06-01",
  });
  const [transfer] = await db.insert(transfersTable).values({
    playerId: ids.a, fromClub: "Old FC", toClub: "New FC", status: "confirmed",
    announcedAt: new Date(NOW.getTime() - 2 * 24 * 60 * MIN), summary: "test",
    createdAt: new Date(NOW.getTime() - 60 * MIN),
  }).returning({ id: transfersTable.id });
  ids.transfer = transfer!.id;

  await db.insert(adminSessionsTable).values({
    tokenHash: hashToken(ADMIN_TOKEN), expiresAt: new Date(Date.now() + 60 * MIN),
  });
}, 30_000);

afterAll(async () => {
  const fixtureIds = [ids.kickoffFixture, ids.friendlyFixture, ids.finishedFixture].filter(Boolean);
  await db.delete(pushEventsTable).where(or(
    ...fixtureIds.map((f) => like(pushEventsTable.key, `%:${f}`)),
    ...fixtureIds.map((f) => like(pushEventsTable.key, `%:${f}:%`)),
    like(pushEventsTable.key, `injury:${ids.b}:%`),
    eq(pushEventsTable.key, `transfer:${ids.transfer}`),
  ));
  const playerIds = [ids.a, ids.b].filter(Boolean);
  if (playerIds.length) {
    await db.delete(matchLogsTable).where(inArray(matchLogsTable.playerId, playerIds));
    await db.delete(injuriesTable).where(inArray(injuriesTable.playerId, playerIds));
    await db.delete(transfersTable).where(inArray(transfersTable.playerId, playerIds));
    await db.delete(fixturePlayersTable).where(inArray(fixturePlayersTable.playerId, playerIds));
    await db.delete(userFollowsTable).where(inArray(userFollowsTable.playerId, playerIds));
  }
  if (fixtureIds.length) await db.delete(fixturesTable).where(inArray(fixturesTable.id, fixtureIds));
  const userIds = [ids.userMine, ids.userAll, ids.userQuiet].filter(Boolean);
  if (userIds.length) await db.delete(anonUsersTable).where(inArray(anonUsersTable.id, userIds)); // subscriptions cascade
  if (playerIds.length) await db.delete(playersTable).where(inArray(playersTable.id, playerIds));
  if (ids.club) await db.delete(clubsTable).where(eq(clubsTable.id, ids.club));
  await db.delete(adminSessionsTable).where(eq(adminSessionsTable.tokenHash, hashToken(ADMIN_TOKEN)));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(() => {
  vi.mocked(webpush.sendNotification).mockReset();
  vi.mocked(webpush.sendNotification).mockResolvedValue({ statusCode: 201, body: "", headers: {} });
});

/** Payloads this file's devices received, by device. */
function received(): Record<keyof typeof EP, { title: string; body: string; url: string }[]> {
  const out = { mine: [], all: [], quiet: [] } as Record<keyof typeof EP, { title: string; body: string; url: string }[]>;
  for (const [target, payload] of vi.mocked(webpush.sendNotification).mock.calls) {
    const device = (Object.keys(EP) as (keyof typeof EP)[]).find((k) => EP[k] === (target as { endpoint: string }).endpoint);
    if (device) out[device].push(JSON.parse(payload as string));
  }
  return out;
}

describe("kickoff reminders", () => {
  it("1: a My Players device hears only about followed players; an All device hears about everyone", async () => {
    await sendKickoffReminders(NOW);
    const got = received();
    const mine = got.mine.filter((p) => p.url === `/matches/${ids.kickoffFixture}`);
    const all = got.all.filter((p) => p.url === `/matches/${ids.kickoffFixture}`);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.title).toBe("Kicks off in 20 min: Home FC vs Away FC");
    expect(mine[0]!.body).toBe("__alerts-player-a__");
    expect(all).toHaveLength(1);
    expect(all[0]!.body).toContain("__alerts-player-b__");
  });

  it("2: is sent once — a second scan sends nothing for the same match", async () => {
    await sendKickoffReminders(NOW);
    expect(received().mine.filter((p) => p.url === `/matches/${ids.kickoffFixture}`)).toHaveLength(0);
  });

  it("3: skips club friendlies", async () => {
    expect([...received().mine, ...received().all].some((p) => p.url === `/matches/${ids.friendlyFixture}`)).toBe(false);
    const rows = await db.select().from(pushEventsTable).where(eq(pushEventsTable.key, `kickoff:${ids.friendlyFixture}`));
    expect(rows).toHaveLength(0);
  });
});

describe("post-match ratings", () => {
  it("4: sends the followed player's rating, and nothing to a device with ratings off", async () => {
    await sendRatingAlerts(NOW);
    const got = received();
    const mine = got.mine.filter((p) => p.url === `/matches/${ids.finishedFixture}`);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.title).toBe("Ratings: Home FC 2–1 Away FC");
    expect(mine[0]!.body).toBe("__alerts-player-a__ 7.8 (90′, 1G)");
    expect(got.all.filter((p) => p.url === `/matches/${ids.finishedFixture}`)).toHaveLength(0);
  });
});

describe("injuries and transfers", () => {
  it("5: a new injury reaches All devices but not a My Players device that doesn't follow the player", async () => {
    await sendInjuryAlerts(NOW);
    const got = received();
    expect(got.all.filter((p) => p.title === "Injury: __alerts-player-b__")).toHaveLength(1);
    expect(got.mine.filter((p) => p.title === "Injury: __alerts-player-b__")).toHaveLength(0);
  });

  it("6: a newly recorded transfer reaches a device that follows the player", async () => {
    await sendTransferAlerts(NOW);
    const mine = received().mine.filter((p) => p.title === "Transfer: __alerts-player-a__");
    expect(mine).toHaveLength(1);
    expect(mine[0]!.body).toBe("Joins New FC from Old FC");
  });
});

describe("announcements", () => {
  it("7: go to every device with announcements on, whatever its player scope", async () => {
    await sendAnnouncement({ title: "Roster", body: "November camp roster is out", url: "/schedule" });
    const got = received();
    expect(got.mine.map((p) => p.body)).toContain("November camp roster is out");
    expect(got.all.map((p) => p.body)).toContain("November camp roster is out");
    expect(got.quiet).toHaveLength(0);
  });

  it("8: POST /admin/announcements needs an admin session", async () => {
    await request(app).post("/api/admin/announcements").send({ title: "x", body: "y" }).expect(401);
  });

  it("9: POST /admin/announcements rejects an empty message and a non-app link", async () => {
    const auth = { Authorization: `Bearer ${ADMIN_TOKEN}` };
    await request(app).post("/api/admin/announcements").set(auth).send({ title: "Roster", body: "  " }).expect(400);
    await request(app).post("/api/admin/announcements").set(auth)
      .send({ title: "Roster", body: "Out now", url: "https://example.com" }).expect(400);
  });

  it("10: POST /admin/announcements sends and reports how many devices got it", async () => {
    const res = await request(app).post("/api/admin/announcements")
      .set({ Authorization: `Bearer ${ADMIN_TOKEN}` })
      .send({ title: "Roster", body: "Admin test announcement", url: "/schedule" })
      .expect(200);
    expect(res.body.sent).toBeGreaterThanOrEqual(2);
    const got = received();
    expect(got.mine.find((p) => p.body === "Admin test announcement")?.url).toBe("/schedule");
    expect(got.quiet).toHaveLength(0);
  });
});
