/**
 * Broadcast info edited on the admin page: per-match overrides the syncs keep,
 * and per-competition defaults applied to upcoming club matches.
 *
 * Dev database with a throwaway club, player, competition and fixtures
 * (removed in afterAll). The competition name is unique to this run, so no
 * real fixture or league row is touched.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import {
  db,
  adminSessionsTable,
  clubsTable,
  fixturePlayersTable,
  fixturesTable,
  leagueBroadcastsTable,
  playersTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { generateToken, hashToken } from "../tokenUtils";
import { broadcastFor, syncBroadcastColumns } from "../broadcasts";

const RUN = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const LEAGUE = `__bc-league-${RUN}`;
const ADMIN_TOKEN = generateToken();
const AUTH = { Authorization: `Bearer ${ADMIN_TOKEN}` };
const ids = { club: 0, player: 0, nt: 0, club1: 0, manual: 0, far: 0 };
const savedEnv: Record<string, string | undefined> = {};

async function fixture(id: number) {
  const [row] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, id));
  return row!;
}

beforeAll(async () => {
  savedEnv["ADMIN_PASSWORD"] = process.env["ADMIN_PASSWORD"];
  process.env["ADMIN_PASSWORD"] = `bc-test-${RUN}`;
  const [club] = await db.insert(clubsTable)
    .values({ name: `__bc-club-${RUN}__`, league: "Test League", country: "Test" })
    .returning({ id: clubsTable.id });
  ids.club = club!.id;
  const [player] = await db.insert(playersTable).values({
    name: "__bc-player__", slug: `__bc-player-${RUN}`, position: "MF", category: "prospect", clubId: ids.club,
    age: 22, nationalTeamCaps: 0, nationalTeamGoals: 0, worldCupRoster: false,
  }).returning({ id: playersTable.id });
  ids.player = player!.id;

  const at = (days: number) => new Date(Date.now() + days * DAY);
  const base = { competition: LEAGUE, venue: "Test Park", homeTeam: `__bc-home-${RUN}`, awayTeam: "__bc-away__" };
  const [nt, club1, manual, far] = await db.insert(fixturesTable).values([
    { ...base, kickoff: at(3), isNationalTeam: true, ntLevel: "U21", homeTeam: "Scotland U21", awayTeam: `USA U21 ${RUN}` },
    { ...base, kickoff: at(4) },
    { ...base, kickoff: at(5), tvNetwork: "Manual TV", broadcastSetByAdmin: true },
    { ...base, kickoff: at(40), isNationalTeam: true, ntLevel: "U21" },
  ]).returning({ id: fixturesTable.id });
  [ids.nt, ids.club1, ids.manual, ids.far] = [nt!.id, club1!.id, manual!.id, far!.id];
  await db.insert(fixturePlayersTable).values([
    { fixtureId: ids.club1, playerId: ids.player, clubId: ids.club },
    { fixtureId: ids.manual, playerId: ids.player, clubId: ids.club },
  ]);
  await db.insert(adminSessionsTable).values({ tokenHash: hashToken(ADMIN_TOKEN), expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
}, 30_000);

afterAll(async () => {
  const fixtureIds = [ids.nt, ids.club1, ids.manual, ids.far].filter(Boolean);
  if (fixtureIds.length) {
    await db.delete(fixturePlayersTable).where(inArray(fixturePlayersTable.fixtureId, fixtureIds));
    await db.delete(fixturesTable).where(inArray(fixturesTable.id, fixtureIds));
  }
  if (ids.player) await db.delete(playersTable).where(eq(playersTable.id, ids.player));
  if (ids.club) await db.delete(clubsTable).where(eq(clubsTable.id, ids.club));
  await db.delete(leagueBroadcastsTable).where(eq(leagueBroadcastsTable.league, LEAGUE));
  await db.delete(adminSessionsTable).where(eq(adminSessionsTable.tokenHash, hashToken(ADMIN_TOKEN)));
  if (savedEnv["ADMIN_PASSWORD"] === undefined) delete process.env["ADMIN_PASSWORD"];
  else process.env["ADMIN_PASSWORD"] = savedEnv["ADMIN_PASSWORD"];
});

describe("broadcast info", () => {
  it("1: the syncs leave a match set by hand alone, and otherwise use the competition's broadcast", () => {
    expect(syncBroadcastColumns(LEAGUE, { broadcastSetByAdmin: true })).toEqual({});
    expect(syncBroadcastColumns(LEAGUE, { broadcastSetByAdmin: false })).toEqual({ tvNetwork: null, streamingService: null });
  });

  it("2: lists the next three weeks' tracked matches and flags competitions with no default", async () => {
    const res = await request(app).get("/api/admin/broadcasts").set(AUTH).expect(200);
    const listed = res.body.fixtures.map((f: { id: number }) => f.id);
    expect(listed).toEqual(expect.arrayContaining([ids.nt, ids.club1, ids.manual]));
    expect(listed).not.toContain(ids.far);
    expect(res.body.unmappedCompetitions).toContain(LEAGUE);
  });

  it("3: a competition default applies to its upcoming club matches, never to hand-set or national-team ones", async () => {
    const res = await request(app).put("/api/admin/broadcasts/leagues").set(AUTH)
      .send({ league: LEAGUE, tvNetwork: "Test TV", streamingService: "Test+" }).expect(200);
    expect(res.body.fixturesUpdated).toBe(1);
    expect(await fixture(ids.club1)).toMatchObject({ tvNetwork: "Test TV", streamingService: "Test+" });
    expect(await fixture(ids.manual)).toMatchObject({ tvNetwork: "Manual TV", streamingService: null });
    expect(await fixture(ids.nt)).toMatchObject({ tvNetwork: null, streamingService: null });
    // The syncs see the new default straight away.
    expect(broadcastFor(LEAGUE)).toEqual({ tvNetwork: "Test TV", streamingService: "Test+" });
    const list = await request(app).get("/api/admin/broadcasts").set(AUTH).expect(200);
    expect(list.body.unmappedCompetitions).not.toContain(LEAGUE);
  });

  it("4: a match set by hand keeps its values; 'Use league default' hands it back", async () => {
    await request(app).put(`/api/admin/broadcasts/fixtures/${ids.nt}`).set(AUTH)
      .send({ tvNetwork: "", streamingService: "YouTube", broadcastLink: "https://www.youtube.com/@ussoccer" }).expect(200);
    expect(await fixture(ids.nt)).toMatchObject({
      tvNetwork: null, streamingService: "YouTube", broadcastLink: "https://www.youtube.com/@ussoccer", broadcastSetByAdmin: true,
    });
    await request(app).delete(`/api/admin/broadcasts/fixtures/${ids.nt}`).set(AUTH).expect(200);
    expect(await fixture(ids.nt)).toMatchObject({
      tvNetwork: "Test TV", streamingService: "Test+", broadcastLink: null, broadcastSetByAdmin: false,
    });
  });

  it("5: needs an admin session, rejects a non-https link, and 404s an unknown match", async () => {
    await request(app).get("/api/admin/broadcasts").expect(401);
    await request(app).put(`/api/admin/broadcasts/fixtures/${ids.nt}`).set(AUTH)
      .send({ tvNetwork: null, streamingService: null, broadcastLink: "http://example.com" }).expect(400);
    await request(app).put("/api/admin/broadcasts/fixtures/999999999").set(AUTH)
      .send({ tvNetwork: "X", streamingService: null, broadcastLink: null }).expect(404);
  });

  it("6: removing a competition's default stops new matches getting it", async () => {
    await request(app).delete(`/api/admin/broadcasts/leagues?league=${encodeURIComponent(LEAGUE)}`).set(AUTH).expect(200);
    expect(broadcastFor(LEAGUE)).toEqual({ tvNetwork: null, streamingService: null });
    await request(app).delete(`/api/admin/broadcasts/leagues?league=${encodeURIComponent(LEAGUE)}`).set(AUTH).expect(404);
  });
});
