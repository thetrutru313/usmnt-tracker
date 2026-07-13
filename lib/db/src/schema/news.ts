import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const newsArticlesTable = pgTable("news_articles", {
  id: serial("id").primaryKey(),
  headline: text("headline").notNull(),
  source: text("source").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  category: text("category").notNull(),
  url: text("url").notNull(),
  summary: text("summary").notNull(),
  whyItMatters: text("why_it_matters").notNull(),
  impactScore: integer("impact_score").notNull().default(5),
  sentiment: text("sentiment").notNull().default("neutral"), // positive | neutral | negative
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNewsArticleSchema = createInsertSchema(newsArticlesTable).omit({ id: true, createdAt: true });
export type InsertNewsArticle = z.infer<typeof insertNewsArticleSchema>;
export type NewsArticle = typeof newsArticlesTable.$inferSelect;

export const newsArticlePlayersTable = pgTable("news_article_players", {
  id: serial("id").primaryKey(),
  articleId: integer("article_id").notNull().references(() => newsArticlesTable.id),
  playerId: integer("player_id").notNull(),
});

export const insertNewsArticlePlayerSchema = createInsertSchema(newsArticlePlayersTable).omit({ id: true });
export type InsertNewsArticlePlayer = z.infer<typeof insertNewsArticlePlayerSchema>;
export type NewsArticlePlayer = typeof newsArticlePlayersTable.$inferSelect;
