import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { playersTable } from "./players";

export const transfersTable = pgTable("transfers", {
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
});

export const insertTransferSchema = createInsertSchema(transfersTable).omit({ id: true, createdAt: true });
export type InsertTransfer = z.infer<typeof insertTransferSchema>;
export type Transfer = typeof transfersTable.$inferSelect;
