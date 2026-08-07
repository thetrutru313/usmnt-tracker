# NT Sentinel Fixture ID Promotion — Implementation Report

**Date:** August 7, 2026  
**Scope:** Refactor Block D (startup-only NT sentinel promotion) into a scheduled, exported function; add overlap-window safety; add integration tests.

---

## Background

The USMNT Tracker pre-seeds "sentinel" fixture rows for upcoming international friendlies using a negative placeholder `api_football_fixture_id` (e.g. `-1`, `-2`). These sentinels must be promoted to real positive IDs once API-Football publishes match data.

Prior to this session, the promotion logic (Block D) lived inline in `index.ts` and ran **only at server startup** — meaning the server had to be restarted manually for any promotion to occur.

---

## Two-Path Architecture

### Path 1 — `syncNationalTeamFixtures()` (Primary, pre-match)

- Runs **hourly** via the existing `startUsmntStatsSyncSchedule()` scheduler.
- For every NT fixture row with a null or negative `api_football_fixture_id`, it date-matches ±1 day against the full USMNT fixture list returned by API-Football.
- On a match it writes the real positive `api_football_fixture_id`, `status`, scores, and logo URLs in a single `UPDATE`.
- The Sept 26 fixture will have a real ID weeks before kickoff once API-Football publishes it.
- **`pollLiveFixtures` safety:** Sentinels start as `'scheduled'`. `syncNationalTeamFixtures()` sets `status` and `api_football_fixture_id` in the same UPDATE — there is no window where a sentinel is `'live'` but still negative.

### Path 2 — `promoteNtSentinelIds()` (Fallback, post-match)

- Handles cases where `syncNationalTeamFixtures()` missed the ±1-day window (timezone skew, late API publication).
- Uses a ±7-day window against `matchLogsTable` and calls `pickBestNtFixtureId()` to resolve the best candidate.
- Also runs **hourly** inside `startUsmntStatsSyncSchedule()`.
- Fast-path short-circuit: returns immediately when no unbound (null or negative) sentinel rows exist.

---

## Changes Made

### `artifacts/api-server/src/lib/usmntSync.ts`

- Added imports: `fixturesTable`, `fixturePlayersTable`, drizzle operators (`isNull`, `lt`, `gte`, `lte`, `and`, `asc`), `pickBestNtFixtureId`.
- Added exported `promoteNtSentinelIds()`:
  - Queries all NT fixture rows with `api_football_fixture_id IS NULL OR api_football_fixture_id < 0`, ordered **`ORDER BY kickoff ASC`** (load-bearing — see Overlap Window section).
  - For each sentinel, finds the closest matching `matchLogsTable` row within ±7 days.
  - Per-fixture `try/catch` so a unique-constraint collision on one fixture does not abort the rest of the batch.
  - Outer `try/catch` guards only the initial DB query.
- Updated `startUsmntStatsSyncSchedule()` to `await promoteNtSentinelIds()` on every hourly tick.

### `artifacts/api-server/src/index.ts`

- Replaced 81-line inline Block D with a 3-line call to `promoteNtSentinelIds()` at startup.
- Removed now-unused imports: `fixturesTable`, `fixturePlayersTable`, `matchLogsTable`, eight drizzle operators, `pickBestNtFixtureId`.
- Added `promoteNtSentinelIds` to the `usmntSync` import.
- Updated Block D comment to reflect the new architecture.

---

## Overlap-Window Safety

### The Problem

The Sept 26 and Sept 29 USMNT friendlies have overlapping ±7-day candidate windows. Without ordering, PostgreSQL can return the later sentinel first — it claims the Sept 26 match log and writes the wrong ID, while the correct fixture stays unbound at kickoff. This is **silent data corruption** with no error surfaced.

### The Fix

`ORDER BY kickoff ASC` guarantees the earlier fixture always claims the earlier log. The later sentinel then hits the unique constraint and correctly stays unbound until its own match is played — at which point `promoteNtSentinelIds()` correctly promotes it on the next hourly tick.

> **⚠️ `ORDER BY kickoff ASC` must not be removed.** Removing it reintroduces the silent corruption risk for any pair of fixtures whose ±7-day windows overlap.

---

## Tests Added

### `ntSentinelPromotion.test.ts`

Integration test covering three cases:

| Case | Expected |
|---|---|
| Sentinel + matching log within ±7 days | Sentinel promoted to real ID |
| Sentinel + no log in ±7-day window | Sentinel unchanged |
| Row with positive ID | Untouched (fast-path skip) |

### `ntSentinelOverlapWindow.test.ts`

Integration test for the overlapping-window case — two sentinels 3 days apart, one shared log:

| Phase | Expected |
|---|---|
| Phase 1: only earlier match played | Earlier sentinel promoted; later correctly stays unbound |
| Phase 2: later match also played | Later sentinel promoted via date-proximity tiebreaker in `pickBestNtFixtureId` |

---

## Verification

```
tsc --noEmit                              ✅  clean
pnpm --filter @workspace/api-server test  ✅  89 test files, 727 tests, all passed
```

---

## Future Cleanup

`promoteNtSentinelIds()` can be removed from the scheduler (and the Block D call in `index.ts` deleted) once **all four Sept/Oct 2026 USMNT friendlies** have been played and their fixture rows carry confirmed positive `api_football_fixture_id` values.

The fast-path short-circuit (`return` when no unbound rows exist) makes it essentially free to leave running, but it is dead code after that point.

**`deploymentTarget` switch (Reserved VM)** — explicitly deferred; tracked separately as task 7C.

---

## Architecture Diagram

```
Server startup
└── promoteNtSentinelIds()   ← one-time catch-up

Hourly scheduler tick
├── syncNationalTeamFixtures()   ← primary: ±1-day API-Football match, updates status + IDs
└── promoteNtSentinelIds()       ← fallback: ±7-day match-log proximity, per-fixture try/catch
                                    ORDER BY kickoff ASC  ← overlap-window corruption guard
```
