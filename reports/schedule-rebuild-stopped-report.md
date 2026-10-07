# USMNT schedule rebuild — stopped-work report

## Status

The requested verification sequence stopped when the full API suite failed.
Nothing has been committed, pushed, published, or written to production.
This is an interim report, not a completion report.

## Verification results

| Check | Result |
|---|---|
| Before-change tests 1–3 | All failed as required |
| Before-change guards 4–7 | All passed |
| New seven tests after change | All passed in the full API run |
| Lint | Passed: 0 errors, 8 existing warnings |
| Typecheck | Passed |
| Build | Passed |
| Full API suite | **833 passed, 4 failed** |
| Frontend suite | Not run—the sequence stopped |

The checks were run in the requested order through the API suite:

```sh
pnpm run lint
pnpm run typecheck
pnpm run build
API_FOOTBALL_KEY=ci-placeholder-api-football-key \
  pnpm --filter @workspace/api-server run test
```

The following command was not run because the preceding check failed:

```sh
pnpm --filter @workspace/usmnt-tracker run test
```

## Blocking failures

### Three failures in `novemberQuarterfinals.test.ts`

- `6/7: startup seeds only Haiti legs, corrects TBD, and is idempotent before/after binding`
- `8: dashboard chooses November after October expires and returns both legs with TBD`
- `9: schedule has the quarterfinals and neither stale slug`

All three fail with:

```text
ReferenceError: events is not defined
```

Their setup extracts the array from `scheduleEvents.ts` using source-text slicing
and evaluation. The required data-module extraction broke that setup. The initial
dependency search missed this dependency because it references neither the
removed slugs nor a hardcoded event count/sort order.

### One unexpected failure in `phantomYouthNtFixturePurge.test.ts`

The failing case is:

```text
purgePhantomYouthNtFixtures — Case 3: fixture id present in seenAfIds is NOT deleted
does NOT delete a future youth NT fixture whose id IS in seenAfIds; returns phantomsPurged=0
```

The failure message is:

```text
fixture_players link for fixture id=18916 should still exist
(fixture was kept) but was deleted:
expected [ { fixtureId: 18916 }, …(1) ] to have a length of 1 but got 2
```

The actual discrepancy is **two links instead of one**. Its cause has not been
established. The assertion was not weakened, the suite was not rerun to seek a
passing result, and fixture logic was not changed.

## Changes already made

- Added `lib/db/src/seeds/scheduleEventsData.ts`, a data-only module containing all
  14 target events.
- Changed `lib/db/src/seeds/scheduleEvents.ts` to import that module, preserving
  its upsert behavior.
- Added the seven requested regression tests in
  `artifacts/api-server/src/lib/__tests__/scheduleEventsData.test.ts`.
- Updated only the outdated `10–90` comment in `ntLevelFiltering.test.ts` to
  `10–140`; its assertions are unchanged.
- Ran the dev seed: **17 rows**, including the three retired entries.
- Executed the explicitly authorized dev deletion: **`DELETE 3`**.
- Queried dev afterward: **14 rows**, ordered as listed below.

The KEEP entries matched dev before seeding. No schema, migration, route, hero,
or fixture-logic changes were made.

## Dev rows observed after the change

This reproduces the ordered slug list from the stopped-work report. It is not
a fresh database query or a substitute for the pending full-field target comparison.

| Sort order | Slug |
|---:|---|
| 10 | `friendlies-sept-2026` |
| 20 | `friendlies-oct-2026` |
| 30 | `cnl-qf-nov-2026` |
| 40 | `cnl-finals-mar-2027` |
| 50 | `friendlies-jun-2027` |
| 60 | `gold-cup-2027` |
| 70 | `friendlies-sept-2027` |
| 80 | `wcq-r2-2027` |
| 90 | `wcq-final-jun-2028` |
| 100 | `copa-america-2028` |
| 110 | `cnl-2028-29` |
| 120 | `gold-cup-2029` |
| 130 | `wcq-final-sept-2029` |
| 140 | `world-cup-2030` |

## Still pending

- Resolve the blocking failures without weakening checks or expanding the
  authorized scope.
- Complete the full-field dev comparison against the target table.
- Complete the ordered checks, including the frontend suite.
- Verify the dev Schedule page.
- Commit, push, and confirm green CI for the exact commit.
- Read production's current schedule rows, read-only, after CI is green.
- Emit the guarded Task D SQL and separate follow-up SELECT; do not execute the
  production write.
- Provide the requested complete report, including the nine descriptions
  verbatim, complete dev and production rows, and clearly labelled hero-selection
  reasoning.
- Verify production read-only only after the user reports executing the SQL.

## Export note

This Markdown file documents the previously reported stopped state. Creating
the download did not resume implementation, rerun checks, query either database,
commit or push changes, or publish the app.
