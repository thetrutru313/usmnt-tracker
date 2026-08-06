# CI / Lint Task Results
_Generated: 2026-08-06_

---

## Task 1 — Canary: is the linter actually linting?

### Rule verification

All three deliberate violations in `_canary.tsx` fired correctly:

| Rule | Severity | Location | Violation |
|---|---|---|---|
| `react-hooks/exhaustive-deps` | warning | line 10 | `val` missing from dep array |
| `@typescript-eslint/no-unused-vars` | **error** | line 16 | `dead` assigned but never read |
| `@typescript-eslint/no-explicit-any` | warning | line 21 | explicit `any` annotation |

The linter is live, JSX-aware, and correctly distinguishing errors from warnings.

### Why the five stale `eslint-disable` directives weren't caught

Those dep arrays were genuinely complete — either they were always correct or they became correct after a later refactor. ESLint sees no violation at those lines, so it reports the directive itself as unused. That is the rule working correctly, not a misconfiguration.

### Canary deleted; lint scope expanded

- Canary file `_canary.tsx` deleted.
- Lint scope expanded from `artifacts lib` → **`artifacts lib scripts e2e`**.

### New error surfaced and fixed

`scripts/src/seedUsmnt.ts` line 335 — `playerIdBySlug` assigned but never used.  
**Fix:** renamed to `_playerIdBySlug` (matches the `^_` allowed-unused pattern).

### Final lint result

```
✖ 4 problems (0 errors, 4 warnings)
```

4 pre-existing `@typescript-eslint/no-explicit-any` warnings in `follows.test.ts` and `PlayerProfile.tsx` — all already carrying inline disable comments; no new errors.

---

## Task 2 — Document Decisions 2 and 3

### Decision 2 — Date-drift fix (fake timer additions)

Three `describe` blocks in `Fixtures.test.tsx` had no clock pinning. Added `vi.useFakeTimers` / `vi.useRealTimers` to each:

```
"Fixtures page — scheduled → finished status transition"
"Fixtures page — pool-tier filter and Recent Results count badge"
"Fixtures page — Recent Results collapsible stays open across poll updates"
```

Each block received:

```ts
beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-07-17T12:00:00Z") });
});
afterEach(() => {
  vi.useRealTimers();
});
```

### Decision 3 — UTC vs local: implementation unchanged, tests fixed

`git diff` on both source files:

```
git diff HEAD -- artifacts/usmnt-tracker/src/dateLabels.ts   →  (empty)
git diff HEAD -- artifacts/usmnt-tracker/src/pages/Fixtures.tsx  →  (empty)
```

Neither implementation file was touched. Test changes applied to `Fixtures.test.tsx`:

| Change | Before | After |
|---|---|---|
| Section comment | "Timezone / UTC-date bucketing tests — `toISOString().substring(0,10)`" | "Local-date bucketing tests — `toLocaleDateStr` (local calendar day)" |
| Describe name | `"utcDateLabel Today/Tomorrow string comparison"` | `"localDateLabel Today/Tomorrow string comparison"` |
| Test 18 kickoff | `2026-07-18T02:00:00Z` (02:00 UTC = 22:00 Eastern on July 17 — ambiguous) | `2026-07-18T10:00:00Z` (10:00 UTC = 06:00 Eastern on July 18 — unambiguous) |
| Test 19 clock | `2026-07-17T23:59:50Z` (UTC midnight, not Eastern) | `2026-07-18T03:59:50Z` (July 17 23:59:50 Eastern, 10 s before Eastern midnight) |

**Test 19 detail:** `vi.advanceTimersByTime(15_000)` crosses Eastern midnight to `2026-07-18T04:00:05Z` (July 18 00:00:05 Eastern). The simulated poll cycle (`updateFixtures([fixture])`) re-renders the component, flipping the date heading from "Tomorrow" to "Today".

### Time-bomb search

Searched all test files for `new Date("20xx…")` without `useFakeTimers`. Found 8 files; all are safe:

| File | Verdict |
|---|---|
| `stalePostponedPurge.test.ts` | `new Date("2000-01-01")` — static "ancient" anchor for age arithmetic, never compared to `Date.now()` |
| `pickBestNtFixtureId.test.ts` | Dates are kickoff inputs to the function under test; the function does not call `Date.now()` internally |
| `birthplaceBackfillAndRescore.test.ts` | `new Date("2026-01-01")` is a `discoveredAt` seed value for ordering, not a time comparison |
| `bulkApproveSlugCollision.test.ts` | Same pattern |
| `rescoreCapAndSkipCount.test.ts` | 23 date literals — all `lastScoredAt`/`discoveredAt` ordering anchors |
| `rescoreSkipsManualOverride.test.ts` | Same pattern |
| `FixtureCard.test.tsx` | Kickoff is a data field; the LIVE badge is driven by `status: "live"`, not time |
| `rescoreCapOrderingIntegration.test.ts` | 2020/2099 dates are static ordering anchors; `beforeRunTime`/`afterRunTime` use `new Date()` at runtime |

**No additional time bombs.**

---

## Task 3 — Self-contained fixtures for 3 CI-failing test files

All three files now insert and clean up their own rows. No seed data required.

### `coleCampbellNoStatsGraceful.test.ts`

**Problem:** `beforeAll` queried `players` by name `"Cole Campbell"` — throws on a schema-only DB.

**Fix:** `beforeAll` now inserts:
1. A sentinel `clubs` row (`"CI Test Club [cole-campbell-sentinel]"`, Bundesliga 2, Germany)
2. A sentinel `players` row (name `"Cole Campbell"`, slug `cole-campbell-ci-sentinel`, position MF, age 22)
3. A `playerStatsTable` row for season `"2025"` (512 min, avgRating 7.12)

`afterAll` deletes them in reverse-FK order: stats → player → club.

### `recoveryRoundTrip.test.ts`

**Problem:** `beforeAll` queried `players LIMIT 3` — throws when no players exist.

**Fix:** `beforeAll` replaced to insert:
1. A sentinel `clubs` row (`"CI Test Club [recovery-rt-sentinel]"`, MLS, USA)
2. Three sentinel `players` rows (slugs `ci-recovery-rt-sentinel-1/2/3`)

Their IDs are assigned to `realPlayerIds`. Two new tracking variables added:

```ts
let sentinelClubId: number | undefined;
const sentinelPlayerIds: number[] = [];
```

`afterAll` extended: after the existing recovery-token/follows/anon-users cleanup, deletes the sentinel players then the sentinel club.

### `rescoreCapOrderingIntegration.test.ts`

**Problem:** `const TEST_CLUB_ID = 1` — hardcoded FK to a row that only exists in a seeded DB.

**Fix:** `const TEST_CLUB_ID = 1` removed. Step 0 added inside the existing `db.transaction()`:

```ts
const [sentinelClub] = await tx
  .insert(clubsTable)
  .values({ name: "CI Sentinel Club [rescore-ordering-test]", league: "MLS", country: "USA" })
  .returning({ id: clubsTable.id });
testClubId = sentinelClub!.id;
```

Because the transaction ends with `throw new RollbackSignal()`, the club row is rolled back automatically. No `afterAll` change needed.

---

## Task 4 — CI workflow corrections

### 4a — `SESSION_SECRET` removed

Removed from `.github/workflows/codegen-drift.yml`:

```diff
-      SESSION_SECRET: ci-placeholder-session-secret
```

No code reads `SESSION_SECRET`; it appeared only in `threat_model.md` (out of date). `ADMIN_PASSWORD` kept — `routes/admin.ts` reads it.

### 4b — `drizzle-kit push` confirmed non-interactive

Tested against the scratch DB:

```
[✓] Pulling schema from database...
[i] No changes detected
Exit code: 0
```

No prompt, no stdin read. On a fresh empty CI database, every operation is a table-create (non-destructive); Drizzle only prompts on destructive operations (column drops, renames). Both the "no changes" case and the "create all tables" case are guaranteed non-interactive.

---

## `PlayerRow` in `MatchDetail.tsx`

`PlayerRow` (line 117) is **unfinished dead code** — a complete, well-implemented `<tr>` component (player photo, position badge, minutes, goals, assists, rating columns) built for what appears to be a "USMNT-tracked players who appeared in this match" table view. The parent `<table>` was either never rendered or was removed before the feature shipped. The component accepts `FixtureTrackedPlayer` and is fully ready to wire up; it just needs a call site. Currently suppressed with an inline `eslint-disable`.

---

## Final verification

| Check | Result |
|---|---|
| `pnpm run lint` | ✅ 0 errors, 4 pre-existing warnings |
| `pnpm run typecheck` | ✅ all 4 packages clean |
| `pnpm --filter @workspace/usmnt-tracker run test` | ✅ 212 / 212 |
| `pnpm --filter @workspace/api-server run test` | ✅ 712 / 712 |
