CREATE TABLE "api_football_teams" (
	"api_football_team_id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"is_national" boolean NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
