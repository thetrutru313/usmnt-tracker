/**
 * USMNT call-ups entered on the admin page. Dev database with throwaway
 * players and senior fixtures dated 2099 (removed in afterAll), so they never
 * appear in a real window.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { db, adminSessionsTable, clubsTable, fixturePlayersTable, fixturesTable, playersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { generateToken, hashToken } from "../tokenUtils";

const RUN = Date.now();
const ADMIN_TOKEN = generateToken();
const AUTH = { Authorization: `Bearer ${ADMIN_TOKEN}` };
const ids = { club: 0, p1: 0, p2: 0, p3: 0, home: 0, away: 0, finished: 0, clubFixture: 0 };
const savedEnv: Record<string, string | undefined> = {};

async function links(fixtureId: number) {
  const rows = await db.select().from(fixturePlayersTable).where(eq(fixturePlayersTable.fixtureId, fixtureId));
  return rows.map((r) => ({ playerId: r.playerId, clubId: r.clubId })).sort((a, b) => a.playerId - b.playerId);
}

beforeAll(async () => {
  savedEnv["ADMIN_PASSWORD"] = process.env["ADMIN_PASSWORD"];
  process.env["ADMIN_PASSWORD"] = `cu-test-${RUN}`;
  const [club] = await db.insert(clubsTable)
    .values({ name: `__cu-club-${RUN}__`, league: "Test League", country: "Test" })
    .returning({ id: clubsTable.id });
  ids.club = club!.id;
  const player = (n: number) => ({
    name: `__cu-player-${n}__`, slug: `__cu-player-${n}-${RUN}`, position: "MF", category: "prospect",
    clubId: ids.club, age: 22, nationalTeamCaps: 0, nationalTeamGoals: 0, worldCupRoster: false,
  });
  const [p1, p2, p3] = await db.insert(playersTable).values([player(1), player(2), player(3)]).returning({ id: playersTable.id });
  [ids.p1, ids.p2, ids.p3] = [p1!.id, p2!.id, p3!.id];
  const senior = { isNationalTeam: true, ntLevel: "SENIOR", competition: `__cu-${RUN}`, venue: "Test Park", homeTeam: "USA" };
  const [home, away, finished, clubFixture] = await db.insert(fixturesTable).values([
    { ...senior, awayTeam: `__cu-opp-a-${RUN}`, kickoff: new Date("2099-03-20T23:00:00Z") },
    { ...senior, awayTeam: `__cu-opp-b-${RUN}`, kickoff: new Date("2099-03-24T23:00:00Z") },
    { ...senior, awayTeam: `__cu-opp-c-${RUN}`, kickoff: new Date("2020-03-24T23:00:00Z"), status: "finished" },
    { competition: `__cu-${RUN}`, venue: "Test Park", homeTeam: `__cu-club-${RUN}__`, awayTeam: "Other FC", kickoff: new Date("2099-03-28T15:00:00Z") },
  ]).returning({ id: fixturesTable.id });
  [ids.home, ids.away, ids.finished, ids.clubFixture] = [home!.id, away!.id, finished!.id, clubFixture!.id];
  await db.insert(adminSessionsTable).values({ tokenHash: hashToken(ADMIN_TOKEN), expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
}, 30_000);

afterAll(async () => {
  const fixtureIds = [ids.home, ids.away, ids.finished, ids.clubFixture].filter(Boolean);
  if (fixtureIds.length) {
    await db.delete(fixturePlayersTable).where(inArray(fixturePlayersTable.fixtureId, fixtureIds));
    await db.delete(fixturesTable).where(inArray(fixturesTable.id, fixtureIds));
  }
  const playerIds = [ids.p1, ids.p2, ids.p3].filter(Boolean);
  if (playerIds.length) await db.delete(playersTable).where(inArray(playersTable.id, playerIds));
  if (ids.club) await db.delete(clubsTable).where(eq(clubsTable.id, ids.club));
  await db.delete(adminSessionsTable).where(eq(adminSessionsTable.tokenHash, hashToken(ADMIN_TOKEN)));
  if (savedEnv["ADMIN_PASSWORD"] === undefined) delete process.env["ADMIN_PASSWORD"];
  else process.env["ADMIN_PASSWORD"] = savedEnv["ADMIN_PASSWORD"];
});

describe("USMNT call-ups", () => {
  it("1: lists upcoming senior matches (not finished ones or club matches) and the players to pick from", async () => {
    const res = await request(app).get("/api/admin/callups").set(AUTH).expect(200);
    const listed = res.body.fixtures.map((f: { id: number }) => f.id);
    expect(listed).toEqual(expect.arrayContaining([ids.home, ids.away]));
    expect(listed).not.toContain(ids.finished);
    expect(listed).not.toContain(ids.clubFixture);
    expect(res.body.players.map((p: { id: number }) => p.id)).toEqual(expect.arrayContaining([ids.p1, ids.p2, ids.p3]));
  });

  it("2: sets one roster for both matches of a window", async () => {
    const res = await request(app).put("/api/admin/callups").set(AUTH)
      .send({ fixtureIds: [ids.home, ids.away], playerIds: [ids.p1, ids.p2] }).expect(200);
    expect(res.body).toMatchObject({ added: 4, removed: 0 });
    const expected = [{ playerId: ids.p1, clubId: null }, { playerId: ids.p2, clubId: null }];
    expect(await links(ids.home)).toEqual(expected);
    expect(await links(ids.away)).toEqual(expected);
    const list = await request(app).get("/api/admin/callups").set(AUTH).expect(200);
    expect(list.body.fixtures.find((f: { id: number }) => f.id === ids.home).playerIds.sort()).toEqual([ids.p1, ids.p2].sort());
  });

  it("3: saving again replaces the roster (a dropped player is removed, a new one added)", async () => {
    const res = await request(app).put("/api/admin/callups").set(AUTH)
      .send({ fixtureIds: [ids.home], playerIds: [ids.p2, ids.p3] }).expect(200);
    expect(res.body).toMatchObject({ added: 1, removed: 1 });
    expect(await links(ids.home)).toEqual([{ playerId: ids.p2, clubId: null }, { playerId: ids.p3, clubId: null }]);
    // The other match keeps its roster.
    expect((await links(ids.away)).map((l) => l.playerId)).toEqual([ids.p1, ids.p2].sort((a, b) => a - b));
  });

  it("4: only upcoming senior matches can be set, and only by an admin", async () => {
    await request(app).put("/api/admin/callups").set(AUTH)
      .send({ fixtureIds: [ids.finished], playerIds: [ids.p1] }).expect(400);
    await request(app).put("/api/admin/callups").set(AUTH)
      .send({ fixtureIds: [ids.clubFixture], playerIds: [ids.p1] }).expect(400);
    await request(app).put("/api/admin/callups").send({ fixtureIds: [ids.home], playerIds: [] }).expect(401);
    expect(await links(ids.clubFixture)).toEqual([]);
  });

  it("5: an empty roster clears the match's call-ups", async () => {
    await request(app).put("/api/admin/callups").set(AUTH).send({ fixtureIds: [ids.home], playerIds: [] }).expect(200);
    expect(await links(ids.home)).toEqual([]);
  });
});
