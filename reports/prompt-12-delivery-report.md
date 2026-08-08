# Prompt 12 — Schema Fixes (Migration Required): Delivery Report

**Date:** 2026-08-08  
**Commit:** `b595028`  
**Branch:** `main`

---

## Tasks Completed

| Task | Description |
|------|-------------|
| A | Add restricting FK `fixture_players.player_id → players.id` (NO CASCADE), preceded by orphan DELETE |
| B | Add two unique indexes to `player_stats` (B1: general key; B2: partial index for single-row period types) |
| C | Make `computeFormBadgesForPlayerIds` deterministic via `.orderBy(desc(createdAt))` + seen-set dedup |
| D | Drop `players.performance_trend` and `players.trending` columns (separate migration) |

---

## Migration SQL (Verbatim)

### `lib/db/drizzle/0002_fixture_players_fk_and_stats_unique.sql`

```sql
-- Task A: purge orphaned fixture_players rows before adding the restricting FK
DELETE FROM fixture_players
WHERE player_id NOT IN (SELECT id FROM players);

ALTER TABLE "fixture_players" ADD CONSTRAINT "fixture_players_player_id_players_id_fk"
  FOREIGN KEY ("player_id") REFERENCES "public"."players"("id")
  ON DELETE no action ON UPDATE no action;

-- Task B1: unique (player_id, period_type, season)
CREATE UNIQUE INDEX "player_stats_player_period_season_unique"
  ON "player_stats" ("player_id","period_type","season");

-- Task B2: partial unique — exactly one row per player for the four single-row types
CREATE UNIQUE INDEX "player_stats_player_period_single_row_unique"
  ON "player_stats" ("player_id","period_type")
  WHERE period_type IN ('season','previous_season','last5','previous5');
```

### `lib/db/drizzle/0003_drop_player_dead_columns.sql`

```sql
ALTER TABLE "players" DROP COLUMN "performance_trend";
ALTER TABLE "players" DROP COLUMN "trending";
```

---

## Orphan Rows Deleted

| Environment | Rows deleted |
|-------------|-------------|
| Dev | 0 (already clean before migration ran) |
| Production | 8 (will be deleted on next publish) |

---

## Test Counts

| Suite | Before Prompt 12 | After Prompt 12 |
|-------|-----------------|-----------------|
| `@workspace/api-server` | 735 | 742 |
| `@workspace/usmnt-tracker` | 223 | 223 |
| New: `schemaFixes.test.ts` | — | 7 tests |

All 94 test files pass. Typecheck, build, and codegen-drift are clean.

---

## The 7 Regression Tests (`schemaFixes.test.ts`)

| # | Test title | What it proves |
|---|-----------|----------------|
| 1 | FK rejects non-existent `player_id` in `fixture_players` | INSERT with ghost player_id throws a FK violation |
| 2 | FK blocks player DELETE when `fixture_players` links exist | Deleting a linked player throws; the link row survives |
| 3 | Fixture absent from `GET /api/fixtures` after its only link is removed | Orphan-safe: fixtures with no player links don't appear in the API |
| 4 | B1 rejects duplicate `(player_id, period_type, season)` | General unique key enforced |
| 5 | B2 rejects a second `'season'` row under a different season label | Partial index catches the over-write the general key would miss |
| 6 | B2 allows a second `'season_all'` row under a different season label | Regression guard: multi-season rows for `season_all` must still be insertable |
| 7 | `computeFormBadgesForPlayerIds` returns the correct badge deterministically | Task C: badge is computed from the newest stats row, not a random pick |

---

## Files Changed

| File | Change |
|------|--------|
| `lib/db/src/schema/fixtures.ts` | Added `import { playersTable }` + `.references(() => playersTable.id)` on `playerId` |
| `lib/db/src/schema/stats.ts` | Added B1 and B2 unique index definitions |
| `lib/db/src/schema/players.ts` | Removed `performanceTrend` and `trending` columns |
| `lib/db/drizzle/0002_fixture_players_fk_and_stats_unique.sql` | **New** — FK + 2 unique indexes; manually prepended orphan DELETE |
| `lib/db/drizzle/0003_drop_player_dead_columns.sql` | **New** — DROP COLUMN × 2 |
| `lib/db/drizzle/meta/_journal.json` | Updated to 4 entries (0000–0003) |
| `artifacts/api-server/src/lib/queries.ts` | `computeFormBadgesForPlayerIds`: added `.orderBy(desc(createdAt))` + seen-set dedup |
| `artifacts/api-server/src/routes/admin.ts` | Removed `performanceTrend`/`trending` from 3 player INSERT blocks |
| `scripts/src/seedUsmnt.ts` | Removed `performanceTrend: p.trend` and `trending: p.trending` from player INSERT |
| `artifacts/api-server/src/lib/__tests__/schemaFixes.test.ts` | **New** — 7 regression tests |
| 15 other test files | Removed `performanceTrend`/`trending` from INSERT objects; removed column-isolation tests that SELECT/UPDATE the now-dropped column |

---

## Pre-Flight Checks (all passed before migration)

- **Zero** `(player_id, period_type)` duplicates for the four single-row period types in dev → B2 safe to create
- **Zero** orphan rows in `fixture_players` in dev → DELETE ran cleanly
- No `playersTable.performanceTrend` or `playersTable.trending` reads via Drizzle ORM anywhere in application code (only response-level computed fields)
- No INSERT into `players` sets either column other than the 3 `admin.ts` sites and `seedUsmnt.ts` (all removed)

---

## Unanticipated Findings

### 1. Cascading test-cleanup breakage from the new FK

The new NO-ACTION FK immediately surfaced a latent defect. `ntSentinelPromotion.test.ts` had a
stale `__nt-sentinel-promo-test-player__` row in the dev DB. A prior test run had created
`fixture_players` links via `syncApiFootballFixtures` for fixtures not in the test's explicit
teardown list. Those links silently blocked the `DELETE FROM players`, leaving the player row
behind. The next run then failed with a slug-collision on INSERT.

**Fix applied:**
- Deleted the stale player row + its 4 linked `fixture_players` rows from dev DB
- Added a broad `DELETE FROM fixture_players WHERE player_id = ${playerId}` to both
  the `beforeAll` pre-cleanup and the `afterAll` teardown of `ntSentinelPromotion.test.ts`

**Pattern:** Any test that calls `syncApiFootballFixtures` (or any sync that writes
`fixture_players`) must delete `fixture_players` **by player_id** (not just by fixture_id)
before deleting the test player, or future runs will silently fail to clean up.

### 2. 15 test files still writing to the dropped columns

Dropping `performance_trend`/`trending` broke typecheck in 9 files and 5 runtime tests
in files that were still INSERTing, SELECTing, or UPDATEing those columns. All cleaned up:

- **Simple cases** (15 INSERT sites across 8 files): removed the dead fields with `sed`
- **Complex cases** (3 test files with SELECT/UPDATE of the column):
  - `formBadgeAfterSync.test.ts` — removed the 3 "badge does not change when column is written" test cases (now impossible to run; positive badge-presence tests remain)
  - `searchBadgeOverlay.test.ts` — removed the column-write isolation test; kept the "badge present on every result" test
  - `formBadgeAfterIdResolution.test.ts` — removed the "column still shows steady" Phase 3 test; Phases 1 & 2 still prove the badge is computed from stats

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| FK is `ON DELETE NO ACTION` (RESTRICT), not CASCADE | Makes accidental player deletions fail loudly instead of silently orphaning fixture links |
| B2 is a **partial** unique index (not unqualified UNIQUE on `(player_id, period_type)`) | Preserves the ability to have multiple `season_all` rows per player with different season labels — these power the club-season selector. A full unique index would wipe every player's historical season data |
| Task D (column drop) is in a **separate** migration from A+B | Drizzle-kit bundled all changes into one file when `players.ts` was edited before generation; separating them made the ordering explicit and auditable |
| Orphan DELETE is manually prepended to the generated SQL | `drizzle-kit` does not generate data-cleaning statements; the DELETE must precede the `ALTER TABLE ADD CONSTRAINT` or the FK creation fails on any environment that has orphans |

---

## Post-Publish Checklist

- [ ] Confirm `SELECT COUNT(*) FROM fixture_players WHERE player_id NOT IN (SELECT id FROM players)` returns 0 (diagnostic Q9)
- [ ] Confirm Atletico fixtures 628, 629, 631, 632 no longer render as empty cards
- [ ] Confirm FK `fixture_players_player_id_players_id_fk` exists in production schema
- [ ] Confirm indexes `player_stats_player_period_season_unique` and `player_stats_player_period_single_row_unique` exist in production
- [ ] Confirm columns `performance_trend` and `trending` are absent from the `players` table in production
