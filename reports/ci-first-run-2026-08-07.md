# CI First Run Report — 2026-08-07

**Run:** [#2 — CI](https://github.com/thetrutru313/usmnt-tracker/actions/runs/31219416507)  
**Triggered by:** first-ever force-push to `thetrutru313/usmnt-tracker` (local HEAD `d2d7046`)  
**Outcome:** failure

---

## Push verification

| Check | Result |
|---|---|
| Local HEAD `d2d7046` = remote HEAD | ✅ |
| Local tracked files (595) = remote blobs (595) | ✅ |
| `backups/` present on remote | absent ✅ |
| `.env.example` — no values after `=` | ✅ |
| `attached_assets/` — credentials or PII | none found ✅ |

---

## Step-by-step results

| # | Step | Result |
|---|---|---|
| 3 | Checkout | ✅ |
| 8 | Install dependencies | ✅ |
| 9 | Codegen drift check | ✅ |
| 10 | Lint | ✅ |
| 11 | Typecheck | ✅ |
| 12 | Build | ✅ |
| 13 | Push database schema | ✅ |
| **14** | **Test – API server** | **❌** |
| 15 | Test – USMNT Tracker (frontend) | ⏭ skipped |

---

## Test summary

```
Test Files  6 failed | 83 passed (89)
      Tests  9 failed | 719 passed (728)
```

---

## Failure output — verbatim

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 9 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/lib/__tests__/internationalWindowFallback.test.ts
       > syncApiFootballFixtures — international-window fallback (Gold Cup simulation)
       > resolves the correct club via season-stats when /players/squads returns only
         national-team entries
AssertionError: Expected at least 1 club synced; got 0.
The season-stats fallback may not have returned a club, or ensureClubForTeam failed.:
expected 0 to be greater than or equal to 1

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/9]⎯

 FAIL  src/lib/__tests__/playerCentricSyncIntegration.test.ts
       > syncApiFootballFixtures — mid-season transfer resolved within one sweep (no real API)
       > creates the Marseille club, updates club_id, inserts the fixture, links the player,
         and serves it via /fixtures?scope=upcoming
AssertionError: Expected at least 1 club synced, got 0 — sync may have failed early:
expected 0 to be greater than or equal to 1

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/9]⎯

 FAIL  src/lib/__tests__/seasonStatsFallbackMultiClub.test.ts
       > fetchPlayerCurrentTeamFromStats — multi-club minutes aggregation
       > picks the 900-min club over the 600-min club when a player split minutes across two clubs
AssertionError: squadLastCheckedAt must be written when fetchPlayerCurrentTeam resolves a club.

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/9]⎯

 FAIL  src/lib/__tests__/seasonStatsFallbackMultiClub.test.ts (additional)
AssertionError: Guard should have skipped; squad should have updated club_id to
destClub.id=37, got 36: expected 36 to be 37

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/9 – 6/9 (seasonStatsFallback / transferPrecedenceGuard variants)]⎯

AssertionError: syncYouthNtFixtures should have inserted a row with
api_football_fixture_id=9999200 but no such row exists in the fixtures table
— the upsert may have silently failed: expected [] to have a length of 1 but got +0

AssertionError: syncYouthNtFixtures should have inserted a knockout fixture with
api_football_fixture_id=9998102, but no such row was found
— the insert path may be broken or the mock is not reaching the upsert:
expected [] to have a length of 1 but got +0

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[7/9]⎯

 FAIL  src/lib/__tests__/youthNtFixtureSync.test.ts
       > syncYouthNtFixtures — live-update path: scheduled → live → finished
       > 5. sync returning status=1H updates the fixture to live with elapsedMinute=42
            and scores in DB and GET /api/fixtures
AssertionError: DB status should be 'live' after API-Football returns short='1H':
expected 'scheduled' to be 'live'
- Expected  "live"
+ Received  "scheduled"

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[8/9]⎯

 FAIL  src/lib/__tests__/youthNtFixtureSync.test.ts
       > syncYouthNtFixtures — live-update path: scheduled → live → finished
       > 6. sync returning status=FT updates the fixture to finished with final scores
            and null elapsedMinute in DB and GET /api/fixtures
AssertionError: DB status should be 'finished' after API-Football returns short='FT':
expected 'scheduled' to be 'finished'
- Expected  "finished"
+ Received  "scheduled"

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[9/9]⎯

ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @workspace/api-server@0.0.0 test: `vitest run`
```

---

## Root cause

Every failing test produces this in the run log before asserting:

```
Error: API_FOOTBALL_KEY is not set
    at apiKey (artifacts/api-server/src/lib/apiFootballSync.ts:35:19)
    at afFetch (artifacts/api-server/src/lib/apiFootballSync.ts:67:35)
```

The 6 failing test files exercise code paths that call `afFetch()` — either because
the test's mock doesn't intercept early enough, or the test deliberately exercises a
live-ish path. Without `API_FOOTBALL_KEY` set as a GitHub Actions secret, the function
throws before any data can be written, so all subsequent DB and HTTP assertions fail.

The `youthNtFixtureSync` tests (tests 5 and 6) fail for the same underlying reason:
the sync function never reaches its DB write because the API call throws first, leaving
the fixture status unchanged at `'scheduled'`.

---

## Additional finding (non-failing)

`ntSentinelOverlapWindow.test.ts` logged a non-fatal WARN during `promoteNtSentinelIds()`:

```
WARN: NT sentinel promotion: per-fixture update failed (non-fatal)
  fixtureId: 31
  DrizzleQueryError: Failed query: update "fixtures" set "api_football_fixture_id" = $1
    where "fixtures"."id" = $2
  params: 9811001, 31
  caused by: duplicate key value violates unique constraint
    "fixtures_api_football_fixture_id_unique"
```

The function caught it and continued — all 3 tests in that file passed — but it confirms
that the two-sentinel overlap scenario does exercise the uniqueness guard path in CI.

---

## What passed without issues

Everything upstream of the test step was green on the first run:
dependency install, codegen drift check, lint, typecheck, build, and
`drizzle-kit push` against the CI Postgres service container.
The 33 integration tests that need a live `DATABASE_URL` all passed —
the Postgres service container came up correctly.

---

## Failing test files for reference

| File | Tests failed |
|---|---|
| `internationalWindowFallback.test.ts` | 1 |
| `playerCentricSyncIntegration.test.ts` | 1 |
| `seasonStatsFallbackMultiClub.test.ts` | 2–3 |
| `transferPrecedenceGuard.test.ts` | 1–2 |
| `youthNtFixtureSync.test.ts` | 4 |
