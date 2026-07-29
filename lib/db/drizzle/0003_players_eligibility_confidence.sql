CREATE TYPE "public"."player_usmnt_status" AS ENUM('US_ELIGIBLE_PROSPECT', 'DUAL_NATIONAL', 'CAP_TIED_OTHER', 'DECLARED_OTHER', 'UNKNOWN');--> statement-breakpoint
CREATE TABLE "player_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"prev_status" text,
	"new_status" text NOT NULL,
	"reason" text NOT NULL,
	"changed_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eligibility_signals" ALTER COLUMN "signal_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "eligibility_signals" ALTER COLUMN "source" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "usmnt_status" "player_usmnt_status";--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "eligibility_confidence" integer;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "needs_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "player_status_history" ADD CONSTRAINT "player_status_history_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eligibility_signals_candidate_type_source_idx" ON "eligibility_signals" USING btree ("candidate_id","signal_type","source");