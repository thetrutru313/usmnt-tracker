# Task A — Test-Suite Analysis Report

**Date:** 2026-08-06  
**Scope:** Determine which test files require a live Postgres connection, characterise the complete test failure picture, and summarise what CI will need.

---

## 1 — API Server: mocked vs. integration test split

### Method

The full API-server suite was run twice:

```
# Real DB (baseline)
pnpm --filter @workspace/api-server run test
# → 84 files, 712 tests, all pass

# Dummy URL (no Postgres reachable)
DATABASE_URL="postgres://u:p@127.0.0.1:1/nodb" pnpm --filter @workspace/api-server run test
```

### Result

| Tier | Files | Tests | Outcome with dummy URL |
|---|---|---|---|
| **Mocked (unit)** | 51 | ~430 | ✅ All pass |
| **Integration (real DB)** | 33 | ~280 | ❌ All fail — `ECONNREFUSED 127.0.0.1:1` |
| **Total** | **84** | **712** | — |

### Integration files that fail (require Postgres)

All 33 fail with `connect ECONNREFUSED 127.0.0.1:1`. Representative sample:

```
transparencyInvoiceDeletion.test.ts
transparencyInvoiceLabelEdit.test.ts
transparencyInvoiceValidation.test.ts
transparencyVerifyRateLimit.test.ts
chiplessFixtureFilter.test.ts
scheduleFixtureAttachment.test.ts
searchBadgeOverlay.test.ts
seasonStatsFallbackMultiClub.test.ts
sentinelPhantomProtection.test.ts
squadCacheStampOnSuccess.test.ts
stalePostponedPurge.test.ts
transferRecovery.test.ts
purgeStaleFixtureLinks.test.ts
repairPassReserveGuard.test.ts
… (19 more)
```

### Unit files that pass (no Postgres needed)

51 files, including:

```
transparencyInvoicePathGuard.test.ts   ← recently written, mocked
rescoreSkipsManualOverride.test.ts
anonUserCleanup.test.ts
eligibilityConfidence.test.ts
… (47 more)
```

### CI implication — APPROVAL NEEDED

A Postgres **service container** is required in any CI workflow that runs the full API-server suite. The current `.github/workflows/codegen-drift.yml` has no DB service and no test step at all.

**Two options (need user decision before implementing):**

| Option | Description | Trade-off |
|---|---|---|
| A — Full suite with Postgres | Add `services: postgres:` to the workflow | Every CI run needs a live DB (~30–60 s startup); all 712 tests run |
| B — Mocked tier only | Run only the 51 mocked files via glob/exclude | Faster, no DB dependency, but 33 integration files never run in CI |

---

## 2 — Frontend: Fixtures.test.tsx — 19 failing tests

### Method

```
pnpm --filter @workspace/usmnt-tracker run test
# → 1 file failing: src/test/Fixtures.test.tsx
#    19 failed | 193 passed (212 total)
```

These 19 tests were in the set of test files that had never previously been executed by any workflow or CI step.

---

### Root-cause A — Date drift (tests 1–15)

**Affects:** Three describe blocks with no fake-timer setup.

| Line | Describe block | Failing tests |
|---|---|---|
| 142 | `"scheduled → finished status transition"` | 5 |
| 264 | `"pool-tier filter and Recent Results count badge"` | 9 |
| 559 | `"Recent Results collapsible stays open across poll updates"` | 1 |

**What goes wrong:**

`makeFixture()` defaults to `kickoff: new Date("2026-07-17T20:00:00Z")`.

`Fixtures.tsx` computes:
```ts
const sevenDaysAgo = subDays(startOfDay(new Date()), 7);
const finishedFixtures = filteredFixtures.filter(
  (f) => f.status === "finished" && new Date(f.kickoff) >= sevenDaysAgo,
);
```

With the **real** current date (2026-08-06), `sevenDaysAgo` ≈ July 30. July 17 < July 30 → finished fixtures silently vanish from Recent Results.

The 2-hour grace window for "scheduled" fixtures makes it worse: a July 17 kickoff is 20 days in the past, so scheduled fixtures also vanish from `upcomingFixtures`.

Both sections are empty; every `screen.getAllByText("Minnesota United")` call throws.

**Fix required:** Add `vi.useFakeTimers({ now: new Date("2026-07-17T12:00:00Z") })` in a `beforeEach` and `vi.useRealTimers()` in `afterEach` for each of the three describe blocks above.

---

### Root-cause B — 2-hour grace window traps a past-kickoff test fixture (test 16)

**Affects:** `"UTC date bucketing"` describe (line 633), test:  
`"places a 02:00 UTC kickoff in the July 17 bucket (not July 16)"`

The test pins the clock to `2026-07-17T10:00:00Z` and creates a **scheduled** fixture with kickoff `2026-07-17T02:00:00Z`. That kickoff is 8 hours in the past. The component's grace-window filter:

```ts
f.status !== "finished" && new Date(f.kickoff).getTime() > nowMs - TWO_HOURS_MS
```

`02:00 > 08:00 (= 10:00 − 2 h)` → **false** → fixture excluded from `upcomingFixtures`.

The fixture is also not "finished", so it's absent from `finishedFixtures` too. Nothing renders; `screen.getByText(/Today/i)` throws.

**Fix required:** Pin the clock to `2026-07-17T02:30:00Z` instead of `10:00:00Z`. At 02:30 the fixture (kicked off at 02:00) is only 30 minutes old — inside the 2-hour window — so it appears in `upcomingFixtures`. The UTC date of "today" is still 2026-07-17, preserving the test's intent.

---

### Root-cause C — UTC vs. local timezone mismatch in implementation (tests 16–19)

**Affects:** `"UTC date bucketing"` (lines 638, 665) and `"utcDateLabel Today/Tomorrow string comparison"` (lines 888, 929).

**What the tests expect:**

The test file's section header (lines 626–631) describes the implementation as:

> `groupByDate` uses `.toISOString().substring(0, 10)` to derive the bucket key …  
> `utcDateLabel` compares `dateStr` against `new Date().toISOString().substring(0,10)` (UTC date)

**What the implementation actually does:**

`dateLabels.ts`:
```ts
export function toLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function localDateLabel(dateStr: string): string {
  const today = toLocalDateStr(new Date());
  const tomorrow = toLocalDateStr(new Date(Date.now() + 86400000));
  if (dateStr === today) return "Today";
  if (dateStr === tomorrow) return "Tomorrow";
  …
}
```

`Fixtures.tsx` line 220:
```ts
const dateStr = toLocalDateStr(new Date(fixture.kickoff));
```

`getFullYear()` / `getMonth()` / `getDate()` return **local-timezone** values, not UTC. The test environment is pinned to `America/New_York` (UTC−4 in July).

**Concrete failure examples:**

| Scenario | UTC kickoff | Local (Eastern) equivalent | UTC bucket | Local bucket |
|---|---|---|---|---|
| Test 16 — early-morning kickoff | Jul 17 02:00 UTC | Jul **16** 22:00 Eastern | 2026-07-17 | **2026-07-16** |
| Test 18 — "Tomorrow" heading | Jul 18 02:00 UTC | Jul **17** 22:00 Eastern | 2026-07-18 | **2026-07-17** |
| Test 19 — midnight flip | Jul 18 02:00 UTC | Jul **17** 22:00 Eastern | 2026-07-18 | **2026-07-17** |

- **Test 16:** Expects the heading "Today" (July 17 UTC). The implementation buckets it as "2026-07-16" (Eastern), so the heading reads "Friday, July 16" instead.  
- **Test 17** (`"assigns two fixtures with kickoffs on different UTC dates to separate buckets"`): Fixture A is Jul 17 23:30 UTC = Jul 17 19:30 Eastern → bucket "2026-07-17". Fixture B is Jul 18 00:30 UTC = Jul 17 20:30 Eastern → also bucket **"2026-07-17"**. Both land in the **same** bucket; only "Today" renders, "Tomorrow" is absent → `getByText(/Tomorrow/i)` throws.  
- **Test 18:** Expects "Tomorrow" for Jul 18 02:00 UTC. Local date is Jul 17 22:00 Eastern → bucket "2026-07-17" = "Today". `localDateLabel` returns **"Today"**, not "Tomorrow".  
- **Test 19** ("flips Tomorrow to Today"): Same mismatch; same failure.

**Decision required — this is a product correctness question:**

| Choice | Meaning | Work |
|---|---|---|
| **Fix the implementation to use UTC** | A kickoff at 02:00 UTC on July 17 is labelled "July 17" for every user worldwide, regardless of their timezone | Change `toLocalDateStr` to use `.toISOString().substring(0,10)` and rename `localDateLabel` → `utcDateLabel`. The test assertions are then correct as written. |
| **Fix the tests to match the local-timezone implementation** | Labels reflect the user's local calendar day | Rewrite tests 16–19 to use fixture kickoff times that fall on the correct **Eastern** day, and remove the UTC-bucketing section header comment |

The current implementation (`localDateLabel`) means a viewer in New York sees a 02:00 UTC fixture (e.g., a friendly played at 10 PM local time) bucketed on July **16**, even though it kicked off on July **17** UTC. Whether that is the desired UX is a product call.

---

## 3 — Summary table

| # | Test(s) | Root cause | Fix complexity |
|---|---|---|---|
| 1–5 | `scheduled → finished` describe | No fake timer; date drift | Low — add `beforeEach`/`afterEach` timers |
| 6–14 | `pool-tier filter` describe | No fake timer; date drift | Low — add `beforeEach`/`afterEach` timers |
| 15 | `stays open across poll updates` describe | No fake timer; date drift | Low — add `beforeEach`/`afterEach` timers |
| 16 | UTC bucket — 02:00 kickoff | Clock 8 h past kickoff; grace window filter; **also** local-tz mismatch | Medium — depends on product decision |
| 17 | UTC bucket — two separate dates | Local-tz collapses Jul 18 00:30 UTC into Jul 17 Eastern | Medium — depends on product decision |
| 18 | "Tomorrow" heading in Recent Results | Jul 18 02:00 UTC = Jul 17 local; returns "Today" not "Tomorrow" | Medium — depends on product decision |
| 19 | Midnight flip "Tomorrow"→"Today" | Same local-tz issue | Medium — depends on product decision |

---

## 4 — Recommended next steps (requires approval)

1. **CI Postgres service container** — confirm Option A or B from §1 before implementing Task C.  
2. **Tests 1–15 (date drift)** — straightforward fix; can proceed without further discussion.  
3. **Tests 16–19 (UTC vs. local)** — confirm whether the implementation should use UTC or local dates. UTC is the safer default for a sports-data app with global kickoff times; it matches what the tests were written for.  
4. **Tasks B & C** (ESLint/Prettier, CI workflow extension) — not started; blocked on §1 and §3 decisions.
