# Prompt 27 — Season-independent senior USA fixture coverage

## Confirmed outcome

`syncNationalTeamFixtures` now combines the existing current/prior-season
responses with `next=10` and `last=10`, deduplicating by provider fixture ID
before matching, binding, phantom purge, or updates. Each additional fetch has
its own WARN-and-continue handler. The original season handlers are unchanged.

No matching, binding, score, schedule-detail, phantom-purge, scheduler, API
throttle, route, schema, or frontend logic was changed.

Production was not accessed. No publishing was performed.

## Approved clarification

The original test 5 required three surviving fetches to be used and required
that assertion to pass on a baseline making only two fetches. Work stopped
before edits or provider calls. The user approved this split:

- Existing two-season failure isolation: green before and after.
- Expanded four-fetch failure isolation: red before, green after.

No assertion was weakened or removed.

## Step 0a — request inventory before changes

### Senior USA fixture-list consumers

| Consumer | Request | Season-label dependent? |
|---|---|---|
| `apiFootballSync.ts` / `syncNationalTeamFixtures` | `/fixtures?team=${teamId}&season=${currentYear}` and previous year | Yes |
| `usmntSync.ts` / `syncUsmntStats` | `/fixtures?team=${teamId}&last=${fixturesToCheck}`; default 20 | No |
| Same function's fresh-start history branch | `/fixtures?team=${teamId}&last=99` | No |

Both consumers resolve the senior USA ID through `resolveUsmntTeamId`. Its
`/teams?search=USA` result is cached in memory for the process lifetime.

### Individual-fixture consumers that also cover senior USA

| Consumer | Request | Season-label dependent? |
|---|---|---|
| `apiFootballSync.ts` / `pollLiveFixtures` | `/fixtures?id=${row.apiFootballFixtureId}` for bound live fixtures, including NT fixtures | No |
| `usmntSync.ts` / `syncSeniorNtSquads` default fixture fetch | `/fixtures?id=${id}` for pending senior NT squad work | No |

Companion `/fixtures/players?fixture=...` calls retrieve appearances/squads, not
the season-filtered fixture list. They do not use a season label.

The other team-based fixture queries found by the repository search are club
schedule/stat queries and the separate youth-team schedule queries, not an
additional intended senior-USA fixture-list path.

## Step 0b — budget, throttle, retries, caching

**Confirmed from code:**

- Shared reservation queue spaces `afFetch` request starts by 2 seconds.
- The comment documents a 30-requests/minute Pro-plan assumption.
- HTTP 429 retries up to twice; every attempt goes through the same throttle.
- `afFetch` has no fixture-response cache or enforced daily request counter.
- The senior USA team-ID lookup is cached in process.
- The hourly fixtures scheduler has a database-backed 50-minute cooldown to
  suppress repeated startup runs. Manual triggers and retries add requests.
- Club squad caching is a separate six-hour optimization; it does not cache
  senior USA fixture-list responses.

**Nominal daily estimate:** at 24 runs/day, the original two season requests
cost 48 fixture-list calls/day. Four requests cost 96/day: **+48/day**. These
estimates exclude resolver cache misses, retries, manual triggers, and other
jobs. Actual autoscale/cooldown timing can change the number of runs.

**Confirmed from the two authorized evidence responses:** provider headers
reported a 75,000/day limit, over 70,000 requests remaining, and a 450/minute
limit. Those observed headers differ from the code's conservative 30/minute
comment; the throttle was intentionally left unchanged. No documented code
budget would be exceeded by the extra calls. The daily figures are a snapshot,
not a guarantee about future account-wide usage.

An older club-sync comment mentions free-plan restrictions on `next`. The
authorized `next=10` request succeeded for the configured credential.

## Step 0c — authorized read-only provider evidence

Exactly two deliberate external API-Football evidence calls were made, with
over two seconds between them. No credential values are included here.

### GET /fixtures?team=2384&next=10

Returned **2** fixtures:

| ID | Date (UTC) | Match | League | Season |
|---:|---|---|---|---:|
| 1644693 | 2026-11-14 21:00 | Haiti–USA | CONCACAF Nations League | 2025 |
| 1644697 | 2026-11-18 00:00 | USA–Haiti | CONCACAF Nations League | 2025 |

### GET /fixtures?team=2384&last=10

Returned **10** fixtures, all with FT status:

| ID | Date (UTC) | Match | League | Season |
|---:|---|---|---|---:|
| 1629007 | 2026-10-07 00:00 | USA–Canada | Friendlies | 2026 |
| 1629004 | 2026-10-04 02:00 | USA–Mexico | Friendlies | 2026 |
| 1629002 | 2026-09-30 00:00 | USA–Chile | Friendlies | 2026 |
| 1628997 | 2026-09-26 20:30 | USA–Peru | Friendlies | 2026 |
| 1570715 | 2026-07-07 00:00 | USA–Belgium | World Cup | 2026 |
| 1562586 | 2026-07-02 00:00 | USA–Bosnia & Herzegovina | World Cup | 2026 |
| 1539012 | 2026-06-26 02:00 | Türkiye–USA | World Cup | 2026 |
| 1489391 | 2026-06-19 19:00 | USA–Australia | World Cup | 2026 |
| 1489370 | 2026-06-13 01:00 | USA–Paraguay | World Cup | 2026 |
| 1502474 | 2026-06-06 18:30 | USA–Germany | Friendlies | 2026 |

**Unable to verify from these responses:** the eventual March 2027 Finals
records and their actual provider season labels. Neither response contained
them. Future season-2025 scenarios were verified using mocked fixtures.

## Files changed

### Application source

- `artifacts/api-server/src/lib/apiFootballSync.ts`: two independently guarded
  next/last fetches; fixture-ID deduplication; associated input-list comment.

### Tests

- `artifacts/api-server/src/lib/__tests__/nationalTeamFixtureWindows.test.ts`:
  11 new tests using a mocked provider, mocked database writes, and controlled
  clocks. The real sync and request-throttle code execute. Fake timers advance
  throttle waits instead of making the tests sleep.

No existing test was edited.

### Documentation

- `reports/prompt-27-nt-sync.md`: this evidence and verification report.
- `.agents/memory/nt-sentinel-promotion.md`: provider calendar-label constraint
  and the approved baseline-versus-expanded-coverage test distinction.
- Library metadata registers the downloadable report.

## Red-before / green-after evidence

Before changing application code:

- All **74 existing NT-related tests across 12 files passed unchanged**.
- The targeted run also showed the new duplicate guard and both existing
  two-season failure guards passing.
- All **8 change-verifying cases failed at assertions**, not setup errors.

| New case | Before | After |
|---|---|---|
| 2027-01-05: next-only season-2025 postponed status plus venue/city | 0 updates, expected 1 — FAIL | PASS |
| 2027-01-05: next-only NS kickoff, Time TBD, venue/city and detail logs | 0 updates, expected 1 — FAIL | PASS |
| 2027-03-29: last-only FT final status and 2–1 score | 0 updates, expected 1 — FAIL | PASS |
| 2027-03-20: next-only fixture binds a negative sentinel within ±1 day | 0 updates/binds, expected 1 — FAIL | PASS |
| Current-season fetch fails; other three update fixtures | 1 update, expected 3 — FAIL | PASS |
| Previous-season fetch fails; other three update fixtures | 1 update, expected 3 — FAIL | PASS |
| Next fetch fails; other three update fixtures | 2 updates, expected 3 — FAIL | PASS |
| Last fetch fails; other three update fixtures | 2 updates, expected 3 — FAIL | PASS |
| Same fixture in season and next: one update and one fixture-update log | PASS | PASS |
| Current-season failure still permits previous-season processing | PASS | PASS |
| Previous-season failure still permits current-season processing | PASS | PASS |

The four expanded failure cases also assert all four requested paths and
exactly one WARN for the failed fetch. The duplicate check counts the
fixture-update log, not the separate normal completion-summary log.

The postponed case preserves the existing rule that a non-NS API response
does not replace kickoff; the NS case verifies the complete schedule-detail
update behavior. No Prompt 25 schedule logic was changed.

## Verification after changes

| Check | Result |
|---|---|
| Lint | PASS: 0 errors, 8 unchanged warnings |
| Workspace typecheck | PASS |
| Full API suite | PASS: 874 tests across 111 files |
| Full frontend suite | PASS: 255 tests across 16 files |
| Recursive workspace build | PASS |
| Existing NT-related tests | PASS unchanged within the full API suite |
| All 11 new tests | PASS |
| Development API restart | Running on configured port |
| Development Fixtures page screenshot | Rendered successfully |

Existing development CSP inline-script and resource-404 browser warnings were
observed; this backend fetch-only change did not alter that configuration.

The normal development workflow was restarted once. Existing scheduler
cooldowns remain active. Its unrelated automatic background work was not
instrumented to claim an account-wide provider-call total.

No live discovery, future-clock application run, or extra provider query was
used to validate the new tests. Their provider fetches are mocked.

## Delivery

The application change, new tests, report, and relevant documentation are
committed and pushed to `origin main`; the exact commit and completed GitHub CI
result are supplied in the completion message after CI finishes.

Production access: **none**. Publishing: **not performed**.
