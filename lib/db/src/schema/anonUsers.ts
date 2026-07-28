import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Anonymous users — visitors who follow players without creating an account.
 * The auth token is never stored in plaintext; only its SHA-256 hex hash is
 * persisted here. The plaintext token is returned to the client once on
 * creation and never again.
 *
 * The nullable `email` column is reserved for a future magic-link upgrade
 * path that lets users attach an email without migrating their follows.
 */
export const anonUsersTable = pgTable("anon_users", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AnonUser = typeof anonUsersTable.$inferSelect;
