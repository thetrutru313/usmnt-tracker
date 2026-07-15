import { date, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
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

/**
 * Full USMNT schedule — replaces the hardcoded src/data/schedule.ts.
 * Admin-only CRUD endpoints manage rows; the frontend reads via GET /api/schedule.
 */
export const scheduleEventsTable = pgTable("schedule_events", {
  id: serial("id").primaryKey(),
  /** Stable slug used as the external identifier (e.g. "friendlies-sept-2026"). */
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  /** One of: friendly | nations-league | gold-cup | copa-america | world-cup-qualifying | world-cup */
  kind: text("kind").notNull(),
  /** One of: confirmed | approximate | tbd */
  status: text("status").notNull(),
  /** ISO YYYY-MM-DD, nullable for TBD/approximate events with no confirmed date. */
  startDate: date("start_date", { mode: "string" }),
  endDate: date("end_date", { mode: "string" }),
  /** Human-readable date label, e.g. "Sept 4–9, 2026" or "Summer 2027". */
  dateLabel: text("date_label").notNull(),
  description: text("description").notNull(),
  /** Explicit ordering index; lower values appear first. */
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertScheduleEventSchema = createInsertSchema(scheduleEventsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertScheduleEvent = z.infer<typeof insertScheduleEventSchema>;
export type ScheduleEvent = typeof scheduleEventsTable.$inferSelect;
