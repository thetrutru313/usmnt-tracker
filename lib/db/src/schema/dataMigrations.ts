import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dataMigrationsTable = pgTable("data_migrations", {
  id: text("id").primaryKey(),
  description: text("description").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  durationMs: integer("duration_ms"),
});

export const insertDataMigrationSchema = createInsertSchema(dataMigrationsTable);
export type InsertDataMigration = z.infer<typeof insertDataMigrationSchema>;
export type DataMigrationRecord = typeof dataMigrationsTable.$inferSelect;
