import { date, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Singleton-ish table: we keep only future windows and pick the earliest upcoming one.
export const nationalTeamWindowsTable = pgTable("national_team_windows", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNationalTeamWindowSchema = createInsertSchema(nationalTeamWindowsTable).omit({ id: true, createdAt: true });
export type InsertNationalTeamWindow = z.infer<typeof insertNationalTeamWindowSchema>;
export type NationalTeamWindow = typeof nationalTeamWindowsTable.$inferSelect;
