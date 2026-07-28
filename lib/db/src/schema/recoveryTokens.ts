import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { anonUsersTable } from "./anonUsers";

/**
 * Single-use recovery tokens. A user can generate one to back up their
 * follows and restore them on another device. The plaintext token is
 * returned once; only its SHA-256 hash is stored here.
 *
 * Tokens expire after 30 days and are consumed on redemption (used_at set).
 */
export const recoveryTokensTable = pgTable("recovery_tokens", {
  id: serial("id").primaryKey(),
  anonUserId: integer("anon_user_id")
    .notNull()
    .references(() => anonUsersTable.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export type RecoveryToken = typeof recoveryTokensTable.$inferSelect;
