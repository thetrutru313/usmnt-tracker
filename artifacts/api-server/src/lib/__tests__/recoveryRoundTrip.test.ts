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
  clubsTable,
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

/** Player IDs used as FK targets for user_follows rows.
 *  Populated by beforeAll with sentinel rows so the test works on a
 *  schema-only CI database with no seed data. */
let realPlayerIds: number[] = [];

// Anon user IDs inserted by this suite — cleaned up in afterAll.
// Recovery tokens are cleaned by anonUserId (covers both manually inserted
// tokens and those created via POST /api/follows/recovery-token) so we do
// not need to track individual recovery-token row IDs separately.
const insertedAnonUserIds: number[] = [];

// Sentinel club + player rows inserted by beforeAll — removed in afterAll
// after all anon_users/follows/recovery-token rows are already gone.
let sentinelClubId: number | undefined;
const sentinelPlayerIds: number[] = [];

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  // Insert a disposable club + 3 disposable players to satisfy the
  // user_follows FK without depending on seed data being present.
  const [club] = await db
    .insert(clubsTable)
    .values({ name: "CI Test Club [recovery-rt-sentinel]", league: "MLS", country: "USA" })
    .returning({ id: clubsTable.id });
  if (!club) throw new Error("Failed to insert sentinel club for recovery round-trip test");
  sentinelClubId = club.id;

  const inserted = await db
    .insert(playersTable)
    .values([
      { name: "CI Sentinel Player 1", slug: "ci-recovery-rt-sentinel-1", position: "MF", category: "prospect", clubId: sentinelClubId, age: 22 },
      { name: "CI Sentinel Player 2", slug: "ci-recovery-rt-sentinel-2", position: "FW", category: "prospect", clubId: sentinelClubId, age: 23 },
      { name: "CI Sentinel Player 3", slug: "ci-recovery-rt-sentinel-3", position: "DF", category: "prospect", clubId: sentinelClubId, age: 24 },
    ])
    .returning({ id: playersTable.id });
  if (inserted.length === 0) throw new Error("Failed to insert sentinel players for recovery round-trip test");

  inserted.forEach((r) => sentinelPlayerIds.push(r.id));
  realPlayerIds = sentinelPlayerIds.slice();
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

  // Clean up sentinel players and club inserted in beforeAll.
  // Follows referencing them were already removed above (via anonUserId).
  if (sentinelPlayerIds.length > 0) {
    await db.delete(playersTable).where(inArray(playersTable.id, sentinelPlayerIds));
  }
  if (sentinelClubId !== undefined) {
    await db.delete(clubsTable).where(eq(clubsTable.id, sentinelClubId));
  }
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

  it("rejects a superseded recovery token with a distinct 400 message", async () => {
    const { id: userId } = await seedAnonUser();
    insertedAnonUserIds.push(userId);

    // Insert a recovery token that was displaced by a newer one (superseded_at set,
    // used_at still null — this is the state set by the 3-token-cap invalidation).
    const supersededToken = generateToken();
    const supersededHash = hashToken(supersededToken);
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const supersededAt = new Date();

    await db
      .insert(recoveryTokensTable)
      .values({
        anonUserId: userId,
        tokenHash: supersededHash,
        expiresAt: futureDate,
        supersededAt,
      });

    const redeemRes = await request(app)
      .post("/api/follows/recover")
      .send({ token: supersededToken });

    expect(redeemRes.status).toBe(400);
    // Must say "replaced" / "newer", NOT "already been used"
    expect((redeemRes.body as { error?: string }).error).toMatch(/replaced/i);
    expect((redeemRes.body as { error?: string }).error).not.toMatch(/already been used/i);
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

    // Neither request may return a 5xx error or hang.
    expect(
      [res1.status, res2.status].every((s) => s < 500),
      `At least one request returned a 5xx: ${res1.status}, ${res2.status}`,
    ).toBe(true);

    const statuses = [res1.status, res2.status].sort();

    // Exactly one must succeed and one must fail.
    expect(statuses).toEqual([200, 400]);

    // The successful response must carry a fresh auth token.
    const successRes = res1.status === 200 ? res1 : res2;
    const { token: freshToken } = successRes.body as { token?: string };
    expect(typeof freshToken).toBe("string");
    expect(freshToken!.length).toBeGreaterThan(0);
    expect(freshToken).not.toBe(originalToken);

    // The failing response must report the canonical "already used" message
    // (not a generic 400 or a 500).
    const failRes = res1.status === 400 ? res1 : res2;
    expect(
      (failRes.body as { error?: string }).error,
      "The losing concurrent redemption must report 'already been used'",
    ).toMatch(/already been used/i);

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

    // The oldest token (first one generated) must now be rejected with the
    // "superseded" message — not the generic "already been used" message.
    const oldestRedeemRes = await request(app)
      .post("/api/follows/recover")
      .send({ token: recoveryTokens[0] });
    expect(
      oldestRedeemRes.status,
      "Expected oldest token to be invalidated (400)",
    ).toBe(400);
    expect(
      (oldestRedeemRes.body as { error?: string }).error,
      "Oldest displaced token should report 'replaced', not 'already been used'",
    ).toMatch(/replaced/i);

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

    // The first two tokens should be invalidated (superseded_at set); the last
    // three should still be active (both usedAt and supersededAt null).
    // Probe the DB directly via the hash to avoid cascading state changes from
    // redemption (which rotates the auth token).
    const { hashToken: hashFn } = await import("../tokenUtils.js");
    const { db: dbConn, recoveryTokensTable: rtTable } = await import("@workspace/db");
    const { eq: eqFn } = await import("drizzle-orm");

    let activeCount = 0;
    let invalidatedCount = 0;
    for (const tok of allTokens) {
      const hash = hashFn(tok);
      const [row] = await dbConn
        .select({ usedAt: rtTable.usedAt, supersededAt: rtTable.supersededAt })
        .from(rtTable)
        .where(eqFn(rtTable.tokenHash, hash))
        .limit(1);
      if (row) {
        if (row.usedAt === null && row.supersededAt === null) activeCount++;
        else invalidatedCount++;
      }
    }

    expect(activeCount).toBe(3);
    expect(invalidatedCount).toBe(2);
  });

  it("superseded token stays rejected after the account is recovered on a new device", async () => {
    // Full scenario: user bookmarks token 1, generates tokens 2–4 on a new
    // device, redeems token 4 to rotate auth, then tries the stale token 1.
    //
    // Flow:
    //  1. Seed user + follows
    //  2. Generate tokens 1, 2, 3  (all active; cap = 3)
    //  3. Generate token 4         (token 1 is now superseded)
    //  4. Redeem token 4           (auth token rotated)
    //  5. Assert token 1 → 400 /replaced/i
    //  6. Assert new auth token works for GET /api/follows

    // ── 1. Seed user + follows ────────────────────────────────────────────
    const { id: userId, token: authToken } = await seedAnonUser();
    insertedAnonUserIds.push(userId);

    if (realPlayerIds.length > 0) {
      await db
        .insert(userFollowsTable)
        .values(realPlayerIds.map((playerId) => ({ anonUserId: userId, playerId })));
    }

    // ── 2. Generate tokens 1–3 ───────────────────────────────────────────
    const tokens: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post("/api/follows/recovery-token")
        .set(bearer(authToken));
      expect(res.status, `Token ${i + 1} failed: ${JSON.stringify(res.body)}`).toBe(200);
      const url = (res.body as { recoveryUrl?: string }).recoveryUrl!;
      tokens.push(new URL(url, "http://localhost").searchParams.get("token")!);
    }

    // ── 3. Generate token 4 (displaces token 1) ───────────────────────────
    const fourthRes = await request(app)
      .post("/api/follows/recovery-token")
      .set(bearer(authToken));
    expect(fourthRes.status, `Token 4 failed: ${JSON.stringify(fourthRes.body)}`).toBe(200);
    const fourthUrl = (fourthRes.body as { recoveryUrl?: string }).recoveryUrl!;
    const fourthToken = new URL(fourthUrl, "http://localhost").searchParams.get("token")!;

    // ── 4. Redeem token 4 on the "new device" ─────────────────────────────
    const redeemRes = await request(app)
      .post("/api/follows/recover")
      .send({ token: fourthToken });
    expect(
      redeemRes.status,
      `Redeeming token 4 failed (${redeemRes.status}): ${JSON.stringify(redeemRes.body)}`,
    ).toBe(200);
    const { token: newAuthToken } = redeemRes.body as { token?: string };
    expect(typeof newAuthToken).toBe("string");
    expect(newAuthToken).not.toBe(authToken);

    // ── 5. Token 1 must be rejected as superseded ─────────────────────────
    const oldTokenRes = await request(app)
      .post("/api/follows/recover")
      .send({ token: tokens[0] });
    expect(
      oldTokenRes.status,
      `Expected superseded token 1 to return 400 (got ${oldTokenRes.status})`,
    ).toBe(400);
    expect(
      (oldTokenRes.body as { error?: string }).error,
      "Superseded token must match /replaced/i",
    ).toMatch(/replaced/i);
    expect(
      (oldTokenRes.body as { error?: string }).error,
      "Superseded token must NOT say 'already been used'",
    ).not.toMatch(/already been used/i);

    // ── 6. New auth token still works for GET /api/follows ────────────────
    const followsRes = await request(app)
      .get("/api/follows")
      .set(bearer(newAuthToken!));
    expect(
      followsRes.status,
      `GET /follows with new token failed (${followsRes.status}): ${JSON.stringify(followsRes.body)}`,
    ).toBe(200);
    const { playerIds } = followsRes.body as { playerIds?: number[] };
    expect(Array.isArray(playerIds)).toBe(true);
    expect(playerIds!.sort()).toEqual([...realPlayerIds].sort());
  });

  it("sibling recovery token stays redeemable after another token is redeemed", async () => {
    // ── 1. Seed user ───────────────────────────────────────────────────────
    const { id: userId, token: authToken } = await seedAnonUser();
    insertedAnonUserIds.push(userId);

    // ── 2. Generate two recovery tokens (A and B) ─────────────────────────
    const genA = await request(app)
      .post("/api/follows/recovery-token")
      .set(bearer(authToken));
    expect(genA.status, `Token A generation failed: ${JSON.stringify(genA.body)}`).toBe(200);
    const tokenA = new URL(
      (genA.body as { recoveryUrl: string }).recoveryUrl,
      "http://localhost",
    ).searchParams.get("token")!;

    const genB = await request(app)
      .post("/api/follows/recovery-token")
      .set(bearer(authToken));
    expect(genB.status, `Token B generation failed: ${JSON.stringify(genB.body)}`).toBe(200);
    const tokenB = new URL(
      (genB.body as { recoveryUrl: string }).recoveryUrl,
      "http://localhost",
    ).searchParams.get("token")!;

    // ── 3. Redeem token A ─────────────────────────────────────────────────
    const redeemA = await request(app)
      .post("/api/follows/recover")
      .send({ token: tokenA });
    expect(
      redeemA.status,
      `Redeeming token A failed (${redeemA.status}): ${JSON.stringify(redeemA.body)}`,
    ).toBe(200);
    const { token: authAfterA } = redeemA.body as { token?: string };
    expect(typeof authAfterA).toBe("string");

    // ── 4. Token B must still be redeemable ───────────────────────────────
    const redeemB = await request(app)
      .post("/api/follows/recover")
      .send({ token: tokenB });
    expect(
      redeemB.status,
      `Token B should still be valid after token A was redeemed (got ${redeemB.status}): ${JSON.stringify(redeemB.body)}`,
    ).toBe(200);
    const { token: authAfterB } = redeemB.body as { token?: string };
    expect(typeof authAfterB).toBe("string");
    expect(authAfterB).not.toBe(authAfterA);
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
