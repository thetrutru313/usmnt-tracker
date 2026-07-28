import { type Request, type Response, type NextFunction } from "express";
import { db, anonUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashToken } from "./tokenUtils";
import type { AnonUser } from "@workspace/db";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      anonUser: AnonUser;
    }
  }
}

/**
 * Middleware that authenticates an anonymous user via a Bearer token.
 *
 * Reads `Authorization: Bearer <uuid-token>`, hashes it with SHA-256, and
 * looks up the matching row in `anon_users`. On success, attaches the DB row
 * to `res.locals.anonUser` and calls `next()`. On any failure (missing header,
 * malformed token, no matching row) it returns 401 immediately.
 *
 * The constant-time pattern from admin.ts is NOT needed here: the hash lookup
 * is performed by the database (a timing-safe index scan), and no sensitive
 * plaintext is ever compared in JS. Early-rejection of obviously bad tokens
 * (empty string, wrong format) is safe to do quickly.
 */
export async function requireAnonUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = req.headers["authorization"] ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const hash = hashToken(token);

  const [user] = await db
    .select()
    .from(anonUsersTable)
    .where(eq(anonUsersTable.tokenHash, hash))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.locals.anonUser = user;
  next();
}
