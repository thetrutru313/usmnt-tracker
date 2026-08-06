import { boolean, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clubsTable } from "./clubs";

export const fixturesTable = pgTable("fixtures", {
  id: serial("id").primaryKey(),
  // API-Football fixture id, when this row came from the live sync — lets the
  // sync upsert instead of duplicating on every run. Null for seeded rows.
  apiFootballFixtureId: integer("api_football_fixture_id").unique(),
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
  // Elapsed minutes into the match as reported by the live feed. Only
  // meaningful when status = "live"; null for all other statuses.
  elapsedMinute: integer("elapsed_minute"),
  tvNetwork: text("tv_network"),
  streamingService: text("streaming_service"),
  broadcastLink: text("broadcast_link"),
  // City/state display string for venue location, e.g. "Orlando, FL".
  // Populated for seeded NT fixtures; null for club fixtures synced from API-Football.
  city: text("city"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
},
(table) => [
  index("fixtures_kickoff_idx").on(table.kickoff),
]);

export const insertFixtureSchema = createInsertSchema(fixturesTable).omit({ id: true, createdAt: true });
export type InsertFixture = z.infer<typeof insertFixtureSchema>;
export type Fixture = typeof fixturesTable.$inferSelect;

// Join table: which tracked players are featured in a fixture
export const fixturePlayersTable = pgTable("fixture_players", {
  id: serial("id").primaryKey(),
  fixtureId: integer("fixture_id").notNull().references(() => fixturesTable.id),
  playerId: integer("player_id").notNull(),
  // Snapshot of which club this link was created for (set by the club
  // fixtures sync; null for curated/seeded national-team links). Lets reads
  // compare against the player's *current* club — if they've since
  // transferred away, an upcoming fixture for their old club should stop
  // showing them, while a fixture that's already been played should still
  // reflect who was actually featured at the time.
  clubId: integer("club_id").references(() => clubsTable.id),
},
(table) => [
  index("fixture_players_fixture_id_idx").on(table.fixtureId),
  index("fixture_players_player_id_idx").on(table.playerId),
],
);

export const insertFixturePlayerSchema = createInsertSchema(fixturePlayersTable).omit({ id: true });
export type InsertFixturePlayer = z.infer<typeof insertFixturePlayerSchema>;
export type FixturePlayer = typeof fixturePlayersTable.$inferSelect;
