import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const fixturesTable = pgTable("fixtures", {
  id: serial("id").primaryKey(),
  isNationalTeam: boolean("is_national_team").notNull().default(false),
  competition: text("competition").notNull(),
  kickoff: timestamp("kickoff", { withTimezone: true }).notNull(),
  venue: text("venue").notNull(),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  homeLogoUrl: text("home_logo_url"),
  awayLogoUrl: text("away_logo_url"),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  status: text("status").notNull().default("scheduled"), // scheduled | live | finished | postponed
  tvNetwork: text("tv_network"),
  streamingService: text("streaming_service"),
  broadcastLink: text("broadcast_link"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFixtureSchema = createInsertSchema(fixturesTable).omit({ id: true, createdAt: true });
export type InsertFixture = z.infer<typeof insertFixtureSchema>;
export type Fixture = typeof fixturesTable.$inferSelect;

// Join table: which tracked players are featured in a fixture
export const fixturePlayersTable = pgTable("fixture_players", {
  id: serial("id").primaryKey(),
  fixtureId: integer("fixture_id").notNull().references(() => fixturesTable.id),
  playerId: integer("player_id").notNull(),
});

export const insertFixturePlayerSchema = createInsertSchema(fixturePlayersTable).omit({ id: true });
export type InsertFixturePlayer = z.infer<typeof insertFixturePlayerSchema>;
export type FixturePlayer = typeof fixturePlayersTable.$inferSelect;
