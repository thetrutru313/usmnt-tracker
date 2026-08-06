# Steps 3.5b–5 — Completion Report — 2026-08-06

> Covers: Step 3.5b (Publish index verification), Step 4 (migrate proof),
> Step 5 (documentation), and final verification suite.

---

## Step 3.5b — Publish index verification

All 6 Step-1 indexes confirmed present in production after Publish:

| Index | Table | Definition |
|---|---|---|
| `players_club_id_idx` | players | `CREATE INDEX … USING btree (club_id)` |
| `player_stats_player_id_idx` | player_stats | `CREATE INDEX … USING btree (player_id)` |
| `fixtures_kickoff_idx` | fixtures | `CREATE INDEX … USING btree (kickoff)` |
| `news_article_players_article_id_idx` | news_article_players | `CREATE INDEX … USING btree (article_id)` |
| `news_article_players_player_id_idx` | news_article_players | `CREATE INDEX … USING btree (player_id)` |
| `injuries_player_id_idx` | injuries | `CREATE INDEX … USING btree (player_id)` |

**6 of 6 present. Publish carried all indexes.** Step 3.5 complete.

---

## Step 4a — Fresh scratch DB from nothing matches production

Created `usmnt_scratch_step4` (empty database), ran:

```sh
DATABASE_URL="<scratch>" node_modules/.bin/drizzle-kit migrate --config=./drizzle.config.ts
```

Output:
```
Reading config file '/home/runner/workspace/lib/db/drizzle.config.ts'
Using 'pg' driver for database querying
[✓] migrations applied successfully!
```

Post-apply catalog comparison against production:

| Check | Result |
|---|---|
| Tables (21) | ✅ exact match |
| Enum types (2) and their values | ✅ exact match |
| Foreign key constraints (15) | ✅ exact match |
| Indexes (43, including all 6 Step-1 indexes) | ✅ exact match |
| `drizzle.__drizzle_migrations` | 1 row — hash `51bb8f6f…`, created_at `1786047746767` |

**The database can be rebuilt from the repo.** A fresh `drizzle-kit migrate`
from nothing produces a schema that matches production in every catalog-visible
dimension.

Scratch dropped after verification.

---

## Step 4b — Dev migrate reports nothing pending

Ran `drizzle-kit migrate` against the development database (default `DATABASE_URL`):

```
Reading config file '/home/runner/workspace/lib/db/drizzle.config.ts'
Using 'pg' driver for database querying
[✓] migrations applied successfully!
```

Dev `drizzle.__drizzle_migrations` after the run — **unchanged**:

```
 id |                               hash                               |  created_at   
----+------------------------------------------------------------------+---------------
  1 | 51bb8f6f7b191fb7271933387c91c2e4cd6b4a9c0f3fdc3f741c51a3409cc2e3 | 1786047746767
(1 row)
```

Step 3 was correct. No migration was applied. No schema change occurred.

---

## Step 4c — Throwaway migration round-trip

### Setup

Added a nullable column to `lib/db/src/schema/syncMetadata.ts`:

```ts
_testCol: text("_test_col"), // THROWAWAY
```

Generated the migration:

```sh
node_modules/.bin/drizzle-kit generate --name=throwaway_test --config=./drizzle.config.ts
# → drizzle/0001_throwaway_test.sql
```

Generated SQL:

```sql
ALTER TABLE "sync_metadata" ADD COLUMN "_test_col" text;
```

### Applied to scratch

```sh
DATABASE_URL="<scratch>" node_modules/.bin/drizzle-kit migrate --config=./drizzle.config.ts
# [✓] migrations applied successfully!
```

Scratch `sync_metadata` columns after apply:
```
sync_name | last_run_at | _test_col
```

Scratch `drizzle.__drizzle_migrations` after apply:
```
 id |         hash                                                     | created_at
----+------------------------------------------------------------------+---------------
  1 | 51bb8f6f7b191fb7271933387c91c2e4cd6b4a9c0f3fdc3f741c51a3409cc2e3 | 1786047746767
  2 | 35d5a72f550ce729861e84aa68b6f9202efa2c4c0c13cfd8e9e6838f1ab3a821 | 1786048418839
(2 rows)
```

### Revert

- Removed `_testCol` from `syncMetadata.ts`
- Deleted `lib/db/drizzle/0001_throwaway_test.sql`
- Deleted `lib/db/drizzle/meta/0001_snapshot.json`
- Reverted `lib/db/drizzle/meta/_journal.json` to baseline-only (1 entry)
- Dropped scratch database

Dev was never touched. Step 4c complete.

---

## Step 5 — Documentation

### Step 5a–d: `lib/db/README.md` created

Full content covers:

1. **How to add a migration** — step-by-step: edit schema → generate → apply to dev → commit → Publish carries it to production.
2. **Why `push` must never be used** — it bypasses `__drizzle_migrations` and leaves the migration history permanently out of sync with what's in the database.
3. **How `drizzle-kit migrate` works** — SHA-256 hash of each file's content, stored in `drizzle.__drizzle_migrations`, run-once guarantee.
4. **`drizzle/` directory layout** — with explanation of `_archive/`.
5. **Why the archive exists** — two structural defects in the original 11 files:
   - `0000_late_invaders.sql` never created `anon_users`, `recovery_tokens`, or `user_follows` — they were created via `push` and were never in any `.sql` file
   - `0010_add_missing_indexes.sql` contained a stray `ALTER TABLE "fixtures" ADD COLUMN "city" text;` duplicating a column from `0009_fixtures_city.sql`
6. **Production database situation** (prominently marked ⚠️):
   - Dev: 1 row — baseline recorded. `migrate` reports nothing pending. ✅
   - Production: `__drizzle_migrations` does not exist. `migrate` must NOT be run — it would try to CREATE all 21 existing tables.
   - Why: `executeSql` proxy is read-only; no Neon console; no shell in production container.
   - How production gets changes: Replit's Publish schema-diff flow.
   - Resolution path: run `drizzle-kit migrate` from inside the deploy step (where the container has a writable connection).
7. **Idempotency assessment (planning only)**:
   - ~50 targeted edits: `IF NOT EXISTS` on 21 tables, 2 enums, 14 indexes; PL/pgSQL exception-handler blocks on all 15 FK `ADD CONSTRAINT` statements (PostgreSQL has no `ADD CONSTRAINT IF NOT EXISTS`).
   - Mechanical but verbose; FK wrappers are the most error-prone part.
   - Not recommended until the deploy-step path is available.

### Step 5e: `replit.md` Run & Operate section updated

Added a "Database migrations" subsection covering:
- Quick-reference `generate` + `migrate` commands
- Warning that `migrate` must NOT be pointed at production
- Warning that `push` must never be used
- Pointer to `lib/db/README.md` for the full explanation

---

## Final verification

All commands run after completing Step 5:

| Check | Result |
|---|---|
| `pnpm run lint` | ✅ 0 errors (4 pre-existing warnings) |
| `pnpm run typecheck` | ✅ all packages clean |
| `pnpm run build` | ✅ |
| `pnpm --filter @workspace/api-server run test` | ✅ 84 files, 712 tests passed |
| `pnpm --filter @workspace/usmnt-tracker run test` | ✅ 11 files, 212 tests passed |

---

## Final state of `lib/db/drizzle/`

```
lib/db/drizzle/
  0000_baseline.sql          ← Single authoritative baseline (316 lines, 14,744 bytes)
  meta/
    _journal.json            ← One entry: 0000_baseline, when=1786047746767
    0000_snapshot.json       ← Drizzle internal snapshot
  _archive/
    0000_late_invaders.sql   ┐
    0001_recovery_tokens_…   │
    0002_groovy_korath.sql   │  11 legacy sql files — HISTORICAL ONLY
    0003_…                   │  must never be re-applied
    …                        ┘
    meta/
      _journal.json          ← Old journal preserved as record
      0000_snapshot.json     ┐
      0002_snapshot.json     │  5 old snapshots
      0003_snapshot.json     │
      0008_snapshot.json     │
      0010_snapshot.json     ┘
```

## Final state of `drizzle.__drizzle_migrations`

### Dev
```
 id |                               hash                               |  created_at   
----+------------------------------------------------------------------+---------------
  1 | 51bb8f6f7b191fb7271933387c91c2e4cd6b4a9c0f3fdc3f741c51a3409cc2e3 | 1786047746767
```

### Production
Table does not exist. `migrate` must NOT be pointed at production until the
deploy-step wiring is in place (see `lib/db/README.md`).

---

## Hash reference

| File | SHA-256 |
|---|---|
| `lib/db/drizzle/0000_baseline.sql` | `51bb8f6f7b191fb7271933387c91c2e4cd6b4a9c0f3fdc3f741c51a3409cc2e3` |

Algorithm: `crypto.createHash("sha256").update(fileContent).digest("hex")`
where `fileContent` is the raw UTF-8 content of the `.sql` file, as used by
`drizzle-orm/migrator.js` at runtime.
