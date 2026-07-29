CREATE TYPE "public"."usmnt_candidate_status" AS ENUM('US_ELIGIBLE_PROSPECT', 'DUAL_NATIONAL', 'DECLARED_OTHER', 'UNKNOWN');--> statement-breakpoint
CREATE TABLE "eligibility_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"signal_type" text,
	"signal_value" text,
	"weight" integer,
	"source" text,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_candidates" ADD COLUMN "usmnt_status" "usmnt_candidate_status";--> statement-breakpoint
ALTER TABLE "player_candidates" ADD COLUMN "eligibility_confidence" integer;--> statement-breakpoint
ALTER TABLE "player_candidates" ADD COLUMN "secondary_nationalities" text[];--> statement-breakpoint
ALTER TABLE "player_candidates" ADD COLUMN "birthplace" text;--> statement-breakpoint
ALTER TABLE "player_candidates" ADD COLUMN "data_sources" text[];--> statement-breakpoint
ALTER TABLE "player_candidates" ADD COLUMN "needs_review" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "player_candidates" ADD COLUMN "is_manual_override" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "player_candidates" ADD COLUMN "status_notes" text;--> statement-breakpoint
ALTER TABLE "eligibility_signals" ADD CONSTRAINT "eligibility_signals_candidate_id_player_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."player_candidates"("id") ON DELETE no action ON UPDATE no action;
