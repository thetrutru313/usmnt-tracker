import { doublePrecision, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { playersTable } from "./players";

// One row per player per (season, periodType). periodType: "season" | "last5" | "previous_season"
export const playerStatsTable = pgTable("player_stats", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => playersTable.id),
  periodType: text("period_type").notNull(),
  season: text("season").notNull(),
  minutes: integer("minutes").notNull().default(0),
  starts: integer("starts").notNull().default(0),
  goals: integer("goals").notNull().default(0),
  assists: integer("assists").notNull().default(0),
  xg: doublePrecision("xg").notNull().default(0),
  xa: doublePrecision("xa").notNull().default(0),
  shots: integer("shots").notNull().default(0),
  keyPasses: integer("key_passes").notNull().default(0),
  passCompletionPct: doublePrecision("pass_completion_pct").notNull().default(0),
  progressivePasses: integer("progressive_passes").notNull().default(0),
  progressiveCarries: integer("progressive_carries").notNull().default(0),
  tackles: integer("tackles").notNull().default(0),
  interceptions: integer("interceptions").notNull().default(0),
  duelsWonPct: doublePrecision("duels_won_pct").notNull().default(0),
  cleanSheets: integer("clean_sheets").notNull().default(0),
  savePct: doublePrecision("save_pct"),
  avgRating: doublePrecision("avg_rating").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPlayerStatsSchema = createInsertSchema(playerStatsTable).omit({ id: true, createdAt: true });
export type InsertPlayerStats = z.infer<typeof insertPlayerStatsSchema>;
export type PlayerStatsRow = typeof playerStatsTable.$inferSelect;

export const matchLogsTable = pgTable("match_logs", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => playersTable.id),
  date: text("date").notNull(),
  opponent: text("opponent").notNull(),
  competition: text("competition").notNull(),
  result: text("result").notNull(),
  minutes: integer("minutes").notNull().default(0),
  goals: integer("goals").notNull().default(0),
  assists: integer("assists").notNull().default(0),
  rating: doublePrecision("rating").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMatchLogSchema = createInsertSchema(matchLogsTable).omit({ id: true, createdAt: true });
export type InsertMatchLog = z.infer<typeof insertMatchLogSchema>;
export type MatchLogRow = typeof matchLogsTable.$inferSelect;
