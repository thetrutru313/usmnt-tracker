import { date, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const leagueSeasonsTable = pgTable("league_seasons", {
  id: serial("id").primaryKey(),
  apiFootballLeagueId: integer("api_football_league_id").notNull(),
  leagueName: text("league_name").notNull(),
  apiSeason: integer("api_season").notNull(),
  displayLabel: text("display_label").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("league_seasons_league_start_unique").on(table.apiFootballLeagueId, table.startDate),
]);

export const insertLeagueSeasonSchema = createInsertSchema(leagueSeasonsTable).omit({ id: true, createdAt: true });
export type InsertLeagueSeason = z.infer<typeof insertLeagueSeasonSchema>;
export type LeagueSeasonRow = typeof leagueSeasonsTable.$inferSelect;
