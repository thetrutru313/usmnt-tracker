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
  photoUrl: text("photo_url"),
  age: integer("age").notNull(),
  contractUntil: date("contract_until", { mode: "string" }),
  marketValueUsd: doublePrecision("market_value_usd"),
  nationalTeamCaps: integer("national_team_caps").notNull().default(0),
  nationalTeamGoals: integer("national_team_goals").notNull().default(0),
  youthNationalTeam: text("youth_national_team"),
  debutDate: date("debut_date", { mode: "string" }),
  potentialCallUpScore: integer("potential_call_up_score"),
  performanceTrend: text("performance_trend").notNull().default("steady"), // rising | steady | falling
  trending: boolean("trending").notNull().default(false),
  bio: text("bio").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPlayerSchema = createInsertSchema(playersTable).omit({ id: true, createdAt: true });
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;
export type Player = typeof playersTable.$inferSelect;
