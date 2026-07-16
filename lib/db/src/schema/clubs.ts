import { sql } from "drizzle-orm";
import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const clubsTable = pgTable(
  "clubs",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    league: text("league").notNull(),
    country: text("country").notNull(),
    logoUrl: text("logo_url"),
    // Cached API-Football team id — resolved once via team search then reused.
    apiFootballTeamId: integer("api_football_team_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Prevents the same real-world club from being tracked twice under two
    // different names (e.g. "Lyngby Boldklub" and "Lyngby" both resolving to
    // API-Football team id 625) — a nullable column, so a plain unique
    // constraint would only allow one NULL row; a partial index ignoring
    // NULLs still enforces uniqueness once a team id is actually resolved.
    uniqueIndex("clubs_api_football_team_id_unique").on(table.apiFootballTeamId).where(sql`${table.apiFootballTeamId} IS NOT NULL`),
  ],
);

export const insertClubSchema = createInsertSchema(clubsTable).omit({ id: true, createdAt: true });
export type InsertClub = z.infer<typeof insertClubSchema>;
export type Club = typeof clubsTable.$inferSelect;
