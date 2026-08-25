# U17/U20 Fixture Leak Fix — Implementation Report

**Date:** 2026-08-25

## Problem

`fixtures.is_national_team` was `true` for the senior USMNT and for youth
age-group sides (U17/U20) alike — there was no other discriminator. This let
U17/U20 fixtures leak into two surfaces meant to show only the senior team:
the Dashboard hero and the USMNT Schedule page.

## What changed

### Schema
- Added `fixtures.nt_level` — nullable text column. `NULL` for club fixtures;
  one of `'SENIOR' | 'U23' | 'U20' | 'U17'` for national-team fixtures.
- Generated via `drizzle-kit generate` (DDL only): `lib/db/drizzle/0004_crazy_wind_dancer.sql`.
- Applied to dev via `drizzle-kit migrate`.

### Classification logic
- New `deriveNtLevel(homeTeam, awayTeam)` in
  `artifacts/api-server/src/lib/apiFootballSync.ts`, placed beside the
  existing `isUsMensNationalTeamName()` (left untouched).
- Reads the age suffix from the **US side only**, never the opponent — US
  youth fixtures have faced age-mismatched opponents (e.g. a US U20 fixture
  against "Georgia U21"), so reading the opponent's suffix would misclassify
  the row.
- Returns `'SENIOR'` when the US side has no suffix, `'U17'/'U20'/'U23'` when
  it matches `/\bU(\d{2})\b/`, or `null` (with a logged warning) when neither
  side is a recognized US national team or the suffix doesn't parse. Callers
  must never default a `null` result to `'SENIOR'`.

### Every write path updated to populate `nt_level`
| Path | File | How |
|---|---|---|
| Senior sentinel startup seed | `artifacts/api-server/src/index.ts` | literal `'SENIOR'` |
| Youth fixture startup seed | `artifacts/api-server/src/index.ts` | literal `'U20'`/`'U17'` per row |
| `syncYouthNtFixtures()` insert | `apiFootballSync.ts` | `deriveNtLevel()` |
| Club fixture sync upsert | `apiFootballSync.ts` | `deriveNtLevel()` |
| One-off senior fixture seed | `scripts/src/seedUsmnt.ts` | literal `'SENIOR'` |

### New predicate
- `isSeniorNtFixture()` / `seniorNtFixtureCondition` in
  `artifacts/api-server/src/lib/queries.ts`.
- Allowlist design: true only when `is_national_team = true AND nt_level = 'SENIOR'`.
  A `NULL` or unrecognized `nt_level` **fails closed** (excluded) — this
  prevents a future classification gap from silently reopening the leak.

### Queries updated (and *only* these two)
- `routes/dashboard.ts` — the `nextEventFixtures` query feeding the hero.
- `routes/schedule.ts` — the Schedule page's `ntFixtures` query.

**Explicitly left unchanged**, per the scoping requirement:
- `routes/dashboard.ts` — `todaysGamesRaw` / `upcomingGamesRaw` (the Upcoming
  Matches card) — youth fixtures still appear there.
- `GET /api/fixtures` — the Fixtures page still shows every age group.
- `syncNationalTeamFixtures()`, `promoteNtSentinelIds()`,
  `isUsMensNationalTeamName()` — untouched.

## Verification: `schedule_events` youth-window check

Required pre-completion check: does any `schedule_events` row represent a
youth tournament window? If so, senior-only filtering would empty that
event's `fixtures` array and the hero would fall back to rendering
`nextEvent.description`.

**Result: no such row exists.** All 9 current events are senior competitions
(friendlies, Nations League, Gold Cup, Copa América, World Cup qualifying/
finals). No workaround was needed.

## Tests

New regression suite: `artifacts/api-server/src/lib/__tests__/ntLevelFiltering.test.ts`.
For each of the four surfaces (hero, schedule, Upcoming Matches,
Fixtures page), exercises five fixture types: senior, U17, U20, club, and a
national-team fixture with `nt_level = NULL`.

- Hero / Schedule page: senior only; U17, U20, club, and null-level rows all excluded.
- Upcoming Matches: senior, U17, and U20 all still appear (explicit guard
  against youth rows quietly disappearing later).
- Fixtures page: all five types remain fetchable — the endpoint doesn't
  filter by `nt_level` at all.

Two pre-existing tests (`dashboardInWindowEvent.test.ts`,
`scheduleFixtureAttachment.test.ts`) needed a one-line `ntLevel: "SENIOR"`
added to their inserted test rows, since those rows represent senior USA
fixtures and would otherwise now be excluded by the new filter.

**Result:** 750/750 tests passing. `pnpm run typecheck` and `pnpm run lint`
both clean. `codegen-drift` check clean (no OpenAPI/frontend changes were
made or needed).

## Production backfill — run by hand before publishing

Per `lib/db/README.md`, migrations only carry DDL to production via
Publish's schema diff — DML (including backfills) never reaches production
through a migration file. This backfill must be run manually in the Replit
database console against production before the next Publish.

Verified against dev first (626 club rows → `NULL`, 5 `SENIOR`, 17 `U17`,
18 `U20`, zero unclassifiable):

```sql
UPDATE fixtures
SET nt_level = 'SENIOR'
WHERE is_national_team = true
  AND (home_team = 'USA' OR away_team = 'USA')
  AND nt_level IS NULL;

UPDATE fixtures
SET nt_level = 'U' || substring(home_team from 'U(\d{2})\y')
WHERE is_national_team = true
  AND nt_level IS NULL
  AND home_team ~ '^(USA|United States) U\d{2}$';

UPDATE fixtures
SET nt_level = 'U' || substring(away_team from 'U(\d{2})\y')
WHERE is_national_team = true
  AND nt_level IS NULL
  AND away_team ~ '^(USA|United States) U\d{2}$';

-- verify no national-team row is left unclassified:
SELECT id, home_team, away_team, kickoff FROM fixtures
WHERE is_national_team = true AND nt_level IS NULL;
```

If the final `SELECT` returns any rows, they need manual classification
before relying on `nt_level` for those rows — do not guess a value.

## Documentation updated

- `replit.md` — corrected the inaccurate claim that youth NT fixtures are
  seeded inline in the main seed script (`seedUsmnt.ts`); they're actually
  raw SQL in `artifacts/api-server/src/index.ts`'s startup block.
- `lib/db/README.md` — new "`fixtures.nt_level`" section documenting the
  column, `deriveNtLevel()`, and `isSeniorNtFixture()` / `seniorNtFixtureCondition`.

## Explicitly out of scope (deferred, follow-ups proposed separately)

1. Three duplicate U17 fixture rows from February 2025 under two different
   competition labels/IDs — needs a human decision on which label is correct
   before any deletion.
2. Confirming the raw-SQL youth startup seed's idempotency under Autoscale
   cold starts (it already has `ON CONFLICT ... DO NOTHING`).
3. Optionally refactoring `purgePhantomYouthNtFixtures()` to read `nt_level`
   instead of regex-matching team names.
4. Optionally exposing `nt_level` in the OpenAPI contract so the frontend
   could badge fixtures by age group — not needed for this fix; no frontend
   or OpenAPI changes were made.
