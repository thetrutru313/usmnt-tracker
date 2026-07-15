import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * One row per named sync process. Written at the START of each run so that
 * a server restart within the cooldown window sees a recent timestamp and
 * skips the redundant immediate re-run.
 */
export const syncMetadataTable = pgTable("sync_metadata", {
  syncName: text("sync_name").primaryKey(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }).notNull(),
});

export type SyncMetadata = typeof syncMetadataTable.$inferSelect;
