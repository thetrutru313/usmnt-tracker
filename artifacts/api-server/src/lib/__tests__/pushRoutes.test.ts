/**
 * Web Push subscriptions: the /api/push endpoints and sendPush's handling of
 * a subscription the push service says is gone.
 *
 * Uses the dev database (one throwaway anon user, removed in afterAll) and a
 * mocked `web-push`, so nothing is actually sent.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";

vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() },
}));

import webpush from "web-push";
import request from "supertest";
import app from "../../app.js";
import { db, anonUsersTable, pushSubscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateToken, hashToken } from "../tokenUtils";

const ENDPOINT = `https://web.push.apple.com/__push-test-${Date.now()}`;
const KEYS = { p256dh: "B".repeat(87), auth: "A".repeat(22) };
const PREFS = {
  kickoff: true, lineups: false, goals: true, ratings: true,
  announcements: true, injuries: false, transfers: false, scope: "mine",
};

const savedEnv: Record<string, string | undefined> = {};
let token = "";
let userId: number | null = null;

beforeAll(async () => {
  for (const k of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) savedEnv[k] = process.env[k];
  process.env["VAPID_PUBLIC_KEY"] = "test-public-key";
  process.env["VAPID_PRIVATE_KEY"] = "test-private-key";
  process.env["VAPID_SUBJECT"] = "https://usmnt-tracker.replit.app";

  token = generateToken();
  const [user] = await db
    .insert(anonUsersTable)
    .values({ tokenHash: hashToken(token) })
    .returning({ id: anonUsersTable.id });
  userId = user!.id;
}, 30_000);

afterAll(async () => {
  if (userId !== null) {
    await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.anonUserId, userId));
    await db.delete(anonUsersTable).where(eq(anonUsersTable.id, userId));
  }
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(() => {
  vi.mocked(webpush.sendNotification).mockReset();
});

const auth = () => ({ Authorization: `Bearer ${token}` });

async function rowsForEndpoint() {
  return db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, ENDPOINT));
}

describe("/api/push", () => {
  it("1: GET /push/config returns the public key", async () => {
    const res = await request(app).get("/api/push/config").expect(200);
    expect(res.body).toEqual({ publicKey: "test-public-key" });
  });

  it("2: saving a subscription requires an anonymous user token", async () => {
    await request(app)
      .put("/api/push/subscription")
      .send({ subscription: { endpoint: ENDPOINT, keys: KEYS }, prefs: PREFS })
      .expect(401);
  });

  it("3: refuses an endpoint that isn't a known push service", async () => {
    await request(app)
      .put("/api/push/subscription")
      .set(auth())
      .send({ subscription: { endpoint: "https://example.com/hook", keys: KEYS }, prefs: PREFS })
      .expect(400);
    expect(await db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, "https://example.com/hook"))).toHaveLength(0);
  });

  it("4: saves the subscription, returns its choices, and updates the same row", async () => {
    await request(app)
      .put("/api/push/subscription")
      .set(auth())
      .send({ subscription: { endpoint: ENDPOINT, keys: KEYS }, prefs: PREFS })
      .expect(200);

    const got = await request(app)
      .get("/api/push/subscription")
      .query({ endpoint: ENDPOINT })
      .set(auth())
      .expect(200);
    expect(got.body.prefs).toEqual(PREFS);

    await request(app)
      .put("/api/push/subscription")
      .set(auth())
      .send({ subscription: { endpoint: ENDPOINT, keys: KEYS }, prefs: { ...PREFS, lineups: true, scope: "all" } })
      .expect(200);
    const rows = await rowsForEndpoint();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.prefs).toMatchObject({ lineups: true, scope: "all" });
  });

  it("5: POST /push/test sends a test alert to that device", async () => {
    vi.mocked(webpush.sendNotification).mockResolvedValue({ statusCode: 201, body: "", headers: {} });
    const res = await request(app).post("/api/push/test").set(auth()).send({ endpoint: ENDPOINT }).expect(200);
    expect(res.body).toEqual({ result: "sent" });
    const [target, payload] = vi.mocked(webpush.sendNotification).mock.calls[0]!;
    expect(target).toEqual({ endpoint: ENDPOINT, keys: KEYS });
    expect(JSON.parse(payload as string)).toMatchObject({ title: "Test alert", url: "/alerts" });
  });

  it("6: a subscription the push service reports gone (410) is removed", async () => {
    vi.mocked(webpush.sendNotification).mockRejectedValue(Object.assign(new Error("Gone"), { statusCode: 410 }));
    await request(app).post("/api/push/test").set(auth()).send({ endpoint: ENDPOINT }).expect(410);
    expect(await rowsForEndpoint()).toHaveLength(0);
  });

  it("7: DELETE /push/subscription switches alerts off for the device", async () => {
    await request(app)
      .put("/api/push/subscription")
      .set(auth())
      .send({ subscription: { endpoint: ENDPOINT, keys: KEYS }, prefs: PREFS })
      .expect(200);
    await request(app).delete("/api/push/subscription").set(auth()).send({ endpoint: ENDPOINT }).expect(204);
    expect(await rowsForEndpoint()).toHaveLength(0);
    await request(app).get("/api/push/subscription").query({ endpoint: ENDPOINT }).set(auth()).expect(404);
  });
});
