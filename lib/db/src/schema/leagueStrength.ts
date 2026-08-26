import { integer, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * League strength coefficients used by the prospect quality score
 * (`src/lib/qualityScore.ts` in the api-server). Keyed on API-Football's
 * numeric `league.id` — never on the league name string, since a single
 * league is inconsistently named across the codebase's other tables (e.g.
 * `clubs.league` holds both "MLS" and "Major League Soccer" for the same
 * league).
 *
 * Seeded on server startup from `leagueStrengthDefaults.ts`, but only for
 * ids not already present (insert-if-missing, never upsert) — a hand-tuned
 * coefficient must survive a restart.
 */
export const leagueStrengthTable = pgTable("league_strength", {
  apiFootballLeagueId: integer("api_football_league_id").primaryKey(),
  name: text("name").notNull(),
  coefficient: numeric("coefficient", { precision: 4, scale: 2 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LeagueStrength = typeof leagueStrengthTable.$inferSelect;
