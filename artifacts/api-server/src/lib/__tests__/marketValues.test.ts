/**
 * Hand-entered market values: euros as entered, dollars at the ECB rate, the
 * daily rate refresh, and the admin endpoints.
 *
 * Dev database with a throwaway club and players (removed in afterAll).
 * Global fetch is stubbed, so no real rate request is made. The stored rate
 * (server_config fx.eurUsd) is saved first and restored afterwards.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { db, adminSessionsTable, clubsTable, playersTable, serverConfigTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { generateToken, hashToken } from "../tokenUtils";
import { EUR_USD_KEY, EUR_USD_URL, parseEurUsd, refreshEurUsd, saveMarketValues, storedEurUsd } from "../marketValues";

const RUN = Date.now();
const MIN = 60_000;
const ADMIN_TOKEN = generateToken();
const AUTH = { Authorization: `Bearer ${ADMIN_TOKEN}` };
const TM = "https://www.transfermarkt.com/test-player/profil/spieler/123456";
const ids = { club: 0, a: 0, b: 0, legacy: 0 };
const savedEnv: Record<string, string | undefined> = {};
let savedRate: string | undefined;

async function player(id: number) {
  const [row] = await db.select().from(playersTable).where(eq(playersTable.id, id));
  return row!;
}

function stubRateResponse(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeAll(async () => {
  savedEnv["ADMIN_PASSWORD"] = process.env["ADMIN_PASSWORD"];
  process.env["ADMIN_PASSWORD"] = `mv-test-${RUN}`;
  const [rate] = await db.select().from(serverConfigTable).where(eq(serverConfigTable.key, EUR_USD_KEY));
  savedRate = rate?.value;

  const [club] = await db.insert(clubsTable)
    .values({ name: `__mv-club-${RUN}__`, league: "Test League", country: "Test" })
    .returning({ id: clubsTable.id });
  ids.club = club!.id;
  const base = (name: string) => ({
    name, slug: `${name}-${RUN}`, position: "MF", category: "prospect", clubId: ids.club,
    age: 22, nationalTeamCaps: 0, nationalTeamGoals: 0, worldCupRoster: false, bio: "Old bio",
  });
  const [a, b, legacy] = await db.insert(playersTable).values([
    base("__mv-player-a__"),
    base("__mv-player-b__"),
    // An undated seed value: the refresh must leave it alone.
    { ...base("__mv-player-legacy__"), marketValueUsd: 9_000_000 },
  ]).returning({ id: playersTable.id });
  [ids.a, ids.b, ids.legacy] = [a!.id, b!.id, legacy!.id];

  await db.insert(adminSessionsTable).values({ tokenHash: hashToken(ADMIN_TOKEN), expiresAt: new Date(Date.now() + 60 * MIN) });
}, 30_000);

afterAll(async () => {
  const playerIds = [ids.a, ids.b, ids.legacy].filter(Boolean);
  if (playerIds.length) await db.delete(playersTable).where(inArray(playersTable.id, playerIds));
  if (ids.club) await db.delete(clubsTable).where(eq(clubsTable.id, ids.club));
  await db.delete(adminSessionsTable).where(eq(adminSessionsTable.tokenHash, hashToken(ADMIN_TOKEN)));
  if (savedRate === undefined) {
    await db.delete(serverConfigTable).where(eq(serverConfigTable.key, EUR_USD_KEY));
  } else {
    await db.update(serverConfigTable).set({ value: savedRate }).where(eq(serverConfigTable.key, EUR_USD_KEY));
  }
  if (savedEnv["ADMIN_PASSWORD"] === undefined) delete process.env["ADMIN_PASSWORD"];
  else process.env["ADMIN_PASSWORD"] = savedEnv["ADMIN_PASSWORD"];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("market values", () => {
  it("1: reads the rate from Frankfurter v1 or v2 responses and rejects anything implausible", () => {
    expect(parseEurUsd({ amount: 1, base: "EUR", date: "2026-11-06", rates: { USD: 1.0812 } })).toEqual({ rate: 1.0812, date: "2026-11-06" });
    expect(parseEurUsd({ date: "2026-11-06", rate: 1.08 })).toEqual({ rate: 1.08, date: "2026-11-06" });
    expect(parseEurUsd({ rates: { USD: 0 } })).toBeNull();
    expect(parseEurUsd({ rates: { USD: "1.08" } })).toBeNull();
    expect(parseEurUsd({ rate: 25 })).toBeNull();
    expect(parseEurUsd(null)).toBeNull();
  });

  it("2: saves euros as entered, dates them, and converts at the rate; fields not sent are unchanged", async () => {
    await saveMarketValues([{ id: ids.a, valueEurM: 25, transfermarktUrl: TM }], "2099-01-15", 1.1);
    let a = await player(ids.a);
    expect(a.marketValueEur).toBe(25_000_000);
    expect(a.marketValueAsOf).toBe("2099-01-15");
    expect(a.marketValueUsd).toBe(27_500_000);
    expect(a.transfermarktUrl).toBe(TM);
    expect(a.bio).toBe("Old bio");

    await saveMarketValues([{ id: ids.a, bio: "New bio" }], "2099-02-01", 1.1);
    a = await player(ids.a);
    expect(a.bio).toBe("New bio");
    expect(a.marketValueAsOf).toBe("2099-01-15");
    expect(a.marketValueEur).toBe(25_000_000);

    await saveMarketValues([{ id: ids.a, valueEurM: null }], "2099-02-01", 1.1);
    a = await player(ids.a);
    expect([a.marketValueEur, a.marketValueAsOf, a.marketValueUsd]).toEqual([null, null, null]);
    expect(a.transfermarktUrl).toBe(TM);
  });

  it("3: with no rate yet, keeps the euros and leaves dollars empty", async () => {
    await saveMarketValues([{ id: ids.b, valueEurM: 0.8 }], "2099-01-15", null);
    const b = await player(ids.b);
    expect(b.marketValueEur).toBe(800_000);
    expect(b.marketValueUsd).toBeNull();
  });

  it("4: the daily refresh stores the rate and re-converts every entered value, not undated seed values", async () => {
    const fetchMock = stubRateResponse({ amount: 1, base: "EUR", date: "2099-01-16", rates: { USD: 1.2 } });
    const result = await refreshEurUsd();
    expect(fetchMock).toHaveBeenCalledWith(EUR_USD_URL, expect.anything());
    expect(result.rate).toBe(1.2);
    expect(await storedEurUsd()).toEqual({ rate: 1.2, date: "2099-01-16" });
    expect((await player(ids.b)).marketValueUsd).toBe(960_000);
    expect((await player(ids.legacy)).marketValueUsd).toBe(9_000_000);
  });

  it("5: a failed or unusable rate response throws and changes nothing", async () => {
    stubRateResponse({ error: "down" }, 503);
    await expect(refreshEurUsd()).rejects.toThrow(/HTTP 503/);
    stubRateResponse({ rates: { USD: "x" } });
    await expect(refreshEurUsd()).rejects.toThrow(/no usable/);
    expect((await storedEurUsd())?.rate).toBe(1.2);
    expect((await player(ids.b)).marketValueUsd).toBe(960_000);
  });
});

describe("admin endpoints", () => {
  it("6: need an admin session", async () => {
    await request(app).get("/api/admin/market-values").expect(401);
    await request(app).put("/api/admin/market-values").send({ asOf: "2026-10-01", players: [{ id: ids.a, valueEurM: 1 }] }).expect(401);
  });

  it("7: reject a non-Transfermarkt link, a future date, and a value that isn't € millions", async () => {
    const put = (body: object) => request(app).put("/api/admin/market-values").set(AUTH).send(body);
    await put({ asOf: "2026-10-01", players: [{ id: ids.a, transfermarktUrl: "https://example.com/player" }] }).expect(400);
    await put({ asOf: "2099-01-01", players: [{ id: ids.a, valueEurM: 5 }] }).expect(400);
    await put({ asOf: "2026-10-01", players: [{ id: ids.a, valueEurM: 25_000_000 }] }).expect(400);
    expect((await player(ids.a)).marketValueEur).toBeNull();
  });

  it("8: saves only what was sent, dates new values, and lists them with the rate", async () => {
    const res = await request(app).put("/api/admin/market-values").set(AUTH).send({
      asOf: "2026-10-01",
      players: [{ id: ids.a, valueEurM: 10 }, { id: ids.b, bio: "Bio from the admin page" }],
    }).expect(200);
    expect(res.body).toMatchObject({ updated: 2, eurUsd: { rate: 1.2 } });

    const a = await player(ids.a);
    expect([a.marketValueEur, a.marketValueAsOf, a.marketValueUsd]).toEqual([10_000_000, "2026-10-01", 12_000_000]);
    const b = await player(ids.b);
    expect(b.bio).toBe("Bio from the admin page");
    expect(b.marketValueEur).toBe(800_000);

    const list = await request(app).get("/api/admin/market-values").set(AUTH).expect(200);
    expect(list.body.eurUsd).toEqual({ rate: 1.2, date: "2099-01-16" });
    expect(list.body.players.find((p: { id: number }) => p.id === ids.a)).toMatchObject({
      marketValueEur: 10_000_000, marketValueAsOf: "2026-10-01", transfermarktUrl: TM,
    });
  });
});
