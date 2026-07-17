import { boolean, doublePrecision, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { playersTable } from "./players";

// One row per player per (season, periodType). periodType: "season" | "last5" |
// "previous_season" | "season_all" (one row per historical season year, used
// to power a club-season selector — see playerStatsSync.ts) |
// "national_team_cycle" (one row per World Cup cycle, e.g. "2026 World Cup",
// aggregated from this player's synced USMNT match logs for that cycle — see
// usmntSync.ts; the `season` column holds the cycle label here).
//
// All fields here are sourced from API-Football's live sync (see
// playerStatsSync.ts) — nothing is fabricated. API-Football does not report
// advanced metrics like xG/xA/progressive passes/carries (those require a
// provider like Opta/StatsBomb), so those columns were removed rather than
// left permanently at a fake 0. Percentage/rating fields are nullable
// because API-Football sometimes has no data for them (e.g. a player with no
// recorded duels this period) — null means "no data", not zero.
export const playerStatsTable = pgTable("player_stats", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => playersTable.id),
  periodType: text("period_type").notNull(),
  season: text("season").notNull(),
  minutes: integer("minutes").notNull().default(0),
  starts: integer("starts").notNull().default(0),
  goals: integer("goals").notNull().default(0),
  assists: integer("assists").notNull().default(0),
  shots: integer("shots").notNull().default(0),
  keyPasses: integer("key_passes").notNull().default(0),
  passCompletionPct: doublePrecision("pass_completion_pct"),
  tackles: integer("tackles").notNull().default(0),
  interceptions: integer("interceptions").notNull().default(0),
  duelsWonPct: doublePrecision("duels_won_pct"),
  // Nullable: API-Football's season-summary endpoint doesn't report clean
  // sheets directly — it's only derivable from real per-match data, which we
  // only have for the "last5" period (backed by synced match logs). Season
  // and previous-season rows leave this null rather than a fabricated 0.
  cleanSheets: integer("clean_sheets"),
  savePct: doublePrecision("save_pct"),
  avgRating: doublePrecision("avg_rating"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPlayerStatsSchema = createInsertSchema(playerStatsTable).omit({ id: true, createdAt: true });
export type InsertPlayerStats = z.infer<typeof insertPlayerStatsSchema>;
export type PlayerStatsRow = typeof playerStatsTable.$inferSelect;

export const matchLogsTable = pgTable("match_logs", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => playersTable.id),
  // API-Football fixture id this row came from. For national-team rows this is
  // part of the dedup key (see partial unique index below); club rows still use
  // delete-and-reinsert so no uniqueness constraint is applied to them.
  apiFootballFixtureId: integer("api_football_fixture_id"),
  date: text("date").notNull(),
  opponent: text("opponent").notNull(),
  competition: text("competition").notNull(),
  result: text("result").notNull(),
  minutes: integer("minutes").notNull().default(0),
  goals: integer("goals").notNull().default(0),
  assists: integer("assists").notNull().default(0),
  // Goals conceded by the player's team in this match, when derivable from
  // the fixture's final score — used to compute real clean-sheet counts.
  // Null when not available.
  conceded: integer("conceded"),
  // Nullable: API-Football sometimes has no rating for a very brief cameo.
  rating: doublePrecision("rating"),
  // True for a USMNT national-team appearance (World Cup qualifiers, Nations
  // League, friendlies), false for a club match. Lets one merged, date-sorted
  // match history distinguish which crest/context each row belongs to
  // without guessing from the competition name text.
  isNationalTeam: boolean("is_national_team").notNull().default(false),
  // World Cup cycle this match belongs to (e.g. "2026 World Cup"), derived
  // from the match date — see usmntSync.ts. Null for club matches, where the
  // concept doesn't apply.
  cycle: text("cycle"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
},
(table) => [
  // Prevents a player+fixture pair from being inserted twice for national-team
  // rows (e.g. if two sync timers fire simultaneously, or a run is retried
  // after partial completion). A partial index on non-NULL fixture ids keeps
  // club rows (which use delete-and-reinsert) unaffected — they never supply
  // an api_football_fixture_id that could collide here.
  uniqueIndex("match_logs_player_nt_fixture_unique")
    .on(table.playerId, table.apiFootballFixtureId)
    .where(sql`${table.apiFootballFixtureId} IS NOT NULL AND ${table.isNationalTeam} = true`),
  // Performance indexes for WHERE/JOIN clauses used on every fixtures request.
  index("match_logs_player_id_idx").on(table.playerId),
  index("match_logs_api_football_fixture_id_idx").on(table.apiFootballFixtureId),
],
);

export const insertMatchLogSchema = createInsertSchema(matchLogsTable).omit({ id: true, createdAt: true });
export type InsertMatchLog = z.infer<typeof insertMatchLogSchema>;
export type MatchLogRow = typeof matchLogsTable.$inferSelect;
