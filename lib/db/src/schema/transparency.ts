import { integer, jsonb, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Monthly operating-expense, donation, and Goal Foundation record.
 * Each row represents one calendar month of transparency data that the
 * site owner logs manually from the admin panel.
 *
 * All monetary amounts are stored as integer cents to avoid floating-point
 * rounding issues (e.g. $12.50 → 1250).
 *
 * The (period_year, period_month) pair is unique — only one record per month.
 */
export const transparencyMonthsTable = pgTable("transparency_months", {
  id: serial("id").primaryKey(),
  periodYear: integer("period_year").notNull(),
  periodMonth: integer("period_month").notNull(), // 1–12
  expensesCents: integer("expenses_cents").notNull().default(0),
  donationsCents: integer("donations_cents").notNull().default(0),
  goalFoundationCents: integer("goal_foundation_cents").notNull().default(0),
  invoiceUrls: jsonb("invoice_urls").$type<{ label: string; url: string }[]>().notNull().default([]),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("transparency_months_year_month_unique").on(t.periodYear, t.periodMonth),
]);

export const insertTransparencyMonthSchema = createInsertSchema(transparencyMonthsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTransparencyMonth = z.infer<typeof insertTransparencyMonthSchema>;
export type TransparencyMonth = typeof transparencyMonthsTable.$inferSelect;
