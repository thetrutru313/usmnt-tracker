# Prompt 31 — Atomic sync claims; guarded live polling and RSS

## Step 0

### 0a. Existing claim and callers

**Confirmed:** Before this change, `claimSyncRun` performed a SELECT of
`last_run_at`, compared it with JavaScript `Date.now()`, then separately
performed an unconditional INSERT/ON CONFLICT UPDATE using JavaScript dates.
Concurrent instances could both pass the read before either wrote its claim.

All existing production-code callers:

| Sync name | Caller | Existing cooldown |
| --- | --- | --- |
| `fixtures` | `startApiFootballSyncSchedule` | 50 minutes |
| `usmntStats` | `startUsmntStatsSyncSchedule` | 50 minutes |
| `playerClub` | `startPlayerClubSyncSchedule` | 23 hours |
| `playerStats` | `startPlayerStatsSyncSchedule` | 23 hours |
| `nationalTeamCaps` | `startNationalTeamSyncSchedule` | 23 hours |

**Confirmed:** All five names and cooldowns remain unchanged.

### 0b. Existing live and RSS schedules

**Confirmed:** Live polling starts from `startApiFootballSyncSchedule`.
Its first poll occurs on the interval, not immediately at startup.
The default is five minutes, configurable through `LIVE_POLL_INTERVAL_MS`.
Zero/negative values disable it; invalid/empty/non-finite values retain the
existing default-fallback behavior. It already had an in-process mutex but
no cross-instance database claim.

The separate hourly fixture sweep already had a 50-minute claim and an
immediate startup run. That behavior remains unchanged.

**Confirmed:** `startRssIngestionSchedule` immediately imports feeds at startup,
then repeats every 15 minutes by default. Neither path had a claim.

### 0c. Unique constraint

**Confirmed:** The schema declares `sync_name` as the primary key.
A read-only query against the development database independently confirmed
`sync_metadata_pkey`, defined as `PRIMARY KEY (sync_name)`.
No schema migration was needed.

## Implementation

**Confirmed:**

- The guard uses one parameterized INSERT/ON CONFLICT UPDATE statement with a
  cooldown predicate and RETURNING.
- Both the inserted/updated timestamp and the expiry predicate use PostgreSQL
  `now()`, not the application clock.
- A returned row means the claim succeeded; no returned row means skip.
- Database errors still log WARN and allow the run, as explicitly required.
- Live polling now claims `livePoll` with 80% of its configured interval:
  four minutes at the five-minute default.
- The live claim is inside the existing try/finally, so a denial releases the
  local mutex and does not block future ticks.
- RSS startup and recurring imports share a guarded runner claiming
  `rssIngest` with a 12-minute cooldown.
- Existing sync logic, scheduling intervals and cooldowns remain unchanged.

The exact existing skip and metadata-error log message strings are preserved:

- `Sync skipped — ran recently (cooldown active)`
- `Could not read/write sync metadata — allowing sync to proceed`

**Confirmed log-field detail:** A denied claim retains `syncName` and
`cooldownMinutes`. It no longer logs `ranMinutesAgo`: the atomic statement returns
no row on denial, and fetching that timestamp solely for logging would introduce
a second statement. No replacement elapsed value was invented.

The initial/scheduled RSS failure message strings are also unchanged.

## Red-then-green evidence

### Test 1: real-database concurrency baseline

**Confirmed:** The unchanged implementation was tested first using 20 concurrent
calls, a fresh UUID-based test name and a one-hour cooldown.

| Baseline attempt | Result |
| --- | --- |
| 1 | **18 true out of 20**; assertion expected exactly 1 and failed |
| 2–5 | Not needed: the first attempt demonstrated the race |

No barriers, delays, forced ordering, source changes or altered assertions were
used to manufacture the baseline. After implementation, the same test passed
with exactly one winner.

### Other changed behavior and regression guards

| Check | Before | After |
| --- | --- | --- |
| Database time still enforces cooldown when the application clock jumps to 2099 | Assertion failed: second claim returned true | Pass |
| Denied live claim, default five-minute interval | Assertion failed: provider mock was called | Pass; 80% cooldown checked |
| Denied live claim, custom one-second interval | Assertion failed: provider mock was called | Pass; 800 ms cooldown checked |
| Denied RSS startup claim | Assertion failed: three feed requests occurred | Pass; no feeds or ingestion DB reads |
| Denied recurring RSS claim after allowed startup | Assertion failed: three feed requests occurred | Pass |
| Immediate repeat denied; expired test-row cooldown allows claim | Pass | Pass |
| Database error allows run and logs the existing WARN | Pass | Pass |
| Four existing live-poll post-match tests, unchanged | 4 pass | 4 pass |

**Confirmed total:** Six change-verifying assertion failures before; six passing
regression checks before. All 12 targeted tests passed afterward.

The live-poll cases also verify that a denied tick does not leave the local mutex
stuck: the next allowed tick calls the provider once. RSS cases verify both
denied startup followed by allowed interval, and allowed startup followed by
denied interval.

**Confirmed test isolation:** Real-database cases use unique synthetic sync
names and delete only those names. Scheduler tests mock the claim function,
database, provider fetch and RSS parser; they never write `livePoll`, `rssIngest`
or other running-server cooldown names to the database.

No existing standalone syncGuard/RSS tests were found before this work; the new
cooldown/error regression guards were verified green against the unchanged
implementation. Existing live-poll tests were not edited.

## Verification

- **Confirmed:** Lint passed, with zero errors and eight existing warnings.
- **Confirmed:** Root typecheck passed.
- **Confirmed:** Full workspace build passed.
- **Confirmed:** Full API suite passed: 911 tests across 115 files.
- **Confirmed:** Full frontend suite passed: 285 tests across 19 files.
- **Confirmed:** Development API workflow restarted successfully. Health and
  dashboard requests returned HTTP 200 with valid JSON; the dashboard screenshot
  rendered successfully.
- **Confirmed browser-log observation:** The development preview retained its
  previously observed blocked inline scripts under CSP and one resource 404.
  No security policy was changed to suppress them.
- Local API suites use file parallelism disabled because existing fixture/event
  tests share the development database.
- Commit hash and GitHub CI result are recorded in the final delivery.

## Files changed

- `artifacts/api-server/src/lib/syncGuard.ts`
- `artifacts/api-server/src/lib/apiFootballSync.ts`
- `artifacts/api-server/src/lib/rssIngest.ts`
- `artifacts/api-server/src/lib/__tests__/syncGuard.test.ts`
- `artifacts/api-server/src/lib/__tests__/scheduledSyncClaims.test.ts`
- `reports/prompt31-atomic-sync-claims.md`
- `.agents/memory/shared-db-test-writers.md` — retain the user's unique-test-name
  isolation requirement for future claim tests.

The already-modified Library asset metadata present at the start of this request
is unrelated and is not included in the implementation commit.

## Limits

**Confirmed:** No production application/database access and no publishing.

**Unable to verify without running the application in an actual autoscaled
deployment:** Timing across deployed instances. The real-database concurrency
test exercises the shared PostgreSQL claim mechanism directly with 20 concurrent
calls; scheduler behavior is tested with denied/allowed mocked claims.

**Confirmed retained tradeoff:** Database failure intentionally allows the run.
This is a cooldown guard, not a renewable lease guaranteeing exclusive execution
for arbitrarily long-running jobs.
