CREATE INDEX "players_club_id_idx" ON "players" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "player_stats_player_id_idx" ON "player_stats" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "fixtures_kickoff_idx" ON "fixtures" USING btree ("kickoff");--> statement-breakpoint
CREATE INDEX "news_article_players_article_id_idx" ON "news_article_players" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "news_article_players_player_id_idx" ON "news_article_players" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "injuries_player_id_idx" ON "injuries" USING btree ("player_id");