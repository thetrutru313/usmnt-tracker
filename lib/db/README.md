# @workspace/db — Database package

This package owns the PostgreSQL schema (via Drizzle ORM) and the migration
history for the USMNT Tracker. Read this before touching anything in
`drizzle/` or `src/schema/`.

---

## How to add a migration

1. **Edit the schema** — change the relevant file in `src/schema/`.
2. **Generate the migration file:**
   ```sh
   cd lib/db
   node_modules/.bin/drizzle-kit generate --name=<short_description> --config=./drizzle.config.ts
   ```
   This writes a new `.sql` file and updates `meta/_journal.json` and
   `meta/<N>_snapshot.json`. Commit all three.
3. **Apply to dev:**
   ```sh
   node_modules/.bin/drizzle-kit migrate --config=./drizzle.config.ts
   ```
   (Uses `DATABASE_URL` from the environment — dev by default.)
4. **Commit and push.** The migration file executes only against dev.
   Production receives a **schema diff** — not the migration file itself.
   See "How production gets schema changes" below before relying on any data
   change (DELETE, UPDATE, backfill) reaching production via Publish.

**`push` must never be used against dev or production.** Bypassing migration
history is one reason; the deeper reason is that Replit's Publish flow diffs
DEV's live schema against production — if `push` alters dev's schema without a
corresponding migration file, the next Publish inherits dev's actual shape and
ships it to production, silently bypassing what the repository describes.
The `push` script in `package.json` exists only for emergency schema
exploration in a throwaway scratch database.

---

## How `drizzle-kit migrate` works

`migrate` reads `drizzle/meta/_journal.json` to discover ordered migration
files, computes a **SHA-256 hash of each file's raw content**, and inserts a
row into `drizzle.__drizzle_migrations` for each one it runs. On subsequent
calls it reads the last-applied hash and only runs files that come after it
in the journal.

This means:
- Migration files are **immutable** after they are applied. Editing a file
  after the fact will not cause `migrate` to re-run it — the hash is
  stored, not re-checked.
- Deleting or renaming a file the journal references will cause `migrate`
  to error on its next run.
- The journal order (`idx`) is the authoritative run order, not alphabetical
  file order.

---

## `drizzle/` directory layout

```
drizzle/
  0000_baseline.sql        ← Full schema baseline (2026-08-06 migration reset)
  0001_add_admin_sessions.sql
  0002_fixture_players_fk_and_stats_unique.sql
  0003_drop_player_dead_columns.sql
  meta/
    _journal.json          ← Ordered list of all migrations (four entries)
    0000_snapshot.json     ← Drizzle's internal schema snapshot
    0001_snapshot.json
    0002_snapshot.json
    0003_snapshot.json
  _archive/                ← HISTORICAL ONLY — must never be re-applied
    0000_late_invaders.sql
    0001_recovery_tokens_superseded_at.sql
    ... (11 files total)
    meta/
      _journal.json        ← Old journal, kept as a record
      *.json               ← Old snapshots
```

### Why the archive exists

The original 11 migration files were **structurally broken** in two ways:

1. **`0000_late_invaders.sql`** — the first migration never created three
   tables that exist in production and are defined in the schema:
   `anon_users`, `recovery_tokens`, and `user_follows`. Those tables were
   created directly via `drizzle-kit push` and were never in any `.sql`
   file. A fresh `drizzle-kit migrate` from the original files would have
   produced a database missing those three tables.

2. **`0010_add_missing_indexes.sql`** — contained a stray
   `ALTER TABLE "fixtures" ADD COLUMN "city" text;` on its first line,
   duplicating a column that `0009_fixtures_city.sql` already added.
   Applying it to a fresh database would have errored on the duplicate
   column.

Because of these two structural defects, the old files could not produce a
correct database from scratch. They were archived rather than patched so that
the history is preserved and auditable.

The single `0000_baseline.sql` was generated from `src/schema/` (the ground
truth) and verified against production via a full catalog comparison before
being recorded as the new baseline.

---

## Production database situation

> ⚠️ **Read this before pointing `migrate` at any database other than dev.**

### How production gets schema changes — the real model

> ⚠️ **This is the most important section in this file. Read it before writing
> any migration that contains DML.**

**Migration files execute only against dev.** `drizzle-kit migrate` with
`DATABASE_URL` pointing at dev is the only place they run.

**Production receives a schema diff.** Replit's Publish flow computes a diff
between the dev and production database schemas and generates DDL from it. It
does not open, parse, or execute the migration `.sql` files.

**DDL crosses over; DML does not.** `CREATE TABLE`, `ALTER TABLE`,
`CREATE INDEX`, `DROP COLUMN` — all of that is expressible as a schema diff
and will reach production. `DELETE`, `UPDATE`, `INSERT`, and any other data
manipulation written into a migration file will **silently never reach
production**, because a schema diff cannot express data changes.

**The production write path is the Replit database console.** The agent's
`executeSql` with `environment: "production"` is **read-only** — it rejects
any mutating statement with `cannot execute DELETE in a read-only transaction`.
The Replit database console (the database pane in the workspace UI, switched
to the production environment) accepts writes. That is the only mechanism for
applying data changes to production outside application code.

**A schema change that depends on a data change requires two steps:**

1. Apply the data change by hand in the Replit database console. Confirm it.
2. Publish the schema change. Because the data is already in the correct state,
   the DDL generated from the diff will succeed.

**Dev drifting from migration files means production inherits dev's shape,
not the repository's.** This is the deeper reason `drizzle-kit push` must
never run against dev — if `push` mutates dev's schema without a migration
file, the next Publish diff reads the mutated dev shape and ships it to
production, silently bypassing the migration history.

---

### Worked example — Prompt 12 (2026-08-08)

Migration `0002_fixture_players_fk_and_stats_unique.sql` contained:

1. A `DELETE FROM fixture_players WHERE NOT EXISTS (SELECT 1 FROM players …)` —
   to remove orphaned rows before adding the FK.
2. `ALTER TABLE "fixture_players" ADD CONSTRAINT … FOREIGN KEY ("player_id")
   REFERENCES "players"("id")` — the FK that required no orphans to exist.

The Publish dialog listed exactly five statements — the FK, two
`CREATE UNIQUE INDEX`, two `DROP COLUMN`. **The DELETE was absent.** A schema
diff cannot express DML, so it was never included.

Publish failed validation: production still held 8 orphaned `fixture_players`
rows (all referencing deleted `player_id` 23). The FK could not be applied.

**Resolution:**

1. The orphan DELETE was run by hand in the Replit database console against
   production. It deleted 8 rows.
2. The orphan count was re-confirmed as 0.
3. Publish was re-attempted and succeeded — the FK applied cleanly.

**Lesson:** any migration that mixes DML + dependent DDL needs the DML applied
by hand to production first, confirmed, then the schema publish follows.

---

### Current state (as of 2026-08-08)

| Database | `drizzle.__drizzle_migrations` | What `migrate` would do |
|---|---|---|
| **dev** | 4 rows — 0000 through 0003 recorded | ✅ Reports nothing pending, changes nothing |
| **production** | Table does not exist | ❌ Would try to CREATE all 21 existing tables — **DO NOT RUN** |

### Why production's `__drizzle_migrations` is empty

During the migration reset, the `executeSql` proxy (Replit's read-only
production query interface) rejected all DDL with:

```
ERROR: cannot execute CREATE INDEX in a read-only transaction
```

There is no Neon console access for this project's production database, and
the production container has no shell. It was not possible to insert the
baseline row into production's `drizzle` schema.

### How this resolves

One of two paths closes the gap:

1. **Migrate runs from inside the deploy step.** Add
   `drizzle-kit migrate` to the pre-deploy/build command in `artifact.toml`.
   On the next publish, migrate would run inside the production container
   (which has a writable connection), see no rows, insert the baseline row
   — and then do nothing, because the baseline represents the current schema.
   All future migrations would then flow through `migrate` instead of
   Replit's schema diff.

2. **Database moves to a host with a normal writable connection.**
   If the Neon instance is replaced or accessed via a direct connection
   (not Replit's proxy), the baseline INSERT can be run manually and `migrate`
   can take over for production from that point.

### Idempotency assessment (planning only — not implemented)

Making `0000_baseline.sql` safe to run against a database that already has
the schema would require:

- `CREATE TABLE IF NOT EXISTS` on all 21 table statements (~21 changes)
- `CREATE TYPE IF NOT EXISTS` on both enum types (~2 changes)
- `CREATE INDEX IF NOT EXISTS` / `CREATE UNIQUE INDEX IF NOT EXISTS` on all
  14 index statements (~14 changes)
- Wrapping each of the 15 `ALTER TABLE … ADD CONSTRAINT` FK statements in a
  `DO $$ BEGIN … EXCEPTION WHEN duplicate_object THEN NULL; END $$` block
  (~15 changes — the most error-prone part; PostgreSQL has no
  `ADD CONSTRAINT IF NOT EXISTS` syntax, so a PL/pgSQL exception handler is
  required for each)

**Rough size:** ~50 targeted edits across 316 lines. The FK wrappers are
mechanical but verbose and easy to typo. Risk is low if done carefully, but
testing against both an empty database and a fully-populated production
database is essential before relying on it. Not recommended until the
deploy-step path is available.

---

## Schema source of truth

`src/schema/` is the source of truth — not the migration files. If there is
ever a discrepancy between a migration file and the schema source, the schema
source wins and a new migration must be generated to reconcile.

All 21 tables are exported from `src/schema/index.ts`.
