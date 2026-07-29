import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Generic key-value store for server-side configuration and state that needs
 * to persist across restarts (e.g. eligibility weight fingerprints used to
 * detect when signal weights have changed and candidates need re-scoring).
 */
export const serverConfigTable = pgTable("server_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ServerConfig = typeof serverConfigTable.$inferSelect;
