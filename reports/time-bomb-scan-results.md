# Time-Bomb Re-Scan — Results
_Generated: 2026-08-06_

---

## Background

The earlier search cleared 8 files by looking for `new Date("20xx…")` string
literals. It missed an entire class of time-sensitive code: `Date.now()`
arithmetic used to build test fixtures or assertions without a pinned clock.
This pass searched both test suites for all six patterns listed below, in every
file that does **not** have `vi.useFakeTimers` in scope at the point of use:

```
Date.now()                           used to build test data or expectations
new Date()                           with no arguments
new Date(Date.now() ± n)             relative offsets
Date.now() ± n                       used in an assertion or a fixture value
.toISOString() applied to any above
date-fns helpers (subDays, addDays, startOfDay, differenceIn*) on a live date
```

---

## Full classification

| File | Line(s) | Pattern | Class | Reasoning |
|---|---|---|---|---|
| `youthNtFixtureSync.test.ts` | 56–57, 279–281 | `+30 / +35 / +40 / +43 / +50 days` | **(a) SAFE** | Large future margins; phantom-purge only fires on future fixtures — these are always future regardless of drift |
| **`youthNtFixtureSync.test.ts`** | **542** | **`Date.now() - 60 min`** | **(b) TIME BOMB** | Module-level constant; phantom-purge interacts with this kickoff; confirmed CI failure observed |
| `chiplessFixtureFilter.test.ts` | 166, 356, 412 | `+5 d / default +48 h` | **(a) SAFE** | Large future margins; route filter gates on `kickoff > now` which always passes with 5-day offset |
| `elapsedMinuteClearing.test.ts` | 68, 120, 157, 196 | `-2 h / -45 min / Date.now()` | **(a) SAFE** | Assertion is `elapsedMinute` clearing — a boolean check on a DB column, not a time-window comparison; kickoff offset is irrelevant to what is asserted |
| `fixtureSyncVisibility.test.ts` | 141, 346, 852, 1269, 1578 | `+24 h / +48 h / +72 h / +96 h` | **(a) SAFE** | Large future margins |
| `fixtureSyncVisibility.test.ts` | 518, 709, 992, 1029, 1347 | `-48 h / -72 h / -7 d` | **(a) SAFE** | Past-kickoff fixtures for reconciliation-removal tests; margins are large enough that `kickoff < now` always holds even in slow CI environments |
| `fixtureSyncVisibility.test.ts` | 568, 1084, 1313, 1361 | `now: Date.now()` | **(a) SAFE** | Passed as parameter; both paired kickoffs are 48–72 h past — well outside any flip zone |
| **`fixtureSyncVisibility.test.ts`** | **1512** | **`Date.now() - 60 min`** | **(b) TIME BOMB** | Inside `it()` body; identical pattern to line 542; `GET /api/fixtures` does not time-filter live NT fixtures so actual failure risk is lower, but it is the same bug class and must be fixed |
| `follows.test.ts` | 116, 128 | `+30 d / -1 s` | **(a) SAFE** | `+30 d` expiry check is a pure boolean (always not-expired); `-1 s` is a synchronous comparison — the gap between construction and assertion cannot flip the sign |
| `formBadgeAfterIdResolution.test.ts` | 76–77 | `Date.now()` in name/slug strings | **(a) SAFE** | Used for row uniqueness only; never compared against any time window |
| `formBadgeAfterSync.test.ts` | 454 | `Date.now()` in slug | **(a) SAFE** | Same — uniqueness only |
| `internationalWindowFallback.test.ts` | 53 | `+14 days` | **(a) SAFE** | Large future margin; serves as a fixture kickoff anchor with no window interaction |
| `transferRecovery.test.ts` | 66, 172 | `+7 days` | **(a) SAFE** | 7-day future margin; the repair-pass check is `kickoff > now` which always passes |
| `adminSession.test.ts` | 25, 38, 126 | `Date.now()` | **(a) SAFE** | Expiry test (line 103) already uses `vi.useFakeTimers()` correctly; line 126 stores a fresh timestamp but the function returns null before the expiry check fires (token key is absent); lines 25/38 are the tested helper functions, not assertions |
| `dateLabels.test.ts` | 16, 38, 44 | `Date.now() + 86400000` | **(a) SAFE** | All inside `vi.useFakeTimers({ now: "2026-07-…" })` blocks — clock is pinned; `Date.now()` resolves to the pinned value |
| `Fixtures.test.tsx` | 1025, 1042 | `subDays(startOfDay(new Date()), 7)` | **(a) SAFE** | Inside `beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-07-17T12:00:00Z")) })` — clock is pinned to a fixed instant |

**Time bombs found: 2. Both fixed.**

---

## Fix 1 — `youthNtFixtureSync.test.ts` (the confirmed CI failure)

**Root cause:** `FAKE_LIVE_KICKOFF` was a module-level constant computed at file
load time via `new Date(Date.now() - 60 * 60 * 1000).toISOString()`. By the time
Suite C ran (after Suite A and Suite B completed), real wall-clock time had
advanced. The phantom-purge guard in `syncYouthNtFixtures` ("kickoff must be
future to be a phantom") uses the live clock — so if the clock at guard-time was
> 60 minutes after module load, the guard boundary shifted. The failing test
found 0 rows because the combination of guard timing and suite ordering deleted
the fixture before the assertion ran.

**Changes:**

```diff
- const FAKE_LIVE_KICKOFF = new Date(Date.now() - 60 * 60 * 1000).toISOString();
+ const SUITE_C_NOW       = new Date("2026-06-01T12:00:00.000Z");
+ const FAKE_LIVE_KICKOFF = "2026-06-01T11:00:00.000Z"; // exactly 1 h before SUITE_C_NOW
```

Added to Suite C's `describe` block, before `beforeAll`:

```ts
beforeEach(() => {
  // toFake: ["Date"] leaves setTimeout/setInterval real so the afFetch
  // throttle resolves without manual timer advancement.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SUITE_C_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});
```

Also added `beforeEach` and `afterEach` to the vitest import (they were
previously absent from that file's named imports).

---

## Fix 2 — `fixtureSyncVisibility.test.ts` (same class, same offset)

**Root cause:** `const kickoff = new Date(Date.now() - 60 * 60 * 1000)` inside an
`it()` body, with no clock pinning in the describe. The assertion is that
`GET /api/fixtures` returns the live NT fixture, which does not depend on any
time window in the current route implementation. However, it is the identical
bug class as Fix 1 and would become a real failure if the route ever adds a
kickoff-time filter for stale live fixtures.

**Changes:**

```diff
- import { describe, it, expect, afterAll } from "vitest";
+ import { describe, it, expect, afterAll, beforeEach, afterEach, vi } from "vitest";
```

Added to the describe at line 1441 (before `afterAll`):

```ts
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});
```

```diff
- const kickoff = new Date(Date.now() - 60 * 60 * 1000); // 1 h ago
+ const kickoff = new Date("2026-06-01T11:00:00.000Z"); // 1 h before pinned clock
```

---

## 5-run result for `youthNtFixtureSync.test.ts`

```
Run 1 — Tests  6 passed (6)  ✅   19.36 s
Run 2 — Tests  6 passed (6)  ✅   15.77 s
Run 3 — Tests  6 passed (6)  ✅   15.84 s
Run 4 — Tests  6 passed (6)  ✅   15.96 s
Run 5 — Tests  6 passed (6)  ✅   16.28 s
```

---

## Full verification

| Check | Result |
|---|---|
| `pnpm run lint` | ✅ 0 errors, 4 pre-existing warnings |
| `pnpm run typecheck` | ✅ all 4 packages clean |
| `pnpm --filter @workspace/api-server run test` | ✅ 712 / 712 |
| `pnpm --filter @workspace/usmnt-tracker run test` | ✅ 212 / 212 |
