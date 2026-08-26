import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Permanent cache of API-Football `/teams?id=` lookups, keyed by team id.
 *
 * `isNational` is API-Football's authoritative `team.national` boolean — the
 * discriminator used to gate senior/youth national-team cap detection
 * (see `evaluateEligibility.ts` / `teamNationalityCache.ts`). A club never
 * becomes a national team and vice versa, so once a row exists here it is
 * never re-fetched — this costs at most one API-Football call per unique
 * team, ever.
 */
export const apiFootballTeamsTable = pgTable("api_football_teams", {
  apiFootballTeamId: integer("api_football_team_id").primaryKey(),
  name: text("name").notNull(),
  country: text("country"),
  isNational: boolean("is_national").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ApiFootballTeam = typeof apiFootballTeamsTable.$inferSelect;
