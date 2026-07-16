import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { playersTable } from "./players";

export const transfersTable = pgTable(
  "transfers",
  {
    id: serial("id").primaryKey(),
    playerId: integer("player_id").notNull().references(() => playersTable.id),
    fromClub: text("from_club").notNull(),
    toClub: text("to_club").notNull(),
    transferType: text("transfer_type").notNull().default("transfer"), // transfer | loan | contract_extension
    fee: text("fee"),
    status: text("status").notNull().default("rumor"), // confirmed | rumor
    probabilityScore: integer("probability_score"),
    announcedAt: timestamp("announced_at", { withTimezone: true }).notNull(),
    summary: text("summary").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Prevent the sync from writing a duplicate row when it fires twice for the
    // same player/date (e.g. two overlapping cron ticks or a stale clubId read).
    // The insert in playerClubSync uses onConflictDoNothing against this index.
    uniqueIndex("transfers_player_announced_at_unique").on(table.playerId, table.announcedAt),
  ],
);

export const insertTransferSchema = createInsertSchema(transfersTable).omit({ id: true, createdAt: true });
export type InsertTransfer = z.infer<typeof insertTransferSchema>;
export type Transfer = typeof transfersTable.$inferSelect;
