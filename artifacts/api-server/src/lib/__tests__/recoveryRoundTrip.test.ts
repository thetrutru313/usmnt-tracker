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
