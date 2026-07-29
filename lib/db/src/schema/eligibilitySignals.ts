import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { playerCandidatesTable } from "./playerCandidates";

/**
 * Records every signal that contributed to a candidate's eligibility
 * confidence score. One row per (candidate_id, signal_type, source) — there
 * is no FK to the main players table; signals belong to the discovery
 * pipeline only.  The unique index allows idempotent upserts on repeated runs.
 */
export const eligibilitySignalsTable = pgTable(
  "eligibility_signals",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => playerCandidatesTable.id),
    signalType: text("signal_type").notNull(),
    signalValue: text("signal_value"),
    weight: integer("weight"),
    source: text("source").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("eligibility_signals_candidate_type_source_idx").on(
      t.candidateId,
      t.signalType,
      t.source,
    ),
  ],
);

export type EligibilitySignal = typeof eligibilitySignalsTable.$inferSelect;
