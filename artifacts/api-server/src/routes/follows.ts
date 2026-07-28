import { Router, type IRouter } from "express";
import { db, anonUsersTable, userFollowsTable, recoveryTokensTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { generateToken, hashToken } from "../lib/tokenUtils";
import { requireAnonUser } from "../lib/anonAuth";

const router: IRouter = Router();

/**
 * POST /follows/users
 * Provision a new anonymous user. Returns the plaintext auth token exactly
 * once — the server never reveals it again. The client must persist it in
 * localStorage (or equivalent).
 */
router.post("/follows/users", async (_req, res): Promise<void> => {
  const token = generateToken();
  const tokenHash = hashToken(token);

  await db.insert(anonUsersTable).values({ tokenHash });

  res.status(201).json({ token });
});

/**
 * GET /follows
 * Return the player IDs followed by the authenticated anonymous user.
 * Requires `Authorization: Bearer <token>`.
 */
router.get("/follows", requireAnonUser, async (_req, res): Promise<void> => {
  const user = res.locals.anonUser;

  const rows = await db
    .select({ playerId: userFollowsTable.playerId })
    .from(userFollowsTable)
    .where(eq(userFollowsTable.anonUserId, user.id));

  res.json({ playerIds: rows.map((r) => r.playerId) });
});

/**
 * POST /follows/:playerId
 * Follow a player. Idempotent — re-following an already-followed player
 * returns 200 rather than an error.
 * Requires `Authorization: Bearer <token>`.
 */
router.post("/follows/:playerId", requireAnonUser, async (req, res): Promise<void> => {
  const playerId = parseInt(String(req.params["playerId"] ?? ""), 10);
  if (Number.isNaN(playerId)) {
    res.status(400).json({ error: "Invalid playerId" });
    return;
  }

  const user = res.locals.anonUser;

  await db
    .insert(userFollowsTable)
    .values({ anonUserId: user.id, playerId })
    .onConflictDoNothing();

  res.json({ ok: true });
});

/**
 * DELETE /follows/:playerId
 * Unfollow a player. Idempotent — unfollowing a player that isn't followed
 * returns 200.
 * Requires `Authorization: Bearer <token>`.
 */
router.delete("/follows/:playerId", requireAnonUser, async (req, res): Promise<void> => {
  const playerId = parseInt(String(req.params["playerId"] ?? ""), 10);
  if (Number.isNaN(playerId)) {
    res.status(400).json({ error: "Invalid playerId" });
    return;
  }

  const user = res.locals.anonUser;

  await db
    .delete(userFollowsTable)
    .where(
      and(
        eq(userFollowsTable.anonUserId, user.id),
        eq(userFollowsTable.playerId, playerId),
      ),
    );

  res.json({ ok: true });
});

/**
 * POST /follows/recovery-token
 * Generate a single-use recovery token valid for 30 days. Returns a recovery
 * URL containing the plaintext token — safe to bookmark or share with the
 * owner's other devices. The token is stored hashed and never revealed again.
 * Requires `Authorization: Bearer <token>`.
 */
router.post("/follows/recovery-token", requireAnonUser, async (_req, res): Promise<void> => {
  const user = res.locals.anonUser;

  const recoveryToken = generateToken();
  const tokenHash = hashToken(recoveryToken);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  await db.insert(recoveryTokensTable).values({
    anonUserId: user.id,
    tokenHash,
    expiresAt,
  });

  res.json({ recoveryUrl: `/recover?token=${recoveryToken}` });
});

/**
 * POST /follows/recover
 * Consume a recovery token and return a fresh auth token for the same account.
 * Body: { token: string }
 * The recovery token is single-use: `used_at` is set on redemption. Expired
 * or already-used tokens are rejected with 400.
 */
router.post("/follows/recover", async (req, res): Promise<void> => {
  const { token } = req.body as { token?: unknown };
  if (typeof token !== "string" || !token.trim()) {
    res.status(400).json({ error: "Body must be { token: string }" });
    return;
  }

  const tokenHash = hashToken(token.trim());
  const now = new Date();

  const [recovery] = await db
    .select()
    .from(recoveryTokensTable)
    .where(eq(recoveryTokensTable.tokenHash, tokenHash))
    .limit(1);

  if (!recovery) {
    res.status(400).json({ error: "Invalid recovery token" });
    return;
  }

  if (recovery.usedAt !== null) {
    res.status(400).json({ error: "Recovery token has already been used" });
    return;
  }

  if (recovery.expiresAt < now) {
    res.status(400).json({ error: "Recovery token has expired" });
    return;
  }

  // Atomically consume the recovery token and rotate the auth token.
  // The WHERE clause on the update includes `usedAt IS NULL` so that two
  // concurrent redeems racing past the pre-check above cannot both succeed:
  // only the first UPDATE will match a row, the second will return 0 rows and
  // be rejected below.
  const newToken = generateToken();
  const newTokenHash = hashToken(newToken);

  let consumed = false;
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(recoveryTokensTable)
      .set({ usedAt: now })
      .where(and(eq(recoveryTokensTable.id, recovery.id), isNull(recoveryTokensTable.usedAt)))
      .returning({ id: recoveryTokensTable.id });

    if (updated.length === 0) {
      // Another request consumed the token concurrently — bail out.
      return;
    }

    await tx
      .update(anonUsersTable)
      .set({ tokenHash: newTokenHash })
      .where(eq(anonUsersTable.id, recovery.anonUserId));

    consumed = true;
  });

  if (!consumed) {
    res.status(400).json({ error: "Recovery token has already been used" });
    return;
  }

  res.json({ token: newToken });
});

export default router;
