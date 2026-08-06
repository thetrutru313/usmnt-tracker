ALTER TABLE "players" ADD COLUMN "club_override_id" integer;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "club_override_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_club_override_id_clubs_id_fk" FOREIGN KEY ("club_override_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;
