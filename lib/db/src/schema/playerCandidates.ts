import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { clubsTable } from "./clubs";

/**
 * Holds US-eligible squad members discovered at tracked clubs who are not
 * yet in the player pool. Populated by the automated discovery pass that
 * runs after each daily club sync. Nothing here is auto-promoted — an
 * operator must explicitly promote or dismiss each row.
 */
export const playerCandidatesTable = pgTable("player_candidates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  position: text("position"),
  age: integer("age"),
  clubId: integer("club_id")
    .notNull()
    .references(() => clubsTable.id),
  // Unique — a player can only appear once regardless of which club squad surfaced them.
  apiFootballPlayerId: integer("api_football_player_id").notNull().unique(),
  nationality: text("nationality"),
  birthCountry: text("birth_country"),
  currentSeasonStarts: integer("current_season_starts").notNull().default(0),
  currentSeasonMinutes: integer("current_season_minutes").notNull().default(0),
  currentSeasonRating: text("current_season_rating"),
  priorNationalTeamCaps: integer("prior_national_team_caps"),
  // "nationality" | "birth_country" | "dual_national_unconfirmed"
  eligibilityBasis: text("eligibility_basis").notNull(),
  // "pending" | "dismissed" | "promoted"
  status: text("status").notNull().default("pending"),
  discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlayerCandidate = typeof playerCandidatesTable.$inferSelect;
