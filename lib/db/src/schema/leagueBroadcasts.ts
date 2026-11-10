import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * US TV / streaming home for each competition, edited on the admin page.
 * Keyed on the exact competition name API-Football returns (`fixtures.competition`).
 * The fixture syncs fill new matches from this table; a match whose broadcast
 * an admin set by hand (`fixtures.broadcast_set_by_admin`) is never overwritten.
 *
 * Seeded once from DEFAULT_LEAGUE_BROADCASTS (api-server `lib/broadcasts.ts`)
 * when the table is empty, so rows an admin deletes stay deleted.
 */
export const leagueBroadcastsTable = pgTable("league_broadcasts", {
  league: text("league").primaryKey(),
  tvNetwork: text("tv_network"),
  streamingService: text("streaming_service"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LeagueBroadcast = typeof leagueBroadcastsTable.$inferSelect;
