CREATE TABLE "clubs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"league" text NOT NULL,
	"country" text NOT NULL,
	"logo_url" text,
	"api_football_team_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"position" text NOT NULL,
	"category" text NOT NULL,
	"club_id" integer NOT NULL,
	"api_football_player_id" integer,
	"wikipedia_title" text,
	"photo_url" text,
	"age" integer NOT NULL,
	"date_of_birth" text,
	"contract_until" date,
	"market_value_usd" double precision,
	"national_team_caps" integer DEFAULT 0 NOT NULL,
	"national_team_goals" integer DEFAULT 0 NOT NULL,
	"world_cup_roster" boolean DEFAULT false NOT NULL,
	"youth_national_team" text,
	"debut_date" date,
	"potential_call_up_score" integer,
	"performance_trend" text DEFAULT 'steady' NOT NULL,
	"trending" boolean DEFAULT false NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "match_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"api_football_fixture_id" integer,
	"date" text NOT NULL,
	"opponent" text NOT NULL,
	"competition" text NOT NULL,
	"result" text NOT NULL,
	"minutes" integer DEFAULT 0 NOT NULL,
	"goals" integer DEFAULT 0 NOT NULL,
	"assists" integer DEFAULT 0 NOT NULL,
	"conceded" integer,
	"rating" double precision,
	"is_national_team" boolean DEFAULT false NOT NULL,
	"cycle" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"period_type" text NOT NULL,
	"season" text NOT NULL,
	"minutes" integer DEFAULT 0 NOT NULL,
	"starts" integer DEFAULT 0 NOT NULL,
	"goals" integer DEFAULT 0 NOT NULL,
	"assists" integer DEFAULT 0 NOT NULL,
	"shots" integer DEFAULT 0 NOT NULL,
	"key_passes" integer DEFAULT 0 NOT NULL,
	"pass_completion_pct" double precision,
	"tackles" integer DEFAULT 0 NOT NULL,
	"interceptions" integer DEFAULT 0 NOT NULL,
	"duels_won_pct" double precision,
	"clean_sheets" integer,
	"save_pct" double precision,
	"avg_rating" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixture_players" (
	"id" serial PRIMARY KEY NOT NULL,
	"fixture_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"club_id" integer
);
--> statement-breakpoint
CREATE TABLE "fixtures" (
	"id" serial PRIMARY KEY NOT NULL,
	"api_football_fixture_id" integer,
	"is_national_team" boolean DEFAULT false NOT NULL,
	"competition" text NOT NULL,
	"kickoff" timestamp with time zone NOT NULL,
	"venue" text NOT NULL,
	"home_team" text NOT NULL,
	"away_team" text NOT NULL,
	"home_logo_url" text,
	"away_logo_url" text,
	"home_score" integer,
	"away_score" integer,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"elapsed_minute" integer,
	"tv_network" text,
	"streaming_service" text,
	"broadcast_link" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fixtures_api_football_fixture_id_unique" UNIQUE("api_football_fixture_id")
);
--> statement-breakpoint
CREATE TABLE "news_article_players" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" integer NOT NULL,
	"player_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"headline" text NOT NULL,
	"source" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"category" text NOT NULL,
	"url" text NOT NULL,
	"summary" text NOT NULL,
	"why_it_matters" text NOT NULL,
	"impact_score" integer DEFAULT 5 NOT NULL,
	"sentiment" text DEFAULT 'neutral' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "injuries" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"body_part" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expected_return" date,
	"days_missed" integer DEFAULT 0 NOT NULL,
	"matches_missed" integer DEFAULT 0 NOT NULL,
	"latest_update" text NOT NULL,
	"start_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"from_club" text NOT NULL,
	"to_club" text NOT NULL,
	"transfer_type" text DEFAULT 'transfer' NOT NULL,
	"fee" text,
	"status" text DEFAULT 'rumor' NOT NULL,
	"probability_score" integer,
	"announced_at" timestamp with time zone NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "national_team_windows" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"start_date" date,
	"end_date" date,
	"date_label" text NOT NULL,
	"description" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_events_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "player_candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"position" text,
	"age" integer,
	"club_id" integer NOT NULL,
	"api_football_player_id" integer NOT NULL,
	"nationality" text,
	"birth_country" text,
	"current_season_starts" integer DEFAULT 0 NOT NULL,
	"current_season_minutes" integer DEFAULT 0 NOT NULL,
	"current_season_rating" text,
	"prior_national_team_caps" integer,
	"eligibility_basis" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_candidates_api_football_player_id_unique" UNIQUE("api_football_player_id")
);
--> statement-breakpoint
CREATE TABLE "sync_metadata" (
	"sync_name" text PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transparency_months" (
	"id" serial PRIMARY KEY NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"expenses_cents" integer DEFAULT 0 NOT NULL,
	"donations_cents" integer DEFAULT 0 NOT NULL,
	"goal_foundation_cents" integer DEFAULT 0 NOT NULL,
	"invoice_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transparency_months_year_month_unique" UNIQUE("period_year","period_month")
);
--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_logs" ADD CONSTRAINT "match_logs_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_stats" ADD CONSTRAINT "player_stats_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture_players" ADD CONSTRAINT "fixture_players_fixture_id_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture_players" ADD CONSTRAINT "fixture_players_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_article_players" ADD CONSTRAINT "news_article_players_article_id_news_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."news_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "injuries" ADD CONSTRAINT "injuries_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_candidates" ADD CONSTRAINT "player_candidates_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clubs_api_football_team_id_unique" ON "clubs" USING btree ("api_football_team_id") WHERE "clubs"."api_football_team_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "match_logs_player_nt_fixture_unique" ON "match_logs" USING btree ("player_id","api_football_fixture_id") WHERE "match_logs"."api_football_fixture_id" IS NOT NULL AND "match_logs"."is_national_team" = true;--> statement-breakpoint
CREATE INDEX "match_logs_player_id_idx" ON "match_logs" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "match_logs_api_football_fixture_id_idx" ON "match_logs" USING btree ("api_football_fixture_id");--> statement-breakpoint
CREATE INDEX "fixture_players_fixture_id_idx" ON "fixture_players" USING btree ("fixture_id");--> statement-breakpoint
CREATE INDEX "fixture_players_player_id_idx" ON "fixture_players" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_player_announced_at_unique" ON "transfers" USING btree ("player_id","announced_at");