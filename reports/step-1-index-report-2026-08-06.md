# Step 1 — Index Application Report — 2026-08-06

> Covers: CSV backup verification, Step 1a–d (fix + scratch + dev apply),
> and the Step 1e production blocker.

---

## CSV backup verification

### a. Row counts — all 21 tables match

| Table | Expected | Parsed | Status |
|---|---:|---:|---|
| anon_users | 96 | 96 | ✅ |
| clubs | 78 | 78 | ✅ |
| eligibility_signals | 0 | 0 | ✅ |
| fixture_players | 877 | 877 | ✅ |
| fixtures | 612 | 612 | ✅ |
| injuries | 124 | 124 | ✅ |
| match_logs | 1,175 | 1,175 | ✅ |
| national_team_windows | 2 | 2 | ✅ |
| news_article_players | 258 | 258 | ✅ |
| news_articles | 864 | 864 | ✅ |
| player_candidates | 131 | 131 | ✅ |
| player_stats | 416 | 416 | ✅ |
| player_status_history | 0 | 0 | ✅ |
| players | 76 | 76 | ✅ |
| recovery_tokens | 0 | 0 | ✅ |
| schedule_events | 9 | 9 | ✅ |
| server_config | 1 | 1 | ✅ |
| sync_metadata | 5 | 5 | ✅ |
| transfers | 25 | 25 | ✅ |
| transparency_months | 1 | 1 | ✅ |
| user_follows | 48 | 48 | ✅ |

All files parsed correctly with Python's `csv` module. Embedded commas and
multi-field rows caused no miscounts.

### b. news_articles spot-check — commas, apostrophes, newlines

328 of 864 rows contain a comma or apostrophe in the title or summary field.
All parsed correctly. Example parsed row:

```
title:   '' (empty — see NULL note below)
summary: 'Tyler Adams started for Bournemouth for the first time in three
          weeks, playing 75 minutes before being withdrawn as a precaution.
          He looked sharp in the tackle and controlled tempo from deep.'
```

Embedded newlines in summary: **0 rows.** All summaries are single-line in
the CSV output, so no multi-line quoting issues exist.

### c. NULL vs empty-string — limitation confirmed

The `executeSql` proxy outputs NULLs as empty unquoted CSV fields. Python's
`csv.reader` returns them as `''`. A genuinely empty text value is
indistinguishable from NULL in this format.

Evidence: `players.logo_url` (a nullable text column) shows 76 players all
with `''` — almost certainly NULLs rather than actual empty strings, but the
CSV cannot distinguish them. The same applies to any other nullable text or
integer column.

**This is a known limitation of the backup format, not a parsing failure.**
Any future restore must treat `''` in a nullable column as "NULL or empty"
and re-verify against the schema definition. A backup taken with
`COPY ... WITH (NULL '\N')` would avoid this ambiguity.

**Verdict: the CSV backup is parseable and usable for row recovery.**
The NULL ambiguity is documented and does not invalidate the backup.

---

## Step 1a — Fix `0010_add_missing_indexes.sql`

Removed line 1 of `lib/db/drizzle/0010_add_missing_indexes.sql`:

```sql
-- REMOVED:
ALTER TABLE "fixtures" ADD COLUMN "city" text;--> statement-breakpoint
```

File after fix (full content):

```sql
CREATE INDEX "players_club_id_idx" ON "players" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "player_stats_player_id_idx" ON "player_stats" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "fixtures_kickoff_idx" ON "fixtures" USING btree ("kickoff");--> statement-breakpoint
CREATE INDEX "news_article_players_article_id_idx" ON "news_article_players" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "news_article_players_player_id_idx" ON "news_article_players" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "injuries_player_id_idx" ON "injuries" USING btree ("player_id");
```

The `--> statement-breakpoint` markers begin with `--` and are treated as
SQL line comments by `psql`. The effective SQL is the six `CREATE INDEX`
statements only.

---

## Step 1b — Scratch database verification

- Fresh `usmnt_scratch` DB created on the dev helium instance.
- Full dev schema loaded via `pg_dump "$DATABASE_URL" --schema-only | psql "$SCRATCH_URL"` (dev and prod schemas are identical per the 4A diagnostic).
- 21 tables confirmed present.
- Fixed `0010` applied: exit 0, all six `CREATE INDEX` statements executed.
- Six indexes confirmed present in scratch:

```
fixtures_kickoff_idx                | fixtures
injuries_player_id_idx              | injuries
news_article_players_article_id_idx | news_article_players
news_article_players_player_id_idx  | news_article_players
player_stats_player_id_idx          | player_stats
players_club_id_idx                 | players
(6 rows)
```

Scratch dropped after verification.

---

## Step 1c — Exact SQL for production

```sql
CREATE INDEX "players_club_id_idx" ON "players" USING btree ("club_id");
CREATE INDEX "player_stats_player_id_idx" ON "player_stats" USING btree ("player_id");
CREATE INDEX "fixtures_kickoff_idx" ON "fixtures" USING btree ("kickoff");
CREATE INDEX "news_article_players_article_id_idx" ON "news_article_players" USING btree ("article_id");
CREATE INDEX "news_article_players_player_id_idx" ON "news_article_players" USING btree ("player_id");
CREATE INDEX "injuries_player_id_idx" ON "injuries" USING btree ("player_id");
```

Row counts at time of decision (all well under 100k — plain `CREATE INDEX`,
no `CONCURRENTLY` needed):

| Table | Rows |
|---|---:|
| players | 76 |
| player_stats | 416 |
| fixtures | 612 |
| news_article_players | 258 |
| injuries | 124 |

---

## Step 1d — Development: applied and verified

```
CREATE INDEX ×6   exit: 0
```

```
fixtures_kickoff_idx                | fixtures
injuries_player_id_idx              | injuries
news_article_players_article_id_idx | news_article_players
news_article_players_player_id_idx  | news_article_players
player_stats_player_id_idx          | player_stats
players_club_id_idx                 | players
(6 rows)
```

6 of 6 confirmed present in development. ✅

---

## Step 1e — Production: BLOCKED

```
ERROR: cannot execute CREATE INDEX in a read-only transaction
```

The `executeSql` proxy enforces read-only at the transaction level for the
`environment: "production"` path. `CREATE INDEX` is DDL and is rejected by
the platform regardless of the specific statement. This is not a permissions
issue — it is a hard constraint of Replit's production query proxy.

### Options to land the six indexes in production

| Option | Mechanism | Notes |
|---|---|---|
| **Next Publish** | Replit's Publish flow diffs dev → prod schema and applies changes. The six indexes are now in dev. | Standard path, zero extra risk. Requires a Publish action. |
| **Neon console** | Open the Neon dashboard for this project's production database, run the six `CREATE INDEX` statements directly. | Same SQL as Step 1c above. Low risk. Requires Neon dashboard access. |
| **Post-Step-3 `drizzle-kit migrate`** | Once the baseline is recorded (Step 3), `drizzle-kit migrate` can be wired into the deploy step (Step 5). Subsequent publishes apply migrations including the indexes. | Covered by Step 5. |

**The production database is not at risk from waiting.** The indexes are
additive performance improvements. No data or existing schema is affected by
their absence.

---

## Decision needed

Choose one before Step 1 can be marked complete:

1. Apply via Neon console now (SQL in Step 1c above), then confirm.
2. Defer to next Publish and proceed to Step 2 now.
3. Other.

Steps 2–5 do not depend on the production indexes being present and can
proceed in parallel with whichever production path is chosen.
