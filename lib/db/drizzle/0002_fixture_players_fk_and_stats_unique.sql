-- Task A step 1: remove orphaned fixture_players rows before adding the FK.
-- Written generically (no hardcoded player_id) so it is correct in both dev
-- and production regardless of which players have been deleted there.
DELETE FROM "fixture_players" fp
WHERE NOT EXISTS (SELECT 1 FROM "players" p WHERE p.id = fp.player_id);
--> statement-breakpoint
-- Task A step 2: add the FK now that orphans are gone.
ALTER TABLE "fixture_players" ADD CONSTRAINT "fixture_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "player_stats_player_period_season_unique" ON "player_stats" USING btree ("player_id","period_type","season");--> statement-breakpoint
CREATE UNIQUE INDEX "player_stats_single_row_period_unique" ON "player_stats" USING btree ("player_id","period_type") WHERE "player_stats"."period_type" IN ('season','previous_season','last5','previous5');