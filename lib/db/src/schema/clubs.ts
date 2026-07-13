import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const clubsTable = pgTable("clubs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  league: text("league").notNull(),
  country: text("country").notNull(),
  logoUrl: text("logo_url"),
  // Cached Sportmonks team id (resolved once via team search, then reused) —
  // null until the live fixtures sync has looked this club up. Unused while
  // the Sportmonks sync is disabled (see replit.md), kept for a future switch back.
  sportmonksTeamId: integer("sportmonks_team_id"),
  // Cached API-Football team id, same idea as above but for the active provider.
  apiFootballTeamId: integer("api_football_team_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertClubSchema = createInsertSchema(clubsTable).omit({ id: true, createdAt: true });
export type InsertClub = z.infer<typeof insertClubSchema>;
export type Club = typeof clubsTable.$inferSelect;
