import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { playersTable } from "./players";

/**
 * Immutable audit trail of every USMNT status change for a tracked player.
 * Written by the commitment-tracking pipeline and surfaced to the admin review
 * queue.  Records are never deleted — the full history must be preserved even
 * when the player record is updated.
 *
 * `changed_by` is either "system" (automated commitment sweep) or the name /
 * identifier of the human operator who made a manual override.
 */
export const playerStatusHistoryTable = pgTable("player_status_history", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id")
    .notNull()
    .references(() => playersTable.id),
  prevStatus: text("prev_status"),
  newStatus: text("new_status").notNull(),
  /** Human-readable explanation — e.g. "Senior debut for Mexico in CONCACAF Nations League (fixture 12345)" */
  reason: text("reason").notNull(),
  changedBy: text("changed_by").notNull(), // "system" | operator name
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlayerStatusHistory = typeof playerStatusHistoryTable.$inferSelect;
