# Prompt 30 — Youth national-team season-independent fixture windows

## Step 0

### 0a. Existing youth fetch loop and purge safety

**Confirmed:** `syncYouthNtFixtures` in
`artifacts/api-server/src/lib/apiFootballSync.ts` covers:

| Team label | API-Football team ID |
| --- | --- |
| US U20 | 10306 |
| US U17 | 12522 |

Before this change, each team fetched the current UTC calendar year and previous
year using `/fixtures?team=<id>&season=<year>`. Each season request had an
independent WARN-and-continue handler. A failure incremented `failures` and set
that team's `fetchComplete` to false.

**Confirmed:** `fetchComplete` gates the per-team phantom-fixture purge, not the
upsert loop. Fixtures from successful responses can still be inserted/updated
after another response fails. `purgePhantomYouthNtFixtures` excludes incomplete
teams before inferring that an unseen upcoming fixture should be deleted.
Other teams with complete responses remain eligible for their normal purge.

**Confirmed:** The senior national-team sync already merged current/prior
seasons with `next=10` and `last=10`, then deduplicated by fixture ID. The youth
change follows that same pattern and ordering.

### 0b. Estimated extra API calls

**Confirmed from code, without provider calls:**

- Before: 2 teams × 2 season requests = **4 requests per sync run**.
- After: 2 teams × 4 requests = **8 requests per sync run**.
- Increase: **4 requests per run**.
- Default hourly schedule: **96 extra requests per 24 hours**.
- Youth-sync total at that cadence: **96/day before → 192/day after**.

**Likely operating total:** Eligible startup runs, restarts, the shared
50-minute cooldown, outages and HTTP retries can affect the actual total. The
96/day increase is the steady hourly estimate, not a measured provider total.

## Implementation

**Confirmed:**

1. Each youth team keeps both existing season requests.
2. It additionally requests `/fixtures?team=<id>&next=10` and
   `/fixtures?team=<id>&last=10`.
3. Each window request has its own WARN-and-continue handler. Its failure
   increments `failures` and sets that team's `fetchComplete` to false.
4. All successful responses are merged and deduplicated by fixture ID before
   participant filtering, existing-row matching, updates, inserts or purge
   seen-ID construction.
5. Existing participant filtering, status/score mapping, insert/update behavior,
   scheduling and purge rules are otherwise unchanged.
6. No frontend, API contract, database schema or generated-code changes.

## Red-then-green evidence

The test file uses the real `syncYouthNtFixtures`, `afFetch` throttle and
`purgePhantomYouthNtFixtures` implementations. Global provider fetch is mocked
before module import, with a fake test-only credential. Unknown mocked paths
throw rather than reaching the network. Database operations and logs are
captured in memory. No real provider call is needed.

| Tests | Before change | After change |
| --- | --- | --- |
| 1. 2027-01-05: next-only fixture filed under season 2025 updates the existing youth row | Assertion failure: 0 updates instead of 1 | Pass; live status, score and elapsed minute verified |
| 2. 2027-03-29: last-only FT fixture updates status and final score | Assertion failure: 0 updates instead of 1 | Pass; finished status and 2–1 score verified |
| 3. Failed next and failed last each block that team's purge | 2 assertion failures: no failed window was fetched/countable | 2 pass; incomplete flag, WARN, protected team and independent other-team purge verified |
| 4. Each of the four sources can fail while all three survivors are used | 4 assertion failures: only 1 or 2 updates instead of 3 | 4 pass; exact request paths, surviving updates, WARN and incomplete flag verified |
| 5. Season fixture is processed once; next/last overlaps do not multiply processing | Pass | Pass; one lookup and one update |
| 6. Either season failure remains incomplete while the other season stays usable | 2 pass | 2 pass; absent upcoming row remains protected |
| 7. Existing youth sync and phantom-youth-purge tests, unchanged | 9 pass | 9 pass |

**Confirmed baseline:** 8 assertion failures and 12 passing regression checks
across the three targeted files. No import or compilation failure was used as
red evidence, and no assertion was removed or weakened.

**Confirmed targeted green:** 20 tests passed across the same three files.

## Verification

- **Confirmed:** Lint passed: 0 errors, 8 existing warnings in unrelated files.
- **Confirmed:** Full root build passed, including root typecheck.
- **Confirmed:** The initial typecheck identified three missing schema fields
  in the new test fixture. Those fields were supplied; no type check was weakened.
- **Confirmed:** Full frontend suite passed: 285 tests across 19 files.
- **Confirmed:** Full API suite passed: 903 tests across 113 files.
- GitHub CI: result recorded in the final delivery.
- Local API tests run with file parallelism disabled because existing global
  fixture/event tests share the development database.
- **Confirmed:** The development dashboard screenshot rendered successfully.
  It retained the previously observed CSP inline-script blocks and one resource
  404; no security policy was changed. This unchanged-screen check is not evidence
  that the running, unrestarted server has loaded the new sync code.

## Files changed

- `artifacts/api-server/src/lib/apiFootballSync.ts` — two independently guarded
  window fetches, one deduplication step, and comments describing completeness.
- `artifacts/api-server/src/lib/__tests__/youthNtFixtureWindows.test.ts` — new
  change-verifying cases and green-before/green-after regression guards.
- `reports/prompt30-youth-nt-windows.md` — this report.

## Verification limits and production safety

**Confirmed:** No real provider API calls were made for this work. No production
application or production database was accessed, and nothing was published.

**Confirmed:** The live-sync server was not restarted for this change: startup
can immediately invoke provider-backed schedules. Verification instead executes
the changed sync and purge code with mocked provider responses, alongside the
required full suites and build.

**Unable to verify without running the application against the real provider:**
Actual current U17/U20 provider coverage and the real account's daily request
increase. Those checks were intentionally not performed.

The final delivery records the pushed commit hash and its GitHub CI result.
