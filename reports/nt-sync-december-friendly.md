# Prompt 25 — NT schedule details and December Jamaica friendly

## Result and safety

**Confirmed:** the local implementation and development seed are complete.
No production writes, production browser loads, production SQL execution,
or publishing occurred. The sole production data request was a direct
`GET https://usmnt-tracker.replit.app/api/schedule`.

**Confirmed:** five direct API-Football lookups were made in total, including
the initial season-2026 lookup. No season-2027 lookup was needed. Tests of the
sync intercepted fetch rather than making provider requests. At the development
restart, the existing cooldowns skipped the paid startup syncs.

**Confirmed:** pushed commit `cde2ff50d25d34bd94c0ecf934fd45b4761be043`
to `main`. [GitHub CI passed](https://github.com/thetrutru313/usmnt-tracker/actions/runs/39454184999).
The working tree was clean at completion.

## Step 0a — original implementation

**Confirmed:** before this change, `syncNationalTeamFixtures` updated status,
scores, elapsed minute, and, on first bind, the API fixture ID and logos.
It did not update kickoff, `kickoff_time_tbd`, venue, or city. The original
unchanged-row check considered only status, scores, and binding.

## Step 0b — provider evidence and the authorized diagnostic

The first `/fixtures?team=2384&season=2026` response contained 13 fixtures,
neither Haiti leg. Work stopped and the user authorized additional read-only
lookups, with a conditional continuation only if both original IDs still
existed under season 2026 or 2025.

**Confirmed by ID lookups and the upcoming list:** both original IDs exist,
and both belong to **season 2025**. This satisfies the continuation condition.
The existing sync already queries current year and previous year; no fetch
season or binding changes are needed.

| API ID | Home | Away | League ID | League | Season | UTC kickoff | Status | Venue | City |
|---|---|---|---:|---|---:|---|---|---|---|
| 1644693 | Haiti | USA | 536 | CONCACAF Nations League | 2025 | 2026-11-14T21:00:00Z | NS | null | null |
| 1644697 | USA | Haiti | 536 | CONCACAF Nations League | 2025 | 2026-11-18T00:00:00Z | NS | TQL Stadium | null |

**Confirmed:** 1644697 has exactly the required UTC kickoff.
Neither ID was missing or replaced in these responses.

### Every result from `/fixtures?team=2384&next=10`

The endpoint returned **2**, not 10, fixtures:

| ID | UTC kickoff | Opponent | Home–away | League |
|---|---|---|---|---|
| 1644693 | 2026-11-14T21:00:00Z | Haiti | Haiti–USA | CONCACAF Nations League (536), season 2025 |
| 1644697 | 2026-11-18T00:00:00Z | Haiti | USA–Haiti | CONCACAF Nations League (536), season 2025 |

### All 13 results from the original season-2026 query

Sorted here by kickoff for readability; every returned fixture is listed.

| ID | UTC kickoff | Opponent | League |
|---|---|---|---|
| 1503003 | 2026-03-28T19:30:00Z | Belgium | Friendlies (10), season 2026 |
| 1503004 | 2026-03-31T23:00:00Z | Portugal | Friendlies (10), season 2026 |
| 1503008 | 2026-05-31T19:30:00Z | Senegal | Friendlies (10), season 2026 |
| 1502474 | 2026-06-06T18:30:00Z | Germany | Friendlies (10), season 2026 |
| 1489370 | 2026-06-13T01:00:00Z | Paraguay | World Cup (1), season 2026 |
| 1489391 | 2026-06-19T19:00:00Z | Australia | World Cup (1), season 2026 |
| 1539012 | 2026-06-26T02:00:00Z | Türkiye | World Cup (1), season 2026 |
| 1562586 | 2026-07-02T00:00:00Z | Bosnia & Herzegovina | World Cup (1), season 2026 |
| 1570715 | 2026-07-07T00:00:00Z | Belgium | World Cup (1), season 2026 |
| 1628997 | 2026-09-26T20:30:00Z | Peru | Friendlies (10), season 2026 |
| 1629002 | 2026-09-30T00:00:00Z | Chile | Friendlies (10), season 2026 |
| 1629004 | 2026-10-04T02:00:00Z | Mexico | Friendlies (10), season 2026 |
| 1629007 | 2026-10-07T00:00:00Z | Canada | Friendlies (10), season 2026 |

## Steps 0c and 0d — Jamaica

**Confirmed:** no December 13 USA–Jamaica fixture appeared in the season-2026
response or in the upcoming list. This establishes absence from those queried
lists, not absence from every possible provider query.

**Confirmed:** `/teams?name=Jamaica` returned the national team:

- Team ID: **2385**
- Logo: `https://media.api-sports.io/football/teams/2385.png`
- USA logo: `https://media.api-sports.io/football/teams/2384.png`

The requested sentinel is seeded regardless of provider availability. The
existing negative-ID binding path is retained without modification.

## Step 0e — production read-only snapshot

**Confirmed:** the public schedule endpoint selects all `schedule_events`
rows without an event filter and returns raw fixture fields on its attached
fixtures. Its HTTP 200 response showed exactly **14 events**, no
`friendly-dec-2026`, and no existing event using sort order 35.

| Row ID | Bound API ID | UTC kickoff | kickoff_time_tbd | Venue | City |
|---|---|---|---|---|---|
| 4031 | 1644693 | 2026-11-15T00:00:00Z | true | TBD | null |
| 4032 | 1644697 | 2026-11-18T00:00:00Z | false | TQL Stadium | Cincinnati, OH |

These were endpoint-returned database rows, not a production SQL query.
No production changes or subsequent production verification were attempted.

## Task A — implementation

- Extracted a pure update calculation, retaining the existing score, status,
  elapsed-minute, and first-bind ID/logo behavior.
- Added schedule detail updates only for stored `SENIOR`, `scheduled` rows.
- API `NS` plus a different kickoff updates kickoff and clears Time TBD.
  API `TBD` never changes those fields. An unchanged `NS` kickoff also leaves
  Time TBD unchanged, as specified.
- A trimmed, case-insensitive stored `TBD` venue accepts a nonblank API venue,
  together with the API city (null when absent). Other venues/cities stay intact.
- The loop's early-continue check now includes actual schedule-field changes.
- Each changed schedule field receives an INFO log after a successful update,
  containing fixture ID, API ID, field, and old/new values.
- No club or youth runtime logic, fetch coverage, matching/binding algorithm,
  status mapping, or score behavior was changed. The shared provider type only
  gained an optional venue-city property.

**Confirmed consequence of current provider data:** the first Haiti leg can
move from its placeholder to November 14 at 21:00 UTC, with Time TBD cleared.
Its venue remains TBD because the provider's venue is null. The second leg's
known TQL Stadium and Cincinnati city remain protected.

## Task B — December seed and route checks

**Confirmed:** seed data has the exact requested event values and description.
Startup uses the existing match-identity insertion/correction/deduplication
block, adding:

- Sentinel `-2007`, USA home, Jamaica away.
- UTC placeholder `2026-12-14T00:00:00Z`, Time TBD true.
- Inter Miami CF Stadium; Fort Lauderdale, FL.
- International Friendly; senior NT; scheduled.
- USA/Jamaica logos above; TV and streaming both null.
- Window `2026-12-12T00:00:00Z` through `2026-12-16T23:59:59Z`, matching
  -2005's offsets relative to its UTC placeholder.

**Confirmed in development:** the targeted schedule insertion added the event;
the actual API startup then inserted one new fixture. GET `/api/schedule`
returns 15 events and attaches `-2007` to December. The dev screenshot shows
USA vs Jamaica, Time TBD, and Fort Lauderdale, FL, without broadcast text.
The screenshot browser uses UTC, so the specified placeholder displays Dec 14;
no date/time formatting behavior was changed.

### Development schedule after application, ordered by sort order

`null` means an open-ended date.

| Slug | Sort | Start | End | Date label |
|---|---:|---|---|---|
| friendlies-sept-2026 | 10 | 2026-09-26 | 2026-09-29 | Sept 26 & 29, 2026 |
| friendlies-oct-2026 | 20 | 2026-10-03 | 2026-10-06 | Oct 3 & 6, 2026 |
| cnl-qf-nov-2026 | 30 | 2026-11-13 | 2026-11-18 | Nov 14 & 17, 2026 |
| friendly-dec-2026 | 35 | 2026-12-13 | 2026-12-14 | Dec 13, 2026 |
| cnl-finals-mar-2027 | 40 | 2027-03-25 | 2027-03-28 | Mar 25–28, 2027 |
| friendlies-jun-2027 | 50 | 2027-06-07 | null | June 7–15, 2027 (open window) |
| gold-cup-2027 | 60 | 2027-06-18 | 2027-07-11 | June 18 – July 11, 2027 |
| friendlies-sept-2027 | 70 | 2027-09-20 | null | Late Sept 2027 (open window) |
| wcq-r2-2027 | 80 | 2027-09-28 | null | Late Sept 2027 – Mar 2028 |
| wcq-final-jun-2028 | 90 | 2028-05-29 | null | June 2028 |
| copa-america-2028 | 100 | 2028-06-01 | null | Summer 2028 (Pending Invite) |
| cnl-2028-29 | 110 | 2028-09-18 | null | 2028–29 (dates TBA) |
| gold-cup-2029 | 120 | 2029-06-01 | null | June–July 2029 |
| wcq-final-sept-2029 | 130 | 2029-09-24 | null | Sept–Oct 2029 |
| world-cup-2030 | 140 | 2030-06-01 | null | Summer 2030 |

## Test evidence

**Confirmed:** after extracting legacy behavior, but before adding schedule
detail updates, the focused run had **18 passing / 2 failing tests** across
four files. Both requested change cases failed on value assertions:

1. Kickoff remained November 15 instead of the API's November 14 at 21:00 UTC.
2. Venue/city remained TBD/null instead of X/Y.

All five new regression guards passed before the change, including API TBD,
known venue protection, finished-fixture protection, score/binding behavior,
and youth/unclassified schedule protection. The three selected existing NT
test files also passed unchanged before and after.

**Confirmed:** the final full API run passed **863 tests across 110 files**,
including:

- Both requested change-verifying tests, all guards, blank venue handling,
  case/whitespace normalization, unchanged kickoff, and started/postponed games.
- Actual sync with mocked provider responses: schedule-only changes reach the
  database despite unchanged status/scores/binding; all four old/new INFO logs
  are asserted; the previous season is fetched; repeat sync is a no-op.
- Exact December event data and all startup fixture values.
- Actual startup seed idempotency before and after binding.
- Actual GET schedule route attaches -2007 only to the December event.
- Actual dashboard route, with both SQL NOW() and JS Date pinned to November 20,
  selects December and the correct TBD Jamaica fixture.

The existing November **startup** test necessarily changed its exact inventory
from two sentinels to three, retaining all Haiti value/lifecycle assertions.
This is not an NT sync test change or a weakened check. Its expected sentinel
list is now exactly `[-2005, -2006, -2007]`.

During test development, a new dashboard assertion incorrectly expected internal
API-ID/classification columns in its serialized public fixture. The final test
still verifies all those values: public values on the response, internal
identity/classification by looking up the returned fixture ID. It additionally
asserts those internal fields are absent from the public response. No API
contract change or removed check was used.

An initial focused command with an extra script separator ran the entire suite
and hit its command timeout; it is not counted as verification. The corrected
focused invocation produced the red results above, and the final full suite
completed successfully.

| Final check | Result |
|---|---|
| Lint | Passed; 0 errors and 8 unchanged warnings |
| Workspace typecheck | Passed |
| Full API suite | 863 passed; 110 files |
| Full frontend suite | 255 passed; 16 files |
| Recursive workspace build | Passed |
| Dev API restart | Running; startup inserted the new sentinel |
| Dev schedule GET | HTTP 200; 15 events; December fixture present |
| Dev visual check | December card renders with correct teams, TBD, city, and no broadcast |

The screenshot emitted existing CSP inline-script warnings and a resource 404;
neither prevented rendering. Startup also emitted a Node URL deprecation
warning. No unrelated CSP, resource, or deprecation changes were made.

## Files changed

Application:

1. `artifacts/api-server/src/lib/nationalTeamFixtureUpdate.ts` — pure calculation.
2. `artifacts/api-server/src/lib/apiFootballSync.ts` — selected fields, helper,
   early-continue detection, and field-level logs.
3. `artifacts/api-server/src/lib/fixtureReconciliation.ts` — optional city typing.
4. `artifacts/api-server/src/index.ts` — -2007 and nullable broadcast typing.
5. `lib/db/src/seeds/scheduleEventsData.ts` — exact December event.

Tests:

6. `artifacts/api-server/src/lib/__tests__/nationalTeamFixtureUpdate.test.ts`.
7. `artifacts/api-server/src/lib/__tests__/nationalTeamScheduleSync.test.ts`.
8. `artifacts/api-server/src/lib/__tests__/decemberFriendly.test.ts`.
9. `artifacts/api-server/src/lib/__tests__/novemberQuarterfinals.test.ts` —
   expected startup inventory only; all existing Haiti assertions retained.

Documentation: this report, the production SQL file, and a durable provider
season-label note in the existing NT memory topic. Library registration may
also generate report metadata.

## Task C — production SQL, NOT executed

See `reports/december-friendly-production.sql`. It contains exactly one
`DO $dec_friendly$ ... $dec_friendly$;` statement followed by the requested
read-only SELECT. There is no explicit transaction BEGIN/COMMIT or LOCK
statement; the BEGIN inside DO is the required PL/pgSQL body delimiter.

It omits id, raises unless the initial count is 14, raises on an existing
December slug or occupied sort order 35, inserts the exact event, checks
`GET DIAGNOSTICS ... ROW_COUNT = 1`, and verifies the final count is 15.
The full SQL follows for the user to run. It has not been executed by the agent.

```sql
DO $dec_friendly$
DECLARE
  inserted_count integer;
BEGIN
  IF (SELECT count(*) FROM schedule_events) <> 14 THEN
    RAISE EXCEPTION 'Expected exactly 14 schedule_events rows before insertion';
  END IF;

  IF EXISTS (
    SELECT 1 FROM schedule_events
    WHERE slug = 'friendly-dec-2026'
  ) THEN
    RAISE EXCEPTION 'friendly-dec-2026 already exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM schedule_events
    WHERE sort_order = 35
      AND slug <> 'friendly-dec-2026'
  ) THEN
    RAISE EXCEPTION 'Another schedule event already uses sort_order 35';
  END IF;

  INSERT INTO schedule_events (
    slug, name, kind, status, start_date, end_date,
    date_label, sort_order, description
  ) VALUES (
    'friendly-dec-2026',
    'December Friendly',
    'friendly',
    'confirmed',
    '2026-12-13',
    '2026-12-14',
    'Dec 13, 2026',
    35,
    'A one-off friendly against Jamaica on Sunday, December 13, at Inter Miami CF Stadium in Fort Lauderdale, Florida. The match falls outside a FIFA international window. Kickoff time and broadcast details have not been announced.'
  );

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  IF inserted_count <> 1 THEN
    RAISE EXCEPTION 'Expected INSERT 1, got %', inserted_count;
  END IF;

  IF (SELECT count(*) FROM schedule_events) <> 15 THEN
    RAISE EXCEPTION 'Expected exactly 15 schedule_events rows after insertion';
  END IF;
END;
$dec_friendly$;

SELECT slug, sort_order, start_date, end_date, date_label
FROM schedule_events
ORDER BY sort_order;
```

## API call accounting

All were GETs to `https://v3.football.api-sports.io`:

1. `/fixtures?team=2384&season=2026` — 13 fixtures, initial stop.
2. `/fixtures?id=1644693` — original ID exists; season 2025.
3. `/fixtures?id=1644697` — original ID exists; season 2025; required kickoff.
4. `/fixtures?team=2384&next=10` — two Haiti fixtures; no Jamaica.
5. `/teams?name=Jamaica` — national team 2385 and CDN logo.

Skipped: `/fixtures?team=2384&season=2027`, because the upcoming list settled
both Haiti legs. No season-2025 provider request or manual live sync was added;
existing current/prior-season sync coverage was confirmed in code and tested
using mocked responses.

## Unable to verify / not performed

- Whether Jamaica exists outside the two fixture lists queried; no broader
  lookup was authorized or necessary.
- Future provider venue announcements or sentinel binding; those depend on
  later provider data and scheduled sync runs.
- Production behavior of the new code, because it has not been published.
- Execution of the supplied production SQL, deliberately left to the user.
- No original production visitor-record inspection or cleanup was performed.
