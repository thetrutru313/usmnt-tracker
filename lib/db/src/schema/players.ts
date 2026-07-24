import { date, integer, pgTable, serial, text, timestamp, doublePrecision, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clubsTable } from "./clubs";

export const playersTable = pgTable("players", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  position: text("position").notNull(),
  category: text("category").notNull(), // current | fringe | prospect
  clubId: integer("club_id").notNull().references(() => clubsTable.id),
  // Cached API-Football player id (resolved once via player search, then
  // reused) — lets the club sync look up transfer history without
  // re-searching by name every run. Null until the sync has resolved it.
  apiFootballPlayerId: integer("api_football_player_id"),
  // Cached English Wikipedia article title (e.g. "Tyler Adams"), resolved
  // once via search and reused so the national-team caps/goals sync doesn't
  // re-search by name every run. Null until that sync has resolved it (or
  // gave up — ambiguous or no match). See nationalTeamSync.ts for why
  // Wikipedia's infobox wikitext is used instead of Wikidata's structured
  // claims (the latter are frequently missing the caps/goals qualifier even
  // when the "member of" claim itself exists).
  wikipediaTitle: text("wikipedia_title"),
  photoUrl: text("photo_url"),
  age: integer("age").notNull(),
  dateOfBirth: text("date_of_birth"),
  contractUntil: date("contract_until", { mode: "string" }),
  marketValueUsd: doublePrecision("market_value_usd"),
  nationalTeamCaps: integer("national_team_caps").notNull().default(0),
  nationalTeamGoals: integer("national_team_goals").notNull().default(0),
  // Whether this player was named to the USA's 2026 World Cup 26-man roster.
  // Distinct from `category`: a player can be category "current" (an
  // established senior international) without having made this roster.
  worldCupRoster: boolean("world_cup_roster").notNull().default(false),
  youthNationalTeam: text("youth_national_team"),
  debutDate: date("debut_date", { mode: "string" }),
  potentialCallUpScore: integer("potential_call_up_score"),
  performanceTrend: text("performance_trend").notNull().default("steady"), // rising | steady | falling
  trending: boolean("trending").notNull().default(false),
  bio: text("bio").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Cached timestamp of the last successful /players/squads API call for this
  // player.  The hourly fixture sync skips the API call when this is within
  // SQUAD_CACHE_TTL_MS (6 hours), dramatically cutting daily quota usage.
  // Null means never checked; the sync will always call the API for those.
  squadLastCheckedAt: timestamp("squad_last_checked_at", { withTimezone: true }),
});

export const insertPlayerSchema = createInsertSchema(playersTable).omit({ id: true, createdAt: true });
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;
export type Player = typeof playersTable.$inferSelect;
