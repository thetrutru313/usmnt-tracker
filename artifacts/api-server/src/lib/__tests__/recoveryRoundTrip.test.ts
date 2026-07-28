/**
 * Integration guard: confirms that a user's follows survive a full
 * recovery-token round-trip without data loss.
 *
 * Flow:
 *  1. Seed an anon_users row and several user_follows rows.
 *  2. POST /api/follows/recovery-token  — generate a recovery URL.
 *  3. POST /api/follows/recover         — redeem the token; receive a new auth token.
 *  4. GET  /api/follows (new token)     — confirm the same playerIds are returned.
 *
 * Edge cases:
 *  • Expired recovery token        → 400.
 *  • Already-used recovery token   → 400.
 *  • Original auth token after rotation → 401 (token was rotated on redemption).
 *
 * Data isolation:
 *  All rows are inserted with generated UUIDs / sentinel values and removed in
 *  afterAll so the test leaves the DB in its original state.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import {
  db,
  anonUsersTable,
  userFollowsTable,
  recoveryTokensTable,
  playersTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { generateToken, hashToken } from "../tokenUtils.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Insert a fresh anon_users row and return its id plus the plaintext token. */
async function seedAnonUser(): Promise<{ id: number; token: string }> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const [row] = await db
    .insert(anonUsersTable)
    .values({ tokenHash })
    .returning({ id: anonUsersTable.id });
  if (!row) throw new Error("Failed to insert anon_users row");
  return { id: row.id, token };
}

/** Authorization header for a plaintext anon token. */
function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ─── Shared state ──────────────────────────────────────────────────────────────

/** A handful of real player IDs fetched from the DB once at setup time.
 *  Follows require an FK to players, so we borrow existing rows rather than
 *  inserting disposable ones. */
let realPlayerIds: number[] = [];

// Anon user IDs inserted by this suite — cleaned up in afterAll.
// Recovery tokens are cleaned by anonUserId (covers both manually inserted
// tokens and those created via POST /api/follows/recovery-token) so we do
// not need to track individual recovery-token row IDs separately.
const insertedAnonUserIds: number[] = [];

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  // Borrow up to 3 existing player IDs to satisfy the user_follows FK.
  const rows = await db
    .select({ id: playersTable.id })
    .from(playersTable)
    .limit(3);
  realPlayerIds = rows.map((r) => r.id);
  if (realPlayerIds.length === 0) {
    throw new Error(
      "No players found in the database — recovery-round-trip test requires at " +
        "least one seeded player row.",
    );
  }
});

afterAll(async () => {
  if (insertedAnonUserIds.length === 0) return;

  // Delete recovery_tokens before anon_users to satisfy the FK constraint.
  // This covers both tokens inserted directly (edge-case tests) and tokens
  // created via POST /api/follows/recovery-token (happy-path tests) — both
  // reference the same anon_user_id so a single delete-by-userId clears all.
  await db
    .delete(recoveryTokensTable)
    .where(inArray(recoveryTokensTable.anonUserId, insertedAnonUserIds));

  // Delete user_follows next (FK → anon_users).
  await db
    .delete(userFollowsTable)
    .where(inArray(userFollowsTable.anonUserId, insertedAnonUserIds));

  // Finally remove the anon_users rows themselves.
  await db
    .delete(anonUsersTable)
    .where(inArray(anonUsersTable.id, insertedAnonUserIds));
});

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("Recovery token round-trip — follows survive across device recovery", () => {
  it("returns the same playerIds under the new auth token after a full round-trip", async () => {
    // ── 1. Seed user + follows ──────────────────────────────────────────────
    const { id: userId, token: originalToken } = await seedAnonUser();
    insertedAnonUserIds.push(userId);

    await db
      .insert(userFollowsTable)
      .values(realPlayerIds.map((playerId) => ({ anonUserId: userId, playerId })));

    // ── 2. Generate a recovery token ───────────────────────────────────────
    const recoveryRes = await request(app)
      .post("/api/follows/recovery-token")
      .set(bearer(originalToken));

    expect(
      recoveryRes.status,
      `POST /recovery-token failed (${recoveryRes.status}): ${JSON.stringify(recoveryRes.body)}`,
    ).toBe(200);

    const { recoveryUrl } = recoveryRes.body as { recoveryUrl?: string };
    expect(typeof recoveryUrl).toBe("string");

    // Extract the plaintext recovery token from the URL.
    const recoveryToken = new URL(
      recoveryUrl!,
      "http://localhost",
    ).searchParams.get("token");
    expect(typeof recoveryToken).toBe("string");
    expect(recoveryToken!.length).toBeGreaterThan(0);

    // ── 3. Redeem the recovery token ───────────────────────────────────────
    const redeemRes = await request(app)
      .post("/api/follows/recover")
      .send({ token: recoveryToken });

    expect(
      redeemRes.status,
      `POST /recover failed (${redeemRes.status}): ${JSON.stringify(redeemRes.body)}`,
    ).toBe(200);

    const { token: newToken } = redeemRes.body as { token?: string };
    expect(typeof newToken).toBe("string");
    expect(newToken).not.toBe(originalToken);

    // ── 4. Verify follows under the new token ──────────────────────────────
    const followsRes = await request(app)
      .get("/api/follows")
      .set(bearer(newToken!));

    expect(
      followsRes.status,
      `GET /follows (new token) failed (${followsRes.status}): ${JSON.stringify(followsRes.body)}`,
    ).toBe(200);

    const { playerIds } = followsRes.body as { playerIds?: number[] };
    expect(Array.isArray(playerIds)).toBe(true);
    expect(playerIds!.sort()).toEqual([...realPlayerIds].sort());
  });

  it("rejects an expired recovery token with 400", async () => {
    const { id: userId, token } = await seedAnonUser();
    insertedAnonUserIds.push(userId);

    // Insert a recovery token whose expiry is already in the past.
    const expiredToken = generateToken();
    const expiredHash = hashToken(expiredToken);
    const pastDate = new Date(Date.now() - 60_000); // 1 minute ago

    await db
      .insert(recoveryTokensTable)
      .values({ anonUserId: userId, tokenHash: expiredHash, expiresAt: pastDate });

    // Sanity-check: the original token is still valid.
    const followsRes = await request(app)
      .get("/api/follows")
      .set(bearer(token));
    expect(followsRes.status).toBe(200);

    // Redeeming the expired token must be rejected.
    const redeemRes = await request(app)
      .post("/api/follows/recover")
      .send({ token: expiredToken });

    expect(redeemRes.status).toBe(400);
    expect((redeemRes.body as { error?: string }).error).toMatch(/expired/i);
  });

  it("rejects an already-used recovery token with 400", async () => {
    const { id: userId } = await seedAnonUser();
    insertedAnonUserIds.push(userId);

    // Insert a recovery token that has already been consumed.
    const usedToken = generateToken();
    const usedHash = hashToken(usedToken);
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const usedAt = new Date();

    await db
      .insert(recoveryTokensTable)
      .values({
        anonUserId: userId,
        tokenHash: usedHash,
        expiresAt: futureDate,
        usedAt,
      });

    const redeemRes = await request(app)
      .post("/api/follows/recover")
      .send({ token: usedToken });

    expect(redeemRes.status).toBe(400);
    expect((redeemRes.body as { error?: string }).error).toMatch(/already been used/i);
  });

  it("only lets one of two simultaneous redemptions through (race-guard)", async () => {
    // ── Seed user + recovery token ─────────────────────────────────────────
    const { id: userId, token: originalToken } = await seedAnonUser();
    insertedAnonUserIds.push(userId);

    const recoveryRes = await request(app)
      .post("/api/follows/recovery-token")
      .set(bearer(originalToken));
    expect(recoveryRes.status).toBe(200);

    const recoveryUrl = (recoveryRes.body as { recoveryUrl?: string }).recoveryUrl!;
    const recoveryToken = new URL(recoveryUrl, "http://localhost").searchParams.get("token")!;

    // ── Fire two simultaneous redemption requests ──────────────────────────
    const [res1, res2] = await Promise.all([
      request(app).post("/api/follows/recover").send({ token: recoveryToken }),
      request(app).post("/api/follows/recover").send({ token: recoveryToken }),
    ]);

    const statuses = [res1.status, res2.status].sort();

    // Exactly one must succeed and one must fail.
    expect(statuses).toEqual([200, 400]);

    // ── Verify only one used_at is recorded in the DB ─────────────────────
    const [tokenRow] = await db
      .select()
      .from(recoveryTokensTable)
      .where(eq(recoveryTokensTable.anonUserId, userId))
      .limit(1);

    expect(tokenRow).toBeDefined();
    expect(tokenRow!.usedAt).not.toBeNull();
  });

  it("caps active tokens at 3 — the oldest is invalidated when a 4th is requested", async () => {
    const { id: userId, token: authToken } = await seedAnonUser();
    insertedAnonUserIds.push(userId);

    // Generate MAX (3) tokens — all should succeed.
    const recoveryTokens: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post("/api/follows/recovery-token")
        .set(bearer(authToken));
      expect(res.status, `Token ${i + 1} generation failed: ${JSON.stringify(res.body)}`).toBe(200);
      const url = (res.body as { recoveryUrl?: string }).recoveryUrl!;
      const tok = new URL(url, "http://localhost").searchParams.get("token")!;
      recoveryTokens.push(tok);
    }

    // Request a 4th token — should succeed and invalidate the oldest.
    const fourthRes = await request(app)
      .post("/api/follows/recovery-token")
      .set(bearer(authToken));
    expect(
      fourthRes.status,
      `4th token generation failed: ${JSON.stringify(fourthRes.body)}`,
    ).toBe(200);
    const fourthUrl = (fourthRes.body as { recoveryUrl?: string }).recoveryUrl!;
    const fourthToken = new URL(fourthUrl, "http://localhost").searchParams.get("token")!;

    // The oldest token (first one generated) must now be rejected.
    const oldestRedeemRes = await request(app)
      .post("/api/follows/recover")
      .send({ token: recoveryTokens[0] });
    expect(
      oldestRedeemRes.status,
      "Expected oldest token to be invalidated (400)",
    ).toBe(400);

    // The newest token must still be redeemable.
    const newestRedeemRes = await request(app)
      .post("/api/follows/recover")
      .send({ token: fourthToken });
    expect(
      newestRedeemRes.status,
      `Expected newest token to be valid (got ${newestRedeemRes.status}): ${JSON.stringify(newestRedeemRes.body)}`,
    ).toBe(200);
  });

  it("exactly MAX_ACTIVE_RECOVERY_TOKENS=3 tokens remain active after 5 consecutive requests", async () => {
    const { id: userId, token: authToken } = await seedAnonUser();
    insertedAnonUserIds.push(userId);

    const allTokens: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/follows/recovery-token")
        .set(bearer(authToken));
      expect(res.status).toBe(200);
      const url = (res.body as { recoveryUrl?: string }).recoveryUrl!;
      const tok = new URL(url, "http://localhost").searchParams.get("token")!;
      allTokens.push(tok);
    }

    // The first two tokens should be invalidated; the last three should be active.
    // Try redeeming each — but because redemption rotates the auth token we only
    // probe the DB directly via the hash to avoid cascading state changes.
    const { hashToken: hashFn } = await import("../tokenUtils.js");
    const { db: dbConn, recoveryTokensTable: rtTable } = await import("@workspace/db");
    const { isNull: isNullFn, eq: eqFn } = await import("drizzle-orm");

    let activeCount = 0;
    let invalidatedCount = 0;
    for (const tok of allTokens) {
      const hash = hashFn(tok);
      const [row] = await dbConn
        .select({ usedAt: rtTable.usedAt })
        .from(rtTable)
        .where(eqFn(rtTable.tokenHash, hash))
        .limit(1);
      if (row) {
        if (row.usedAt === null) activeCount++;
        else invalidatedCount++;
      }
    }

    expect(activeCount).toBe(3);
    expect(invalidatedCount).toBe(2);
  });

  it("returns 401 when the original auth token is used after token rotation", async () => {
    // ── Seed ───────────────────────────────────────────────────────────────
    const { id: userId, token: originalToken } = await seedAnonUser();
    insertedAnonUserIds.push(userId);

    // ── Generate + redeem a recovery token ─────────────────────────────────
    const recoveryRes = await request(app)
      .post("/api/follows/recovery-token")
      .set(bearer(originalToken));
    expect(recoveryRes.status).toBe(200);

    const recoveryUrl = (recoveryRes.body as { recoveryUrl?: string }).recoveryUrl!;
    const recoveryToken = new URL(recoveryUrl, "http://localhost").searchParams.get("token")!;

    const redeemRes = await request(app)
      .post("/api/follows/recover")
      .send({ token: recoveryToken });
    expect(redeemRes.status).toBe(200);

    // ── The original token must now be rejected ─────────────────────────────
    const followsWithOldToken = await request(app)
      .get("/api/follows")
      .set(bearer(originalToken));

    expect(followsWithOldToken.status).toBe(401);
  });
});
