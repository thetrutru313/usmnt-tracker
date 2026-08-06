import { date, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { playersTable } from "./players";

export const injuriesTable = pgTable("injuries", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => playersTable.id),
  bodyPart: text("body_part").notNull(),
  status: text("status").notNull().default("active"), // active | recovering | returned
  expectedReturn: date("expected_return", { mode: "string" }),
  daysMissed: integer("days_missed").notNull().default(0),
  matchesMissed: integer("matches_missed").notNull().default(0),
  latestUpdate: text("latest_update").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
},
(table) => [
  index("injuries_player_id_idx").on(table.playerId),
]);

export const insertInjurySchema = createInsertSchema(injuriesTable).omit({ id: true, createdAt: true });
export type InsertInjury = z.infer<typeof insertInjurySchema>;
export type Injury = typeof injuriesTable.$inferSelect;
