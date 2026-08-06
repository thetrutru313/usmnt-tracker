# Migration System Diagnostic — 2026-08-06

> **Read-only.** No files, schemas, or databases were modified during this
> diagnostic. The scratch database (`usmnt_scratch`) was created, used for
> testing, and dropped before this report was written.

---

## Section 0 — Access to both databases

### Development
| Item | Value |
|---|---|
| Variable | `DATABASE_URL` (injected into dev workspace shell) |
| Host | `helium` |
| Port | `5432` |
| Database | `heliumdb` |
| Shell access | ✅ `pg_dump`, `psql`, `createdb`, `dropdb` all work |

### Production
| Item | Value |
|---|---|
| Variable | **None available in dev shell.** No `PRODUCTION_DATABASE_URL`, no `NEON_*`, no `PG*` pointing elsewhere. The dev `$PGHOST` / `$PGUSER` point at `helium` (dev only). |
| Shell access | ❌ TCP to `169.254.254.254:5432` is **refused** from the dev shell. `pg_dump` cannot connect. |
| Query access | ✅ Via Replit's internal `executeSql({ environment: "production" })` proxy only. |

### Production hostname — reachability assessment

`inet_server_addr()` returns `169.254.254.254` from inside the Postgres server.
This is a **link-local, Replit-internal** address — it is **not** a public Neon
hostname. An external host (CI runner, local machine, disaster-recovery box)
**cannot connect** to production via this address. Every `pg_dump` of production
must be taken from inside Replit's infrastructure or directly via the Neon
console. The actual Neon endpoint is not visible from the dev workspace.

---

## Section 1 — Backups

| Database | Path | Size | Outcome |
|---|---|---|---|
| Development | `/tmp/backup-dev-2026-08-06.dump` | **329 KB** | ✅ Non-trivial |
| Production | — | — | ❌ **Not taken.** TCP to production proxy refused; `pg_dump` cannot connect from dev shell. |

`pg_dump` (PostgreSQL) 16.10 is present at
`/nix/store/bgwr5i8jf8jpg75rr53rz3fqv5k8yrwp-postgresql-16.10/bin/pg_dump`.
The tool works; the network path to production does not.

---

## Section 2 — Migration system inventory

### a. `ls -la lib/db/drizzle/*.sql`

```
-rw-r--r-- 1 runner runner  9941 Jul 17 23:54 lib/db/drizzle/0000_late_invaders.sql
-rw-r--r-- 1 runner runner    83 Jul 28 17:51 lib/db/drizzle/0001_recovery_tokens_superseded_at.sql
-rw-r--r-- 1 runner runner  1438 Jul 29 16:58 lib/db/drizzle/0002_groovy_korath.sql
-rw-r--r-- 1 runner runner  1317 Jul 29 18:51 lib/db/drizzle/0003_players_eligibility_confidence.sql
-rw-r--r-- 1 runner runner    62 Jul 29 20:02 lib/db/drizzle/0004_candidate_last_scored_at.sql
-rw-r--r-- 1 runner runner    70 Jul 29 20:23 lib/db/drizzle/0005_candidate_first_name.sql
-rw-r--r-- 1 runner runner   149 Jul 29 21:04 lib/db/drizzle/0006_candidate_duplicate_of_id.sql
-rw-r--r-- 1 runner runner   375 Jul 29 22:17 lib/db/drizzle/0007_server_config.sql
-rw-r--r-- 1 runner runner   375 Aug  3 22:10 lib/db/drizzle/0008_player_club_override.sql
-rw-r--r-- 1 runner runner    47 Aug  5 17:46 lib/db/drizzle/0009_fixtures_city.sql
-rw-r--r-- 1 runner runner   712 Aug  6 18:08 lib/db/drizzle/0010_add_missing_indexes.sql
```

### b. `cat lib/db/drizzle/meta/_journal.json`

```json
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    { "idx": 0, "version": "7", "when": 1784332198693, "tag": "0000_late_invaders",                  "breakpoints": true },
    { "idx": 1, "version": "7", "when": 1753660800000, "tag": "0001_recovery_tokens_superseded_at",  "breakpoints": true },
    { "idx": 2, "version": "7", "when": 1785343991409, "tag": "0002_groovy_korath",                  "breakpoints": true },
    { "idx": 3, "version": "7", "when": 1785350539627, "tag": "0003_players_eligibility_confidence", "breakpoints": true },
    { "idx": 4, "version": "7", "when": 1785794112473, "tag": "0008_player_club_override",           "breakpoints": true },
    { "idx": 5, "version": "7", "when": 1754352000000, "tag": "0009_fixtures_city",                  "breakpoints": true },
    { "idx": 6, "version": "7", "when": 1786038853036, "tag": "0010_add_missing_indexes",            "breakpoints": true }
  ]
}
```

### c. `ls -la lib/db/drizzle/meta/*.json`

```
-rw-r--r-- 1 runner runner 39718 Jul 17 23:54 lib/db/drizzle/meta/0000_snapshot.json
-rw-r--r-- 1 runner runner 48417 Jul 29 16:58 lib/db/drizzle/meta/0002_snapshot.json
-rw-r--r-- 1 runner runner 51838 Jul 29 18:51 lib/db/drizzle/meta/0003_snapshot.json
-rw-r--r-- 1 runner runner 53848 Aug  3 22:10 lib/db/drizzle/meta/0008_snapshot.json
-rw-r--r-- 1 runner runner 56474 Aug  6 18:08 lib/db/drizzle/meta/0010_snapshot.json
-rw-r--r-- 1 runner runner  1099 Aug  6 18:08 lib/db/drizzle/meta/_journal.json
```

### d. `SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at`

**Production:**
```
START TRANSACTION
ROLLBACK
```
Table and schema exist. **Zero rows.** `drizzle-kit migrate` has never
successfully recorded an applied migration in production.

**Development:**
```
ERROR:  relation "drizzle.__drizzle_migrations" does not exist
```
The `drizzle` schema does not exist in the dev database. `drizzle-kit migrate`
has never run there.

### Plain summary

| Metric | Count |
|---|---|
| `.sql` files on disk | **11** |
| Journal entries | **7** |
| Files on disk but absent from journal | **4** (`0004`, `0005`, `0006`, `0007`) |
| Migrations recorded as applied — production | **0** (table empty) |
| Migrations recorded as applied — development | **N/A** (table/schema absent) |

Files absent from the journal:
- `0004_candidate_last_scored_at.sql`
- `0005_candidate_first_name.sql`
- `0006_candidate_duplicate_of_id.sql`
- `0007_server_config.sql`

---

## Section 3 — Decisive test

### Scratch method

Option (b): `createdb usmnt_scratch` on the dev helium instance — exit 0.
Neon branch (option a) was not attempted: no Neon API credentials are available
in the dev workspace. `createdb` succeeded immediately.

### Migration apply — full output

```
--- lib/db/drizzle/0000_late_invaders.sql ---
CREATE TABLE ×15
ALTER TABLE ×9
CREATE INDEX ×7
exit: 0

--- lib/db/drizzle/0001_recovery_tokens_superseded_at.sql ---
psql:lib/db/drizzle/0001_recovery_tokens_superseded_at.sql:1:
  ERROR:  relation "recovery_tokens" does not exist
exit: 3

--- lib/db/drizzle/0002_groovy_korath.sql ---
CREATE TYPE
CREATE TABLE
ALTER TABLE ×9
exit: 0

--- lib/db/drizzle/0003_players_eligibility_confidence.sql ---
CREATE TYPE
CREATE TABLE
ALTER TABLE ×6
CREATE INDEX
exit: 0

--- lib/db/drizzle/0004_candidate_last_scored_at.sql ---
ALTER TABLE
exit: 0

--- lib/db/drizzle/0005_candidate_first_name.sql ---
ALTER TABLE
exit: 0

--- lib/db/drizzle/0006_candidate_duplicate_of_id.sql ---
ALTER TABLE
exit: 0

--- lib/db/drizzle/0007_server_config.sql ---
CREATE TABLE
exit: 0

--- lib/db/drizzle/0008_player_club_override.sql ---
ALTER TABLE ×3
exit: 0

--- lib/db/drizzle/0009_fixtures_city.sql ---
ALTER TABLE
exit: 0

--- lib/db/drizzle/0010_add_missing_indexes.sql ---
psql:lib/db/drizzle/0010_add_missing_indexes.sql:1:
  ERROR:  column "city" of relation "fixtures" already exists
exit: 3
```

Scratch result after apply: **18 tables, 31 indexes.**

### Schema comparison: scratch vs production

Production has **21 tables**. Scratch has **18**.

**Tables present in production but missing from scratch:**

| Table | Why missing |
|---|---|
| `anon_users` | Not created by any `.sql` migration file; built via `drizzle-kit push` |
| `recovery_tokens` | Same — and `0001` tries to ALTER it before any file creates it |
| `user_follows` | Not created by any `.sql` migration file; built via `drizzle-kit push` |

**Indexes present in production but missing from scratch** (consequence of missing tables):
- `anon_users_pkey`, `anon_users_token_hash_unique`
- `recovery_tokens_pkey`, `recovery_tokens_token_hash_unique`
- `user_follows_pkey`, `user_follows_anon_user_player_unique`

Additionally, the six indexes that `0010` was supposed to create also **did not
apply to scratch** — `0010` aborts on line 1 (`ADD COLUMN city` already exists
from `0009`), and `ON_ERROR_STOP=1` skips all remaining statements in the file.

### Root cause — `0001` failure

`0001_recovery_tokens_superseded_at.sql` contains one line:
```sql
ALTER TABLE "recovery_tokens" ADD COLUMN "superseded_at" timestamp with time zone;
```
`0000_late_invaders.sql` does not create `recovery_tokens`. That table was
created via push in 2025 (journal timestamp for `0001`: `1753660800000` =
2025-07-28). `0000` was regenerated in 2026 without including it. The files are
not sequentially consistent: `0001` modifies a table that no preceding migration
creates.

### Root cause — `0010` failure

`0010_add_missing_indexes.sql` (full content):
```sql
ALTER TABLE "fixtures" ADD COLUMN "city" text;--> statement-breakpoint
CREATE INDEX "players_club_id_idx" ON "players" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "player_stats_player_id_idx" ON "player_stats" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "fixtures_kickoff_idx" ON "fixtures" USING btree ("kickoff");--> statement-breakpoint
CREATE INDEX "news_article_players_article_id_idx" ON "news_article_players" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "news_article_players_player_id_idx" ON "news_article_players" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "injuries_player_id_idx" ON "injuries" USING btree ("player_id");
```

`0009_fixtures_city.sql` (full content):
```sql
ALTER TABLE "fixtures" ADD COLUMN "city" text;
```

The first line of `0010` is identical to all of `0009`. `0010` was generated by
drizzle-kit at a point when both the `city` column and the six new indexes were
pending in the Drizzle schema state, so it bundled both into one file. Since
`0009` was applied first, `0010` always fails on the duplicate column and all six
`CREATE INDEX` statements are unreachable.

### Verdict

**CASE B — the migration files do not reproduce production.**

Three tables are missing entirely from the migration history. Two files have
structural errors that prevent clean sequential apply.

---

## Section 4 — Production vs development schema diff

**Diff: none.**

All catalog queries run against both databases — tables, columns (name, type,
default, nullability), enums, foreign key constraints, and non-staged indexes —
returned identical results for production and development.

| Item | Production | Development |
|---|---|---|
| Tables | 21 | 21 — identical names |
| Enums | `player_usmnt_status` (5 values), `usmnt_candidate_status` (4 values) | Identical |
| Foreign keys | 15 | Identical |
| Non-staged indexes | See full list below | Identical |

The Replit Publish flow has kept the two schemas in sync. A single baseline
captures both.

### Full index list (common to both databases)

```
anon_users              anon_users_pkey
anon_users              anon_users_token_hash_unique
clubs                   clubs_api_football_team_id_unique
clubs                   clubs_pkey
eligibility_signals     eligibility_signals_candidate_type_source_idx
eligibility_signals     eligibility_signals_pkey
fixture_players         fixture_players_fixture_id_idx
fixture_players         fixture_players_pkey
fixture_players         fixture_players_player_id_idx
fixtures                fixtures_api_football_fixture_id_unique
fixtures                fixtures_pkey
injuries                injuries_pkey
match_logs              match_logs_api_football_fixture_id_idx
match_logs              match_logs_pkey
match_logs              match_logs_player_id_idx
match_logs              match_logs_player_nt_fixture_unique
national_team_windows   national_team_windows_pkey
news_article_players    news_article_players_pkey
news_articles           news_articles_pkey
player_candidates       player_candidates_api_football_player_id_unique
player_candidates       player_candidates_pkey
player_stats            player_stats_pkey
player_status_history   player_status_history_pkey
players                 players_pkey
players                 players_slug_unique
recovery_tokens         recovery_tokens_pkey
recovery_tokens         recovery_tokens_token_hash_unique
schedule_events         schedule_events_pkey
schedule_events         schedule_events_slug_unique
server_config           server_config_pkey
sync_metadata           sync_metadata_pkey
transfers               transfers_pkey
transfers               transfers_player_announced_at_unique
transparency_months     transparency_months_pkey
transparency_months     transparency_months_year_month_unique
user_follows            user_follows_anon_user_player_unique
user_follows            user_follows_pkey
```

---

## Section 5 — Six staged indexes

Query run against both databases:

```sql
SELECT indexname, tablename FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'player_stats_player_id_idx','injuries_player_id_idx',
    'fixtures_kickoff_idx','players_club_id_idx',
    'news_article_players_article_id_idx','news_article_players_player_id_idx'
  )
ORDER BY indexname;
```

| Index | Production | Development |
|---|---|---|
| `fixtures_kickoff_idx` | **absent** | **absent** |
| `injuries_player_id_idx` | **absent** | **absent** |
| `news_article_players_article_id_idx` | **absent** | **absent** |
| `news_article_players_player_id_idx` | **absent** | **absent** |
| `player_stats_player_id_idx` | **absent** | **absent** |
| `players_club_id_idx` | **absent** | **absent** |

None of the six indexes exist in either database. They will remain absent until
`0010` can apply cleanly — which requires fixing the duplicate `ADD COLUMN city`
on line 1 first.

---

## Scratch cleanup

```
dropdb usmnt_scratch   exit: 0
SELECT datname FROM pg_database WHERE datname = 'usmnt_scratch'   → 0 rows
```

Confirmed dropped.

---

## Summary

| Item | Finding |
|---|---|
| Dev DB access | Shell via `$DATABASE_URL` — host `helium`, db `heliumdb` |
| Prod DB access | `executeSql` proxy only — `pg_dump` impossible from dev shell |
| Production hostname | `169.254.254.254` — internal Replit link-local proxy; **not a public Neon host**; not reachable from outside Replit |
| Dev backup | `/tmp/backup-dev-2026-08-06.dump` — 329 KB ✅ |
| Prod backup | **Not taken** — TCP refused from dev shell |
| `.sql` files on disk | 11 |
| Journal entries | 7 |
| Missing from journal | `0004`, `0005`, `0006`, `0007` |
| Prod `__drizzle_migrations` | Exists, **0 rows** — migrate never run |
| Dev `__drizzle_migrations` | Schema/table **does not exist** — migrate never run |
| Scratch method | `createdb usmnt_scratch` (option b) — created and dropped |
| Migration apply verdict | **CASE B** — files do not reproduce production |
| Missing tables (vs prod) | `anon_users`, `recovery_tokens`, `user_follows` — not in any `.sql` file |
| `0001` failure | Alters `recovery_tokens` before any migration creates it |
| `0010` failure | Duplicate `ADD COLUMN city` from `0009` — all 6 `CREATE INDEX` statements skipped |
| Prod vs dev schema diff | **None** — schemas are identical |
| Six staged indexes in prod | **0 of 6 present** |
| Six staged indexes in dev | **0 of 6 present** |
