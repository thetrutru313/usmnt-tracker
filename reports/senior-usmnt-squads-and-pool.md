# Senior USMNT squads and production-pool comparison

Evidence collected October 7, 2026. Production access was read-only. No players
were added to either pool, and nothing was published.

Commit and GitHub CI details are supplied in the final delivery message.

## Step 0 — findings

| Finding | Result before implementation |
|---|---|
| F1 | **Confirmed:** fixture detail builds `trackedPlayers` from `fixture_players`. |
| F2 | **Confirmed with the user's correction:** three runtime insertion sites were in `apiFootballSync.ts`; the manually run seed script also inserts links. Seeded senior fixtures may have links. |
| F3 | **Confirmed:** `syncUsmntStats` already writes national-team match logs. |
| F4 | **Confirmed:** a fixture with any national-team log is skipped by incremental lineup processing; null/zero-minute entries are not stored. |
| F5 | **Confirmed:** the original national-team repair pass matched competition without matching `nt_level`. |

The four specified production fixtures all had zero links, so the additional
production stop condition was not triggered.

### Squad-source evidence

Exactly one initial request to `/fixtures/players?fixture=1629007` returned:

| Measure | Count |
|---|---:|
| Team blocks | 2 |
| USA players | 26 |
| USA players with minutes greater than zero | 19 |
| USA players with null or zero minutes | 7 |

**Confirmed source:** `/fixtures/players` includes unused substitutes. It is
used for both membership and stats throughout this implementation and report.
No `/fixtures/lineups` call was made.

### Initial production finished SENIOR national-team fixtures

Dates below are the kickoff dates returned by the database query.

| DB ID | API fixture ID | Date | Home | Away | Competition | Links | NT log rows |
|---:|---:|---|---|---|---|---:|---:|
| 1 | 1570715 | 2026-07-09 | USA | Belgium | FIFA World Cup | 5 | 16 |
| 3611 | 1628997 | 2026-09-26 | USA | Peru | International Friendly | 0 | 19 |
| 3772 | 1629002 | 2026-09-30 | USA | Chile | International Friendly | 0 | 18 |
| 3938 | 1629004 | 2026-10-04 | USA | Mexico | International Friendly | 0 | 15 |
| 4081 | 1629007 | 2026-10-07 | USA | Canada | International Friendly | 0 | 16 |

### Initial dev finished SENIOR national-team fixtures

| DB ID | API fixture ID | Date | Home | Away | Competition | Links | NT log rows |
|---:|---:|---|---|---|---|---:|---:|
| 1 | 1570715 | 2026-07-09 | USA | Belgium | FIFA World Cup | 5 | 16 |

## Implementation

- Added only nullable, no-default `fixtures.squad_synced_at` (`timestamptz`).
  Generated migration `0009` and its journal/snapshot; migrated dev only.
- Added `syncSeniorNtSquads` with injectable fixture-player and fixture
  fetchers and clock. Every eligible fixture receives missing log-derived
  links; recent unstamped fixtures receive full-squad reconciliation, capped
  at six in newest-first order.
- Centralized the existing national-team log mapping and retained
  `onConflictDoNothing`. Only positive-minute appearances produce logs.
- Full squads stamp completion. Thin squads remain pending through 72 hours,
  then stamp with a WARN. One fixture's API failure is caught and skipped.
- Cleanup removes only null-club links outside both the tracked squad and
  fixture's national-team logs.
- Scheduled squad sync after stats sync resolves, without changing the
  existing cooldown or interval.
- National-team repair now groups by both competition and age level.
- No fixtures-route, OpenAPI, frontend, or shared-database race changes.

The revised B4 applies: B1 repeats without changes; B2 is a no-op once all
eligible recent fixtures are stamped. Pending capped fixtures and recent thin
squads may retry. Stamped fixtures are excluded from API processing.

## Task E — dev verification

Copied all four absent production fixtures to dev with the same existing
column values and new dev IDs.

### One explicit sync run

| Returned count | Value |
|---|---:|
| Fixtures linked from logs | 5 |
| Links inserted, including B1 and B2 | 104 |
| Fixtures squad-synced | 4 |
| Logs inserted | 0 |
| Links removed | 0 |
| API calls made | 4 |

B1 also repaired the eligible older seeded World Cup fixture, as required.
Zero new logs is the measured result, not an assumed failure.

| Opponent | API fixture ID | Dev ID | Links | With NT log | Without NT log | `squad_synced_at` |
|---|---:|---:|---:|---:|---:|---|
| Peru | 1628997 | 19167 | 23 | 19 | 4 | Set |
| Chile | 1629002 | 19168 | 23 | 18 | 5 | Set |
| Mexico | 1629004 | 19169 | 23 | 15 | 8 | Set |
| Canada | 1629007 | 19170 | 23 | 16 | 7 | Set |

All four timestamps were `2026-10-07T23:16:48.629Z`.

**Confirmed live HTTP check:** `GET /api/fixtures/19170` returned 200 and
23 `trackedPlayers`: 16 with `matchLog`, 7 without. The match page rendered
USA 1–0 Canada and “16 / 23 featured.”

**Confirmed repair result:** the subsequent explicit
`runNationalTeamRepairPass` returned `{ linked: 0 }`; no new link groups exist
to list.

## Task F — squads versus the production pool

Membership below means an exact API player-ID match to a production pool row,
as required. A same-name row with a null API ID does not count as that match.

### F1 — fixture totals

| Opponent | API fixture ID | Squad size | API-ID matched pool members | Unmatched API IDs | Production NT log rows |
|---|---:|---:|---:|---:|---:|
| Peru | 1628997 | 26 | 23 | 3 | 19 |
| Chile | 1629002 | 26 | 23 | 3 | 18 |
| Mexico | 1629004 | 26 | 23 | 3 | 15 |
| Canada | 1629007 | 26 | 23 | 3 | 16 |

Only three unique API IDs were unmatched, below the 15-player stop threshold.

### F2 — unmatched API player IDs

**Confirmed provider/DB results:** birth dates and clubs come from
`/players?id=<id>&season=2026` and `/players/squads?player=<id>`, two additional
requests per player. Current club is the club present in both these responses,
not a youth national team or MLS All-Stars. Candidate lookups were production
read-only queries by API player ID.

| API player ID | Squad name | Position | Birth date | Current club (API team ID) | Production club exists? | Squad membership | Minutes: Peru / Chile / Mexico / Canada | Production candidate / status |
|---:|---|---|---|---|---|---|---|---|
| 102508 | George Campbell | Defender | 2001-06-22 | West Brom (60) | No | All four | 87 / NULL / NULL / 74 | No row / — |
| 486522 | Mathis Albert | Attacker | 2009-05-21 | Borussia Dortmund (165) | Yes, club row 10 | All four | 29 / 19 / 2 / 61 | No row / — |
| 266733 | Brian Schwake | Goalkeeper | 2001-08-24 | Nashville SC (9569) | Yes, club row 327 | All four | NULL / 45 / NULL / 90 | No row / — |

`NULL` preserves the provider's null minutes; it is not a fabricated zero.
West Brom has neither an API-team-ID match nor a matching club-name row in the
production snapshot.

### F3 — null-API-ID pool rows matching squad names

| Confidence | Production pool ID | Pool name | Pool API ID | Same-name squad API ID | Matches |
|---|---:|---|---|---:|---|
| **Likely** | 25 | Mathis Albert | NULL | 486522 | All four |

This is a name match, not an identity confirmation. It was not linked or
updated in either database. The other two production pool rows with null API
IDs did not match a squad name.

## Test evidence and final checks

- **Test 9 red:** before the repair change, the SENIOR → U20 assertion expected
  zero links and received one. This was an assertion failure, not an import
  or missing-function failure.
- **Guard 10 before:** SENIOR → SENIOR copying passed.
- **Existing repair guards before:** both existing repair tests passed unchanged.
- **Existing fixture-route guards before:** eight unchanged tests passed against
  the original HEAD source extracted to a temporary directory; main source and
  assertions were not changed for this baseline.
- **After:** the focused 21-test run passed, including test 9, guard 10,
  tests 1–8, revised test 6, new test 6b, and unchanged fixture/repair guards.
- Both new test files use transaction-local temp tables and rollback. API
  fetchers and clock are injected; new tests make no real API calls.
- Lint: passed, zero errors; eight warnings in unchanged files.
- Workspace typecheck: passed.
- Full API suite: **107 files, 848 tests passed**.
- Full frontend suite: **16 files, 245 tests passed**.
- Workspace build: passed.
- Dev API restarted successfully; existing sync cooldowns remained active.

## API-Football calls

**11 task-initiated calls total:** one source check, four squad fetches during
dev verification, and six missing-player profile/club lookups. No lineup
requests or extra `/fixtures?id=` requests were needed in the measured dev run.
Existing independent background synchronization is not included in this count.

## Files changed

Application/schema/test files:

- `artifacts/api-server/src/lib/usmntSync.ts`
- `artifacts/api-server/src/lib/apiFootballSync.ts`
- `artifacts/api-server/src/lib/__tests__/seniorNtSquads.test.ts`
- `artifacts/api-server/src/lib/__tests__/ntRepairLevel.test.ts`
- `lib/db/src/schema/fixtures.ts`
- `lib/db/drizzle/0009_fixture_squad_synced_at.sql`
- `lib/db/drizzle/meta/_journal.json`
- `lib/db/drizzle/meta/0009_snapshot.json`

Documentation: this report, plus an internal memory index/topic documenting
how to reject truncated data snapshots before reporting results.

## Verification limits

- The new code and schema have not been run in production: publishing and
  production writes were explicitly prohibited.
- Provider squad membership, minutes, birth dates, and current registrations
  are API-reported, not independently verified against federation/club records.
- The dev screenshot rendered successfully but emitted blocked-inline-script
  CSP warnings and one 404 resource warning. Their origin was not investigated;
  no frontend/CSP changes were made.
- Existing startup logs also showed two RSS-feed HTTP 503 warnings. These are
  outside this squad-sync change.
