import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { playerCandidatesTable } from "./playerCandidates";

/**
 * Records every signal that contributed to a candidate's eligibility
 * confidence score. One row per signal per candidate — there is no FK
 * to the main players table; signals belong to the discovery pipeline only.
 */
export const eligibilitySignalsTable = pgTable("eligibility_signals", {
  id: serial("id").primaryKey(),
  candidateId: integer("candidate_id")
    .notNull()
    .references(() => playerCandidatesTable.id),
  signalType: text("signal_type"),
  signalValue: text("signal_value"),
  weight: integer("weight"),
  source: text("source"),
  detectedAt: timestamp("detected_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type EligibilitySignal = typeof eligibilitySignalsTable.$inferSelect;
