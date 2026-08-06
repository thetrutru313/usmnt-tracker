# Typecheck Fix Report — 2026-08-05

## Background

`pnpm run typecheck` was silently broken. The api-server's own `build.mjs`
calls esbuild directly and never invokes `tsc`, so the deployed bundle built
fine while type errors accumulated undetected. This blocked adding typecheck
to CI.

---

## Original Errors (verbatim)

```
artifacts/api-server/src/lib/__tests__/discoveryUpsertManualOverrideGuard.test.ts(283,31):
  error TS2554: Expected 0 arguments, but got 1.
  (same error at lines 298, 313, 331, 347 — 5 occurrences)

artifacts/api-server/src/lib/__tests__/rescoreSkipsManualOverride.test.ts(271,44):
  error TS2322: Type '{ ..., statusNotes: null }' is not assignable to
    type '{ ..., statusNotes: string }'.
    Types of property 'statusNotes' are incompatible.
      Type 'null' is not assignable to type 'string'.
  (same error at line 316 — 2 occurrences)

artifacts/usmnt-tracker/src/test/PlayerProfile.test.tsx(183,34):
  error TS2345: Argument of type '"removed"' is not assignable to
    parameter of type '"added"'.
```

---

## Root Causes and Fixes

### 1. `discoverUSProspects({ clubIds: [...] })` — stale call site

**File:** `artifacts/api-server/src/lib/__tests__/discoveryUpsertManualOverrideGuard.test.ts`
(lines 283, 298, 313, 331, 347)

**Cause:** The production function (`playerDiscovery.ts:170`) had its `clubIds`
parameter removed — it now fetches all clubs from the DB directly with no
arguments. Five test call sites still passed the old `{ clubIds: [TEST_CLUB.id] }`
argument.

**Is the test asserting the wrong thing?** No. The regression guard checks that
`onConflictDoUpdate` uses SQL CASE expressions for `usmntStatus` and
`eligibilityConfidence` — that logic is unchanged. The DB is fully mocked via
`wireSelectMocks()`, whose first call already returns `[TEST_CLUB]`, which is
exactly what the now-zero-arg function's first `db.select` sees. The tests
remain valid; only the call site was stale.

**Fix:** Removed the argument from all five calls.

```diff
- await discoverUSProspects({ clubIds: [TEST_CLUB.id] });
+ await discoverUSProspects();
```

---

### 2. `setupSelectMock` parameter type too narrow for nullable `statusNotes`

**File:** `artifacts/api-server/src/lib/__tests__/rescoreSkipsManualOverride.test.ts`
(line 193 — the function declaration; errors surfaced at call sites 271, 316)

**Cause:** `setupSelectMock` was typed as:
```typescript
function setupSelectMock(candidates: typeof OVERRIDDEN_CANDIDATE[]) {
```
`OVERRIDDEN_CANDIDATE.statusNotes` is a non-null string, so TypeScript inferred
the parameter as requiring `statusNotes: string`. `NORMAL_CANDIDATE.statusNotes`
is `null`, which is correct — the DB schema column is
`text("status_notes")` with no `.notNull()`, making it `string | null`.

`rescoreAllCandidates` never reads `statusNotes` in its select query (it only
fetches `id`, `name`, `age`, `apiFootballPlayerId`, `isManualOverride`), so the
field is context-only in the test fixture. The test logic is sound; the parameter
type was just too narrow.

**Fix:** Widened the parameter to accept both fixture shapes.

```diff
- function setupSelectMock(candidates: typeof OVERRIDDEN_CANDIDATE[]) {
+ function setupSelectMock(candidates: Array<typeof OVERRIDDEN_CANDIDATE | typeof NORMAL_CANDIDATE>) {
```

---

### 3. `mockToggle` return type too narrow to accept `"removed"`

**File:** `artifacts/usmnt-tracker/src/test/PlayerProfile.test.tsx` (line 35)

**Cause:** The mock was declared as:
```typescript
const mockToggle = vi.fn(async () => "added" as const);
```
TypeScript inferred the return type as `Promise<"added">`. The test at line 183
then calls `mockToggle.mockResolvedValue("removed")`, which fails because
`"removed"` is not assignable to `"added"`.

The real `toggle` in `MyPlayersContext.tsx:121` is correctly typed as
`(playerId: number) => Promise<"added" | "removed">`. The test correctly
exercises the remove path — the mock type just didn't reflect the real interface.

**Is the test asserting the wrong thing?** No. The test verifies that clicking
"Remove from My Players" shows the correct toast, which is the right behaviour.

**Fix:** Widened the `as const` to the full union.

```diff
- const mockToggle = vi.fn(async () => "added" as const);
+ const mockToggle = vi.fn(async () => "added" as "added" | "removed");
```

---

## Results

### `pnpm run typecheck` — after

```
artifacts/api-server       typecheck: Done ✅
artifacts/mockup-sandbox   typecheck: Done ✅
artifacts/usmnt-tracker    typecheck: Done ✅
scripts                    typecheck: Done ✅
```

Exit 0 — all 4 packages clean.

### `pnpm --filter @workspace/api-server run test`

```
Test Files  82 passed (82)
     Tests  707 passed (707)
  Duration  50.27s
```

### `pnpm run build` note

`pnpm run build` fails for `artifacts/usmnt-tracker` and `artifacts/mockup-sandbox`
with `PORT environment variable is required but was not provided`. This is
**pre-existing and unrelated** to this change — confirmed by running the same
build command against the repo before the fix (identical failure). Both Vite
configs evaluate `PORT` at config-load time; the variable is only available when
the service is started via its workflow. The api-server builds cleanly.

---

## Recommendation: should `build.mjs` run typecheck?

**The gap:** `artifacts/api-server/build.mjs` calls esbuild directly and never
invokes `tsc`. The deployed bundle therefore builds regardless of type errors,
which is how these three errors accumulated silently.

**Options:**

| Option | Dev-loop cost | CI protection |
|---|---|---|
| Add `tsc --noEmit` before esbuild in `build.mjs` | +~4s per restart | ✅ Catches errors on every build |
| Add a separate `build:ci` script that chains `typecheck && build` | 0s to dev loop | ✅ CI calls `build:ci`; devs call `build` |
| Add `typecheck` as a step in the `api-server-test` workflow | 0s to build | ✅ Caught on every test run |

The third option is the lowest friction: the `api-server-test` workflow already
runs on every merge, so adding `typecheck` there catches errors in CI without
touching the dev build speed at all.

The decision is yours — all three are straightforward to implement.
