import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { clubsTable } from "./clubs";

/**
 * Status enum for USMNT eligibility candidate pipeline.
 * US_SENIOR and US_YOUTH live only on the main players table.
 */
export const usmntCandidateStatus = pgEnum("usmnt_candidate_status", [
  "US_ELIGIBLE_PROSPECT",
  "DUAL_NATIONAL",
  "DECLARED_OTHER",
  "UNKNOWN",
]);

/**
 * Holds US-eligible squad members discovered at tracked clubs who are not
 * yet in the player pool. Populated by the automated discovery pass that
 * runs after each daily club sync. Nothing here is auto-promoted — an
 * operator must explicitly promote or dismiss each row.
 */
export const playerCandidatesTable = pgTable("player_candidates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  /** Full first name from API-Football's `firstname` field (e.g. "Christian" for "C. Pulisic"). */
  firstName: text("first_name"),
  position: text("position"),
  /** Stale after discovery — never refreshed automatically. Prefer computing
   *  age from `dateOfBirth` wherever an age check happens; this column is
   *  kept only as a display fallback when `dateOfBirth` is absent. */
  age: integer("age"),
  /** ISO date string (e.g. "2003-04-12") from API-Football's `birth.date`.
   *  Populated on discovery insert/update and on every rescore so age can be
   *  computed live instead of relying on the frozen `age` snapshot. */
  dateOfBirth: text("date_of_birth"),
  clubId: integer("club_id")
    .notNull()
    .references(() => clubsTable.id),
  // Unique — a player can only appear once regardless of which club squad surfaced them.
  apiFootballPlayerId: integer("api_football_player_id").notNull().unique(),
  nationality: text("nationality"),
  birthCountry: text("birth_country"),
  currentSeasonStarts: integer("current_season_starts").notNull().default(0),
  currentSeasonMinutes: integer("current_season_minutes").notNull().default(0),
  currentSeasonRating: text("current_season_rating"),
  /** Senior-only national-team caps (any country). Youth-level appearances
   *  (U17/U20/U23/etc., any country) are tracked separately in
   *  `priorYouthNtCaps` — they must never be folded into this total. */
  priorNationalTeamCaps: integer("prior_national_team_caps"),
  /** Youth national-team caps (any country) — kept separate from
   *  `priorNationalTeamCaps` so a youth-only history is never mistaken for a
   *  senior commitment to another federation. */
  priorYouthNtCaps: integer("prior_youth_nt_caps"),
  // "nationality" | "birth_country" | "dual_national_unconfirmed"
  eligibilityBasis: text("eligibility_basis").notNull(),
  // "pending" | "dismissed" | "promoted"
  status: text("status").notNull().default("pending"),
  discoveredAt: timestamp("discovered_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastScoredAt: timestamp("last_scored_at", { withTimezone: true }),

  // --- Eligibility pipeline expansion ---
  usmntStatus: usmntCandidateStatus("usmnt_status"),
  eligibilityConfidence: integer("eligibility_confidence"),
  secondaryNationalities: text("secondary_nationalities").array(),
  birthplace: text("birthplace"),
  dataSources: text("data_sources").array(),
  needsReview: boolean("needs_review").default(false),
  isManualOverride: boolean("is_manual_override").default(false),
  statusNotes: text("status_notes"),
  /**
   * When non-null this candidate's slugified name collides with an existing
   * pending or promoted candidate.  Points to the earlier candidate's `id`.
   * Populated by the discovery pass; visible in the review queue as
   * "duplicate of candidate #<duplicateOfId>".
   */
  duplicateOfId: integer("duplicate_of_id"),
});

export type PlayerCandidate = typeof playerCandidatesTable.$inferSelect;
