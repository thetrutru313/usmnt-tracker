/**
 * Integration tests for the admin session token authentication system.
 *
 * Verifies that:
 *  1. POST /admin/transparency/verify with the correct password returns a UUID
 *     token (not the password itself) and a session expiry.
 *  2. An incorrect password returns 401 with no token in the body.
 *  3. A valid session token authorises a subsequent admin request.
 *  4. An expired session token returns 401.
 *  5. A revoked session token returns 401.
 *  6. Sending the raw ADMIN_PASSWORD as a Bearer token to an admin route
 *     (not the verify endpoint) returns 401.
 *  7. POST /admin/logout revokes the session; subsequent requests return 401.
 *
 * Tier: app (imports the real Express app; requires DATABASE_URL because
 * requireAdminSession queries the admin_sessions table).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { db, adminSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashToken } from "../tokenUtils.js";

// ── Constants ──────────────────────────────────────────────────────────────────

/** Unique password for this test suite — must not collide with other suites. */
const ADMIN_PASSWORD = "admin-session-auth-test-pw-zx9q";

// ── Helpers ────────────────────────────────────────────────────────────────────

function authBearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function createSession(): Promise<{ token: string; hash: string }> {
  const res = await request(app)
    .post("/api/admin/transparency/verify")
    .set(authBearer(ADMIN_PASSWORD));
  const token = (res.body as { token: string }).token;
  return { token, hash: hashToken(token) };
}

async function deleteSessionByToken(token: string): Promise<void> {
  await db.delete(adminSessionsTable).where(eq(adminSessionsTable.tokenHash, hashToken(token)));
}

// ── Setup / teardown ───────────────────────────────────────────────────────────

beforeAll(() => {
  process.env["ADMIN_PASSWORD"] = ADMIN_PASSWORD;
});

afterAll(() => {
  delete process.env["ADMIN_PASSWORD"];
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("POST /api/admin/transparency/verify", () => {
  it("returns a UUID token (not the password) on a correct password", async () => {
    const res = await request(app)
      .post("/api/admin/transparency/verify")
      .set(authBearer(ADMIN_PASSWORD));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
    expect(typeof res.body.token).toBe("string");
    // Token must be a non-empty string different from the password
    expect(res.body.token).not.toBe(ADMIN_PASSWORD);
    expect(res.body.token.length).toBeGreaterThan(8);
    expect(res.body).toHaveProperty("sessionExpiryMs");

    // Cleanup
    await deleteSessionByToken(res.body.token as string);
  });

  it("returns 401 and no token on an incorrect password", async () => {
    const res = await request(app)
      .post("/api/admin/transparency/verify")
      .set(authBearer("wrong-password-definitely-not-correct"));

    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty("token");
  });
});

describe("requireAdminSession middleware", () => {
  let sessionToken: string;

  beforeAll(async () => {
    const session = await createSession();
    sessionToken = session.token;
  });

  afterAll(async () => {
    if (sessionToken) await deleteSessionByToken(sessionToken);
  });

  it("authorises a request carrying a valid session token", async () => {
    const res = await request(app)
      .get("/api/admin/session")
      .set(authBearer(sessionToken));

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("rejects the raw ADMIN_PASSWORD used as a Bearer token on admin routes", async () => {
    // After this change the password is only accepted at the verify endpoint.
    // All other admin routes require a server-issued session token.
    const res = await request(app)
      .get("/api/admin/session")
      .set(authBearer(ADMIN_PASSWORD));

    expect(res.status).toBe(401);
  });

  it("returns 401 for an expired session token", async () => {
    const expiredToken = "expired-test-token-for-auth-suite";
    const expiredHash = hashToken(expiredToken);
    const oneSecondAgo = new Date(Date.now() - 1_000);

    await db.insert(adminSessionsTable).values({
      tokenHash: expiredHash,
      expiresAt: oneSecondAgo,
    });

    try {
      const res = await request(app)
        .get("/api/admin/session")
        .set(authBearer(expiredToken));

      expect(res.status).toBe(401);
    } finally {
      await db.delete(adminSessionsTable).where(eq(adminSessionsTable.tokenHash, expiredHash));
    }
  });

  it("returns 401 for a revoked session token", async () => {
    const revokedToken = "revoked-test-token-for-auth-suite";
    const revokedHash = hashToken(revokedToken);
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1_000);

    await db.insert(adminSessionsTable).values({
      tokenHash: revokedHash,
      expiresAt: futureDate,
      revokedAt: new Date(),
    });

    try {
      const res = await request(app)
        .get("/api/admin/session")
        .set(authBearer(revokedToken));

      expect(res.status).toBe(401);
    } finally {
      await db.delete(adminSessionsTable).where(eq(adminSessionsTable.tokenHash, revokedHash));
    }
  });
});

describe("POST /api/admin/logout", () => {
  it("revokes the session so subsequent admin requests return 401", async () => {
    const { token } = await createSession();

    // Session is valid before logout
    const beforeRes = await request(app)
      .get("/api/admin/session")
      .set(authBearer(token));
    expect(beforeRes.status).toBe(200);

    // Logout
    const logoutRes = await request(app)
      .post("/api/admin/logout")
      .set(authBearer(token));
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.ok).toBe(true);

    // Session is now invalid
    const afterRes = await request(app)
      .get("/api/admin/session")
      .set(authBearer(token));
    expect(afterRes.status).toBe(401);

    // Cleanup (row is revoked, not deleted — purge it)
    await deleteSessionByToken(token);
  });
});
