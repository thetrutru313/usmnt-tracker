---
name: fixtures.nt_level senior/youth classification
description: How the fixtures table discriminates senior USMNT from youth (U17/U20/U23) national-team rows, and a dev-DB test-isolation gotcha discovered while adding it.
---

## The core problem this solves

`fixtures.is_national_team` is `true` for the senior USMNT and youth age-group
sides alike — it was never a reliable senior/youth discriminator. Two
surfaces (the Dashboard hero and the Schedule page) are meant to be senior-only
but were leaking U17/U20 fixtures because they only checked `is_national_team`.

## Design decision: allowlist, fail closed

The fix (`fixtures.nt_level` + `isSeniorNtFixture()` in
`artifacts/api-server/src/lib/queries.ts`) is deliberately an allowlist: a row
counts as senior only when `is_national_team = true AND nt_level = 'SENIOR'`.
A national-team row with `nt_level = NULL` (unclassifiable) or any other value
is excluded, never defaulted into "senior".

**Why:** the opposite design (denylist — "senior unless proven youth") fails
open on any future data-quality gap, silently reintroducing the same leak this
fix exists to close. Fail-closed means a classification bug shows up as a
missing fixture (obvious, gets reported) rather than a wrong fixture on the
wrong surface (subtle, might not).

**How to apply:** any new query that must be senior-USMNT-only should reuse
`seniorNtFixtureCondition` from `queries.ts` rather than re-deriving the
condition — it is the one place this allowlist logic should live.

## Age-group derivation reads the US side only

`deriveNtLevel(homeTeam, awayTeam)` in `apiFootballSync.ts` reads the age
suffix from whichever side is the US team, never the opponent. US youth
fixtures have faced age-mismatched opponents (e.g. a US U20 fixture against
"Georgia U21"), so reading the opponent's suffix would misclassify the row.

## Dev-DB test isolation gotcha: `schedule_events.sort_order` races across test files

Multiple test files insert throwaway `schedule_events` rows with very
negative `sort_order` values (e.g. -9996..-9998) so their row is guaranteed to
be "the next upcoming event" for `/api/dashboard`. When vitest runs test files
concurrently against the same dev DB, a new test file's negative sort_order
can be MORE negative than an existing test's, silently stealing the "next
event" slot and breaking that other test with a confusing slug mismatch.

**Why:** the dev DB is shared across concurrently-running test files; nothing
scopes these test fixtures to one test run.

**How to apply:** before picking a sort_order for a new throwaway
schedule_events row, check the existing negative values other test files in
`artifacts/api-server/src/lib/__tests__/` already use, and pick a value that
sits **above** (less negative than) them so this test loses the race rather
than winning it unpredictably. Real seeded events use positive sort_order
(10-90), so anything in the low negative range still beats them.
