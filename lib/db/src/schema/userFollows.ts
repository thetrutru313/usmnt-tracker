import { integer, pgTable, serial, timestamp, unique } from "drizzle-orm/pg-core";
import { anonUsersTable } from "./anonUsers";
import { playersTable } from "./players";

/**
 * Player follows for anonymous users. Each row links one anon_user to one
 * player. The unique constraint prevents duplicate follows and lets the
 * frontend optimistically assume idempotent POST behavior.
 */
export const userFollowsTable = pgTable(
  "user_follows",
  {
    id: serial("id").primaryKey(),
    anonUserId: integer("anon_user_id")
      .notNull()
      .references(() => anonUsersTable.id),
    playerId: integer("player_id")
      .notNull()
      .references(() => playersTable.id),
    followedAt: timestamp("followed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("user_follows_anon_user_player_unique").on(t.anonUserId, t.playerId)],
);

export type UserFollow = typeof userFollowsTable.$inferSelect;
