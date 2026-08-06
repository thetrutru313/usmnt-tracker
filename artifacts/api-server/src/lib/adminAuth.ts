import { type Request, type Response, type NextFunction } from "express";
import { db, adminSessionsTable } from "@workspace/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import { hashToken } from "./tokenUtils";

/**
 * Middleware that authenticates admin requests via a server-side session token.
 *
 * Clients supply `Authorization: Bearer <token>` where `<token>` was returned
 * once by POST /admin/transparency/verify. The plaintext is SHA-256 hashed and
 * looked up in `admin_sessions` — only non-revoked, non-expired rows pass.
 *
 * Status codes:
 *   503 — ADMIN_PASSWORD not set (admin not configured on this server), OR the
 *         admin_sessions table does not yet exist (deploy-ordering race, not 500).
 *   401 — token missing, unknown, expired, or revoked.
 *
 * Rollback safety: reverting this commit + republishing restores the old
 * password-as-token path. The admin_sessions table being present is harmless
 * to the old path.
 */
export async function requireAdminSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const password = process.env["ADMIN_PASSWORD"];
  if (!password) {
    res.status(503).json({ error: "Admin endpoints are not configured on this server" });
    return;
  }

  const auth = req.headers["authorization"] ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const hash = hashToken(token);

  try {
    const [session] = await db
      .select()
      .from(adminSessionsTable)
      .where(
        and(
          eq(adminSessionsTable.tokenHash, hash),
          isNull(adminSessionsTable.revokedAt),
          gt(adminSessionsTable.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!session) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    next();
  } catch (err: unknown) {
    // If admin_sessions doesn't exist yet (e.g. application code deployed before
    // the schema change reached production), return 503 so the client gets a
    // clear "not ready" signal rather than a generic 500.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("relation") && msg.includes("does not exist")) {
      res.status(503).json({
        error: "Admin sessions table is not yet available — publish may be in progress",
      });
      return;
    }
    throw err;
  }
}
