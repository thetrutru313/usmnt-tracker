CREATE TABLE "league_strength" (
	"api_football_league_id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"coefficient" numeric(4, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_candidates" ADD COLUMN "quality_score" integer;--> statement-breakpoint
ALTER TABLE "player_candidates" ADD COLUMN "quality_scored_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "player_candidates" ADD COLUMN "quality_score_inputs" jsonb;