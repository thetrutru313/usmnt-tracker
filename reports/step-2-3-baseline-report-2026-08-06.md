# Steps 2–3.5a — Baseline Migration Report — 2026-08-06

> Covers: Step 2a (archive), Step 2b (generate baseline), Step 2c (full
> scratch-vs-production comparison), Step 3 (record baseline in dev),
> Step 3.5a (Publish evidence). Stopped at Step 3.5b pending Publish.

---

## Step 2a — Archive

All 11 legacy `.sql` files, 5 snapshot JSONs, and `_journal.json` moved to
`lib/db/drizzle/_archive/`. Nothing deleted.

### Files moved to `lib/db/drizzle/_archive/`
```
0000_late_invaders.sql
0001_recovery_tokens_superseded_at.sql
0002_groovy_korath.sql
0003_players_eligibility_confidence.sql
0004_candidate_last_scored_at.sql
0005_candidate_first_name.sql
0006_candidate_duplicate_of_id.sql
0007_server_config.sql
0008_player_club_override.sql
0009_fixtures_city.sql
0010_add_missing_indexes.sql
```

### Files moved to `lib/db/drizzle/_archive/meta/`
```
0000_snapshot.json
0002_snapshot.json
0003_snapshot.json
0008_snapshot.json
0010_snapshot.json
_journal.json    ← the old journal, preserved as a record of what was believed applied
```

### State of `lib/db/drizzle/` after archive
```
lib/db/drizzle/
  _archive/
    *.sql  (11 files)
    meta/
      *.json  (6 files)
  meta/
    (empty — seeded with a fresh empty _journal.json next)
```

---

## Step 2b — Generate baseline

A fresh empty `_journal.json` was seeded into `lib/db/drizzle/meta/` so
drizzle-kit could initialize the folder, then:

```
cd lib/db && node_modules/.bin/drizzle-kit generate --name=baseline --config=./drizzle.config.ts
```

Output:
```
21 tables
clubs 7 columns 1 indexes 0 fks
players 29 columns 1 indexes 2 fks
match_logs 15 columns 3 indexes 1 fks
player_stats 18 columns 1 indexes 1 fks
fixture_players 4 columns 2 indexes 2 fks
fixtures 19 columns 1 indexes 0 fks
news_article_players 3 columns 2 indexes 1 fks
news_articles 11 columns 0 indexes 0 fks
injuries 10 columns 1 indexes 1 fks
transfers 11 columns 1 indexes 1 fks
national_team_windows 6 columns 0 indexes 0 fks
schedule_events 12 columns 0 indexes 0 fks
player_candidates 26 columns 0 indexes 1 fks
eligibility_signals 7 columns 1 indexes 1 fks
sync_metadata 2 columns 0 indexes 0 fks
transparency_months 10 columns 0 indexes 0 fks
anon_users 4 columns 0 indexes 0 fks
user_follows 4 columns 0 indexes 2 fks
recovery_tokens 6 columns 0 indexes 1 fks
player_status_history 7 columns 0 indexes 1 fks
server_config 3 columns 0 indexes 0 fks

[✓] Your SQL migration file ➜ drizzle/0000_baseline.sql 🚀
```

### Generated file: `lib/db/drizzle/0000_baseline.sql` (316 lines, 14,744 bytes)

```sql
CREATE TYPE "public"."player_usmnt_status" AS ENUM('US_ELIGIBLE_PROSPECT', 'DUAL_NATIONAL', 'CAP_TIED_OTHER', 'DECLARED_OTHER', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."usmnt_candidate_status" AS ENUM('US_ELIGIBLE_PROSPECT', 'DUAL_NATIONAL', 'DECLARED_OTHER', 'UNKNOWN');--> statement-breakpoint
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
	"squad_last_checked_at" timestamp with time zone,
	"usmnt_status" "player_usmnt_status",
	"eligibility_confidence" integer,
	"needs_review" boolean DEFAULT false NOT NULL,
	"club_override_id" integer,
	"club_override_set_at" timestamp with time zone,
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
	"city" text,
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
	"first_name" text,
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
	"last_scored_at" timestamp with time zone,
	"usmnt_status" "usmnt_candidate_status",
	"eligibility_confidence" integer,
	"secondary_nationalities" text[],
	"birthplace" text,
	"data_sources" text[],
	"needs_review" boolean DEFAULT false,
	"is_manual_override" boolean DEFAULT false,
	"status_notes" text,
	"duplicate_of_id" integer,
	CONSTRAINT "player_candidates_api_football_player_id_unique" UNIQUE("api_football_player_id")
);
--> statement-breakpoint
CREATE TABLE "eligibility_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"signal_type" text NOT NULL,
	"signal_value" text,
	"weight" integer,
	"source" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "anon_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anon_users_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "user_follows" (
	"id" serial PRIMARY KEY NOT NULL,
	"anon_user_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"followed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_follows_anon_user_player_unique" UNIQUE("anon_user_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "recovery_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"anon_user_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "recovery_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
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
CREATE TABLE "server_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_club_override_id_clubs_id_fk" FOREIGN KEY ("club_override_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_logs" ADD CONSTRAINT "match_logs_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_stats" ADD CONSTRAINT "player_stats_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture_players" ADD CONSTRAINT "fixture_players_fixture_id_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixture_players" ADD CONSTRAINT "fixture_players_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_article_players" ADD CONSTRAINT "news_article_players_article_id_news_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."news_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "injuries" ADD CONSTRAINT "injuries_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_candidates" ADD CONSTRAINT "player_candidates_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eligibility_signals" ADD CONSTRAINT "eligibility_signals_candidate_id_player_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."player_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_anon_user_id_anon_users_id_fk" FOREIGN KEY ("anon_user_id") REFERENCES "public"."anon_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_tokens" ADD CONSTRAINT "recovery_tokens_anon_user_id_anon_users_id_fk" FOREIGN KEY ("anon_user_id") REFERENCES "public"."anon_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_status_history" ADD CONSTRAINT "player_status_history_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clubs_api_football_team_id_unique" ON "clubs" USING btree ("api_football_team_id") WHERE "clubs"."api_football_team_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "players_club_id_idx" ON "players" USING btree ("club_id");--> statement-breakpoint
CREATE UNIQUE INDEX "match_logs_player_nt_fixture_unique" ON "match_logs" USING btree ("player_id","api_football_fixture_id") WHERE "match_logs"."api_football_fixture_id" IS NOT NULL AND "match_logs"."is_national_team" = true;--> statement-breakpoint
CREATE INDEX "match_logs_player_id_idx" ON "match_logs" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "match_logs_api_football_fixture_id_idx" ON "match_logs" USING btree ("api_football_fixture_id");--> statement-breakpoint
CREATE INDEX "player_stats_player_id_idx" ON "player_stats" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "fixture_players_fixture_id_idx" ON "fixture_players" USING btree ("fixture_id");--> statement-breakpoint
CREATE INDEX "fixture_players_player_id_idx" ON "fixture_players" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "fixtures_kickoff_idx" ON "fixtures" USING btree ("kickoff");--> statement-breakpoint
CREATE INDEX "news_article_players_article_id_idx" ON "news_article_players" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "news_article_players_player_id_idx" ON "news_article_players" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "injuries_player_id_idx" ON "injuries" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_player_announced_at_unique" ON "transfers" USING btree ("player_id","announced_at");--> statement-breakpoint
CREATE UNIQUE INDEX "eligibility_signals_candidate_type_source_idx" ON "eligibility_signals" USING btree ("candidate_id","signal_type","source");
```

---

## Step 2c — Full comparison: scratch vs production

Fresh `usmnt_scratch_baseline` database created, baseline applied (`exit: 0`),
then catalog-queried and compared against production.

### Tables — ✅ EXACT MATCH
All 21 tables present on both sides with identical names.

### Enum types — ✅ EXACT MATCH

| Enum | Values | Sort orders |
|---|---|---|
| `player_usmnt_status` | US_ELIGIBLE_PROSPECT, DUAL_NATIONAL, CAP_TIED_OTHER, DECLARED_OTHER, UNKNOWN | 1–5 on both |
| `usmnt_candidate_status` | US_ELIGIBLE_PROSPECT, DUAL_NATIONAL, DECLARED_OTHER, UNKNOWN | 1–4 on both |

### Foreign key constraints — ✅ EXACT MATCH
All 15 FK constraints: same names, same columns, same target tables,
ON DELETE NO ACTION / ON UPDATE NO ACTION on both sides.

| Table | Constraint | Column → Target |
|---|---|---|
| eligibility_signals | eligibility_signals_candidate_id_player_candidates_id_fk | candidate_id → player_candidates.id |
| fixture_players | fixture_players_club_id_clubs_id_fk | club_id → clubs.id |
| fixture_players | fixture_players_fixture_id_fixtures_id_fk | fixture_id → fixtures.id |
| injuries | injuries_player_id_players_id_fk | player_id → players.id |
| match_logs | match_logs_player_id_players_id_fk | player_id → players.id |
| news_article_players | news_article_players_article_id_news_articles_id_fk | article_id → news_articles.id |
| player_candidates | player_candidates_club_id_clubs_id_fk | club_id → clubs.id |
| player_stats | player_stats_player_id_players_id_fk | player_id → players.id |
| player_status_history | player_status_history_player_id_players_id_fk | player_id → players.id |
| players | players_club_id_clubs_id_fk | club_id → clubs.id |
| players | players_club_override_id_clubs_id_fk | club_override_id → clubs.id |
| recovery_tokens | recovery_tokens_anon_user_id_anon_users_id_fk | anon_user_id → anon_users.id |
| transfers | transfers_player_id_players_id_fk | player_id → players.id |
| user_follows | user_follows_anon_user_id_anon_users_id_fk | anon_user_id → anon_users.id |
| user_follows | user_follows_player_id_players_id_fk | player_id → players.id |

### Column names, types, nullability, defaults — ✅ FUNCTIONAL MATCH

Every column is present on both sides with identical name, data type,
nullability, and default value. Physical ordinal position (column order)
differs on 6 tables because production built those columns via
`ALTER TABLE ADD COLUMN` (appended at the end) while the baseline generates
them in schema-source order. Drizzle-orm references columns by name, so
this is cosmetic only.

| Table | Columns whose physical ordinal position differs |
|---|---|
| `clubs` | `api_football_team_id` (prod: 7, scratch: 6); `created_at` (prod: 6, scratch: 7) |
| `fixtures` | `api_football_fixture_id`, `elapsed_minute`, `city`, `created_at` |
| `match_logs` | `api_football_fixture_id`, `conceded`, `is_national_team`, `cycle`, `created_at` |
| `players` | `api_football_player_id`, `wikipedia_title`, `date_of_birth`, `squad_last_checked_at`, `world_cup_roster` and others |
| `player_candidates` | `first_name` (prod: 25, scratch: 2); `last_scored_at` (prod: 24, scratch: 17); `duplicate_of_id` (prod: 26, scratch: 13) |
| `transparency_months` | `invoice_urls` (prod: 10, scratch: 7); `notes`, `created_at`, `updated_at` shifted accordingly |

### Indexes — ⚠️ 6 INDEXES IN SCRATCH, ABSENT FROM PRODUCTION

All 37 production indexes are present in scratch and match exactly (same
names, same `indexdef`, same partial-index predicates). Scratch additionally
contains the 6 Step-1 indexes that do not yet exist in production:

| Index missing from production | Table |
|---|---|
| `players_club_id_idx` | players |
| `player_stats_player_id_idx` | player_stats |
| `fixtures_kickoff_idx` | fixtures |
| `news_article_players_article_id_idx` | news_article_players |
| `news_article_players_player_id_idx` | news_article_players |
| `injuries_player_id_idx` | injuries |

These are the Step-1 indexes. They exist in dev and in the baseline;
Step 3.5 routes them to production via Publish.

### Step 2c verdict

**PASS WITH ONE DOCUMENTED GAP.** The baseline faithfully represents the
production schema. The sole meaningful discrepancy is the 6 Step-1 indexes
absent from production — expected, pre-declared, routed to Step 3.5. Column
physical order differences are migration-history artifacts, not schema
mismatches. Scratch was dropped after comparison.

---

## Step 3 — Record baseline in dev

### Step 3a — DDL (from drizzle-orm source, `pg-core/dialect.js` lines 48–55)

```sql
CREATE SCHEMA IF NOT EXISTS "drizzle";

CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);
```

`created_at` stores the `when` field from `_journal.json` as a
millisecond-precision Unix integer — **not** a timestamp type.

Production's `drizzle.__drizzle_migrations` does not exist (confirmed via
`information_schema.tables` query). Dev has no `drizzle` schema prior to
this step.

### Step 3b — Hash derivation

**Source** (`drizzle-orm/migrator.js`):
```js
hash: crypto.createHash("sha256").update(query).digest("hex")
```
where `query` is `fs.readFileSync("<migration>.sql").toString()` — the full
UTF-8 content of the `.sql` file as a string, with no transformation.

**Applied to `lib/db/drizzle/0000_baseline.sql`:**
- File size: 14,744 bytes
- First 80 chars: `CREATE TYPE "public"."player_usmnt_status" AS ENUM('US_ELIGIBLE_PROSPECT', 'DUAL`
- Last 40 chars: `("candidate_id","signal_type","source");`
- Algorithm: `node -e "require('crypto').createHash('sha256').update(require('fs').readFileSync('lib/db/drizzle/0000_baseline.sql').toString()).digest('hex')"`

**Computed hash:**
```
51bb8f6f7b191fb7271933387c91c2e4cd6b4a9c0f3fdc3f741c51a3409cc2e3
```

This is not a guess. It was computed directly from the generated file using
Node.js crypto, the same code path drizzle-orm uses at runtime.

**`when` value from `lib/db/drizzle/meta/_journal.json`:** `1786047746767`

### Step 3c — INSERT (shown before running)

```sql
CREATE SCHEMA IF NOT EXISTS "drizzle";

CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);

INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")
VALUES (
  '51bb8f6f7b191fb7271933387c91c2e4cd6b4a9c0f3fdc3f741c51a3409cc2e3',
  1786047746767
);
```

### Step 3d — Result after running against dev

```
CREATE SCHEMA
CREATE TABLE
INSERT 0 1
Exit: 0
```

SELECT back:

```
 id |                               hash                               |  created_at   
----+------------------------------------------------------------------+---------------
  1 | 51bb8f6f7b191fb7271933387c91c2e4cd6b4a9c0f3fdc3f741c51a3409cc2e3 | 1786047746767
(1 row)
```

**Step 3 complete.** Dev now has `drizzle.__drizzle_migrations` with one row
recording the baseline. Production's `__drizzle_migrations` remains empty
(or absent) — intentional, documented as a constraint.

---

## Step 3.5a — Evidence for Replit Publish handling schema changes

From Replit's official documentation:

> *"Any schema changes (adding/deleting columns or tables) made to your
> development database using Agent are automatically applied to the
> production database when you publish."*

**What the docs confirm:**
- Column additions/removals: ✅ synced at Publish
- Table creation/deletion: ✅ synced at Publish

**What the docs do not confirm:**
- Index creation: not mentioned explicitly

The 6 Step-1 indexes were applied to dev via a raw `psql` command (not
through the Agent's schema-edit flow). Replit's diff mechanism may compare
`pg_indexes` catalog state (which would pick them up) or may track only
Agent-initiated changes. This is uncertain from documentation alone.

**Likely outcome:** If Replit's mechanism diffs catalog state between dev
and prod, the 6 indexes will carry over. If it tracks only Agent actions,
they may not.

---

## Step 3.5b — STOPPED. Waiting for Publish.

After you Publish, I will re-run the `pg_indexes` query against production
and report exactly how many of the 6 indexes are present. If any are
missing I will say so and not improvise a workaround (Step 3.5c).

---

## Current state of `lib/db/drizzle/`

```
lib/db/drizzle/
  _archive/
    0000_late_invaders.sql
    0001_recovery_tokens_superseded_at.sql
    0002_groovy_korath.sql
    0003_players_eligibility_confidence.sql
    0004_candidate_last_scored_at.sql
    0005_candidate_first_name.sql
    0006_candidate_duplicate_of_id.sql
    0007_server_config.sql
    0008_player_club_override.sql
    0009_fixtures_city.sql
    0010_add_missing_indexes.sql
    meta/
      0000_snapshot.json
      0002_snapshot.json
      0003_snapshot.json
      0008_snapshot.json
      0010_snapshot.json
      _journal.json  ← the old journal
  meta/
    _journal.json   ← new journal, one entry: 0000_baseline
    0000_snapshot.json
  0000_baseline.sql ← the single baseline migration
```

## State of dev `drizzle.__drizzle_migrations`

| id | hash | created_at |
|---|---|---|
| 1 | 51bb8f6f7b191fb7271933387c91c2e4cd6b4a9c0f3fdc3f741c51a3409cc2e3 | 1786047746767 |

## State of production `drizzle.__drizzle_migrations`

Table does not exist. Empty — `migrate` must NOT be pointed at production;
it would attempt to create all existing tables.
