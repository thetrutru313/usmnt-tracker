# Prompt 29 — Viewer-local “today”

## Scope and confirmations

**Confirmed:** No production access or publishing was performed. The Fixtures
page, browser display formatting, schedule-window UTC attachment rules, and
windowed-event hero selection were left unchanged.

Two clarifications were approved before implementation:

1. Test 5 asserts both equality of invalid/missing-zone responses **and correct
   Eastern-day membership**. Equality alone already passed before this change.
2. Only the dashboard frontend sends `tz`. The Fixtures page keeps its existing
   `scope=all` request, without a time-zone parameter or a new Today view.
   The fixtures API supports `tz` for callers requesting `scope=today`.

## Step 0 — Existing behavior

### 0a. Server calendar dates and boundaries

| Location (pre-change source) | Purpose | This change |
| --- | --- | --- |
| `routes/dashboard.ts:28–32` | Server-local midnight boundaries for today's games; UTC `todayStr` for start-only events | Use the shared viewer-day helper for all three values |
| Dashboard upcoming-games predicate | Starts at the end of today's interval | Uses the corrected shared end boundary; status, relevance, order and limit predicates unchanged |
| `routes/fixtures.ts:240–244` | Server-local midnight boundaries for `scope=today` | Use the same helper |
| Dashboard seven-day lookback | Subtracts seven days and derives a UTC date string for rating logs | Unchanged |
| Dashboard windowed hero predicate | `endDate` midnight plus the existing 30-hour extension, compared with PostgreSQL `NOW()` | Unchanged |
| Dashboard attached fixtures | Explicit UTC start-date midnight and end-date midnight plus 30 hours | Unchanged |
| `routes/schedule.ts:53–77` | Overall and per-event explicit UTC fixture-attachment windows, including the 30-hour end extension | Unchanged |
| `routes/fixtures.ts:104–106` | UTC date strings for the fixture-detail ±7-day national-team-log matching window | Unchanged |
| `lib/usmntSync.ts:397–398` | UTC date strings for the ±2-day provider-ID matching window | Unchanged |
| `lib/apiFootballSync.ts` | Provider fixture date parsing, UTC current-year/season calculations, elapsed matching tolerances and retention horizons | Unchanged |
| `lib/usmntSync.ts` cycle/year calculation | Assigns logs to national-team cycles | Unchanged |
| `lib/playerStatsSync.ts:649` | UTC date string for injury episode status, not viewer fixture-day filtering | Unchanged |
| `routes/rankings.ts` seven-day date string and stats/discovery year calculations | Rankings/statistics/discovery lookbacks, not viewer fixture-day filtering | Unchanged |

**Confirmed:** No other fixture/event “today” midnight computation was found in
the server source search. Existing instant-based upcoming predicates are not
calendar-day calculations and retain their existing meaning.

### 0b. Frontend calls

- Dashboard: `useGetDashboard`, previously invoked without query parameters,
  with a custom generated query key and live polling.
- Fixtures: `useListFixtures({ scope: "all" })`, with browser-local date grouping.
  It did not have a Today view or make a `scope=today` request.
- Dashboard now passes `{ tz: Intl.DateTimeFormat().resolvedOptions().timeZone }`
  to the real generated hook and query-key helper.
- Fixtures remains unchanged, as explicitly requested.

### 0c. Library

**Confirmed:** No date/time-zone library was declared by the API-server package.
The frontend's existing `date-fns` dependency is not an API-server dependency.
Added `@js-temporal/polyfill` to the API server. Its calendar-day arithmetic
produces UTC instants without fixed-hour offset arithmetic.

## Implementation

**Confirmed:**

- Optional string query parameter `tz` documented for `/dashboard` and
  `/fixtures`; for fixtures it applies only to `scope=today`.
- Missing, empty, invalid named zones and numeric offset strings use
  `America/New_York`.
- `viewerDay` validates named zones with `Intl`, converts the current instant
  to the chosen zone, and computes the start of that calendar day and the start
  of the following calendar day with Temporal.
- Both routes query `[startOfDay, endOfDay)`, including local midnight and
  excluding the next local midnight.
- Dashboard `todayStr` comes from the same instant and zone as its boundaries.
- Dashboard query-cache keys include the zone.
- No manual changes to generated code; outputs were regenerated from OpenAPI.
- No display formatter, FixtureCard, ScheduleMatchRow, or Fixtures-page change.

## Red-then-green evidence

All new behavior tests reached assertions against the old implementation.
There were no missing-import or compilation failures substituted for red tests.

| Group | Before implementation | After implementation |
| --- | --- | --- |
| Tests 1–5, each against dashboard and fixtures-today API | 10 assertion failures | 10 pass |
| Spring DST and local-midnight boundary tests, both endpoints | 4 assertion failures | 4 pass |
| Dashboard start-only hero date after UTC midnight | 1 assertion failure | Pass |
| Test 6: actual dashboard HTTP request includes browser zone | Assertion failed: `tz` was absent | Pass; request and zone-aware cache key verified |
| Test 7: two-days-ahead exclusion, both endpoints | 2 pass | 2 pass |
| Test 8: fixtures-upcoming remains relative to now | Pass | Pass |
| Existing dashboard in-window and schedule-attachment guards | 5 pass serially, unchanged | 5 pass, unchanged |
| Existing dateLabels, formatTime and November hero/display guards | 19 pass, unchanged | 19 pass, unchanged |

The tests freeze **Date only**; HTTP/database timers remain real.
New database fixtures/events are isolated in rollback-only transactions.

**Confirmed baseline interference:** The initial parallel regression run had
one existing hero test select the other test's temporary schedule event.
Both existing test files passed unchanged with file parallelism disabled.
The full local API suite therefore runs serially; no check was removed,
weakened or skipped to address this interference.

Targeted green totals:

- API: **23 passed** across 3 files.
- Frontend: **20 passed** across 4 files.

## Verification

- Lint: **passed**, 0 errors and 8 existing warnings.
- Typecheck: **passed** as part of the full root build. The new frontend test's
  initial missing `this` type annotation was corrected.
- Codegen drift: **passed** using the unchanged drift script after staging the
  regenerated outputs; regenerating produced no difference from the staged files.
- Full frontend suite: **285 passed** across 19 files.
- Full API suite: **892 passed** across 112 files, with file parallelism disabled.
- Full workspace build: **passed**.
- Development smoke check: **passed**. Health, dashboard with Denver zone, and
  fixtures-today with Denver zone returned HTTP 200 and valid JSON after restart.
  The dashboard screenshot rendered the hero and match list successfully.
- **Confirmed browser-log observation:** The preview logged blocked inline scripts
  under its CSP and one 404. **Possible:** unrelated preview/resource issues;
  their source was not investigated as part of this day-boundary change. No CSP
  rule was loosened.
- Commit and CI: results recorded in the final delivery message.
- No production verification was attempted.

## Files changed

Application:

- `artifacts/api-server/src/lib/viewerDay.ts`
- `artifacts/api-server/src/routes/dashboard.ts`
- `artifacts/api-server/src/routes/fixtures.ts`
- `artifacts/usmnt-tracker/src/pages/Dashboard.tsx`
- `artifacts/api-server/package.json`
- `pnpm-lock.yaml`

Contract and generated outputs:

- `lib/api-spec/openapi.yaml`
- `lib/api-client-react/src/generated/api.ts`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/index.ts`
- `lib/api-zod/src/generated/types/listFixturesParams.ts`
- `lib/api-zod/src/generated/types/getDashboardParams.ts`

Tests:

- `artifacts/api-server/src/lib/__tests__/viewerToday.test.ts`
- `artifacts/usmnt-tracker/src/test/dashboardTimezone.test.tsx`

Documentation:

- This report.
- Project memory: viewer-day scope and the observed shared-database hero-test
  interference, for future work.

## Limits

**Unable to verify without running the application:** End-user browser/OS
settings beyond the zones exercised in tests. Actual Denver request serialization
is covered by the frontend test using the real generated hook and HTTP serializer.
No production behavior is claimed from development tests.
