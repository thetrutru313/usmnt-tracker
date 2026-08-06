import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Server-side admin sessions. A session is created on every successful login
 * via POST /admin/transparency/verify. Only the SHA-256 hash of each token is
 * stored — the plaintext is returned once and never persisted.
 *
 * Sessions expire after ADMIN_SESSION_HOURS (default 24) and can be revoked
 * immediately via POST /admin/logout. The daily cleanup sweep in
 * anonUserCleanup.ts purges expired and revoked rows.
 */
export const adminSessionsTable = pgTable("admin_sessions", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export type AdminSession = typeof adminSessionsTable.$inferSelect;
