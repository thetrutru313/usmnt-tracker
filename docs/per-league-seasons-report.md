# D2: Per-league seasons

## Confirmed: outcome and Git starting point

Implemented the league calendar, recorded seed migration, season-aware player
stats sync, per-player current-season rankings, and API-provided profile labels.

GitHub `main` was verified using the public repository URL and was
`739280924f8c87edeb3e5c4d1b28458874cf9f81`. Local deployment commit
`5aa3a3c3ffb02c93ed5500bc1f91274c2c68e8e9` changed no files. As subsequently
authorized, that commit was retained as the implementation's parent.

The implementation commit hash and push outcome accompany the delivered copy
of this report. Replit's automatic intermediate task checkpoints are
consolidated into the requested one implementation commit, without resetting,
rebasing, dropping, or changing the deployment commit.

## Confirmed: implementation

- Added `league_seasons`, with a unique index on league ID and start date,
  no end date, and no per-league uniqueness constraint on the API season.
- Added nullable `player_stats.api_football_league_id`.
- Added data-only migration `0002_league_seasons`, after `0001_baseline`.
  It inserts exactly the supplied 44 rows using `WHERE NOT EXISTS` and string
  date-only parameters. Supplied dates, names, league IDs, and labels were
  retained.
- Added a warning-and-empty-fallback loader and pure rules for current,
  previous, display, and league-current labels.
- The stats sync loads the calendar once, identifies the primary league
  newest-label-first from current-club blocks, and selects current/previous
  through the new rules. Each season aggregate stores its own primary league.
- All season history remains available. Other callers of
  `seasonYearCandidates()` were not changed.
- Sync diagnostics deduplicate by league ID and label, overwrite
  `leagueSeasons.needsRows` each run, warn once per entry, and cannot change
  the sync result or job health.
- Both season leaderboards join all-club totals to the player's selected
  current-club season. Each listed league uses its started calendar label;
  an unknown future label or unlisted league uses that league's newest
  `season` label. Null-league legacy rows retain the shared-year resolver.
- Rankings no longer return `seasonYear`; the Ironmen heading is
  `Ironmen (Minutes) · Current season`.
- Profiles return `{ season, label }` choices. With no explicit query,
  the selected current-club season is preferred when matching history exists.
  The selector and season heading use the API labels; `formatSeasonLabel`
  was deleted.
- OpenAPI and generated TypeScript/Zod outputs were updated together.

## Confirmed: tests and checks

| Check | Unchanged baseline | Final |
| --- | ---: | ---: |
| API suite | 135 files / 1,048 passed | 138 files / 1,065 passed |
| Frontend suite | 33 files / 352 passed | 33 files / 354 passed |
| Pure Group B guards against stub | 5 passed | 5 passed |
| Focused API rules, database, sync, legacy rankings | — | 24 passed |
| Focused frontend rankings/profile | — | 27 passed |

The initial fail-before run also ran the full unchanged existing suites:
all 1,048 existing API tests and all 352 existing frontend tests still passed.
The API added 17 tests: 12 failed against the scaffold and five passed.
The frontend added two change-verifying tests.

Required final commands passed:

```sh
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/usmnt-tracker run test
pnpm run typecheck
pnpm run lint
bash scripts/check-codegen-drift.sh
```

The drift check ran the required API codegen command and found no generated
differences. Typecheck passed. Lint had zero errors and the same eight
pre-existing `no-explicit-any` warnings.

### Group A: captured failures before implementation

The initial pure-rule scaffold reproduced the old newest-two-label rule,
split display, null league-current label, and null flags. The migration
scaffold was a no-op. No working product code was broken to manufacture a red.

| Test name | Fail-before assertion |
| --- | --- |
| A1 Denmark qualifiers cannot start the league season early | `expected 2026 to be 2025` |
| A2 MLS advances to an unknown label and flags needsRow | Current/previous were 2027/2026, but `flag` was `null`, not `"needsRow"` |
| A3 an unlisted league retains legacy labels and flags unlisted | Current/previous were 2025/2024, but `flag` was `null`, not `"unlisted"` |
| A4 calendar league 253 label 2026 displays 2026 | `expected '2026/2027' to be '2026'` |
| A4 calendar league 253 label 2024 displays 2024 | `expected '2024/2025' to be '2024'` |
| A4 calendar league 489 label 2025 displays 2025 | `expected '2025/2026' to be '2025'` |
| leagueCurrentLabel uses the most recently started row | `expected null to be 2025` |
| A5 migration inserts exactly 44 rows, skips duplicates, and is registered after baseline | `expected [] to have a length of 44 but got +0` |
| A6 Danish sync avoids early UEFA season, stores primary league IDs, and overwrites empty needsRows | Received season `"2026"` without league ID; expected `"2025"` with league ID 119 |
| A7 ranks each league's started season, excludes stale season rows, and uses matching all-club totals | MLS ranked ahead using old 5,000-minute history; expected PL 1,000, MLS 900, PL 800 ordering |
| A8 rankings response omits seasonYear | `expected ... to not have property "seasonYear"`; received `"2099"` |
| A9 profile exposes calendar labels and defaults to the selected current-club season, not early qualifier history | Received `["2099", "2098"]`; expected objects with calendar display labels |
| Frontend A8 labels the Ironmen card Current season | `expect(received).toBeInTheDocument()` failed because the expected heading was absent |
| Frontend A9 shows the MLS API label in the selector and season heading | `expected [Function] to not throw an error` failed because the old renderer tried to render the new season-choice object |

All now pass. The first frontend heading attempt used `getByText`, which
failed during lookup rather than at an assertion; it was changed to
`queryByText` and rerun against unchanged product behavior to capture the
actual assertion failure before implementation.

Group B1–B5 passed against the scaffold and after implementation.
B2's null flag was explicitly checked against the scaffold and passed; it
was not silently moved to Group A. Legacy null-league ranking selection
remains covered by the seven resolver tests and the unchanged
`rankingsSeasonAllFilter.test.ts`.

All new/rewritten database integration tests use one rolled-back transaction
and `LIKE public.<table> INCLUDING ALL` temporary shadows for both
`league_seasons` and `player_stats`, plus `players` and `clubs` where inserted.
Database route tests pin the clock to 2099. The A5 migration necessarily
checks the explicitly supplied 2025/2026 rows. Pure-rule tests retain the
requested real dates, and the mocked A6 sync uses the explicitly requested
2026-07-10 clock.

## Confirmed: every changed existing test

### `rankingsSeasonYearResolver.test.ts`

Old expectations: expose `seasonYear` equal to the shared-year resolver's
selected year, with data from that year in both leaderboards.

New expectations: preserve legacy null-league selection via player membership
and result counts, but omit `seasonYear`. The seven cases still cover
January, August, older-year majority, newer-year majority, empty fallback,
both leaderboards agreeing, and response shape. Rewritten database setup
now uses rollback-only shadows and a pinned 2099 clock instead of public
rows and the older varied clocks.

### `PlayerProfile.test.tsx`

Added the new MLS API-label test. Existing assertions did not change.
The shared fixture's empty `availableClubSeasons` array now has the
`{ season, label }[]` type rather than inferred `never[]`.

### `Rankings.test.tsx`

Added the new Current season heading assertion. Existing assertions did not
change.

### `dataMigrations.test.ts`

Only the baseline import and this call changed, as explicitly authorized:

```ts
// Before
await applyDataMigrations(tx);
// After
await applyDataMigrations(tx, [baseline]);
```

Both original expectations remain exactly:
ledger `["0001_baseline"]`; configuration keys `["dataMigrations.lastBoot"]`.
The dedicated A5 test checks `0002`'s registry position.

### Call-order stats-sync mocks

No business assertion, score expectation, select queue, or select-sequence
comment changed in these files:

- `formTrendBeforeCallUpScore.test.ts`
- `clearedStatsGuard.test.ts`
- `clubSyncFailureFormLabel.test.ts`
- `nationalTeamInjuriesMerge.test.ts`
- `partialSyncPrior5Trend.test.ts`
- `playerSeasonStatsFailure.test.ts`
- `prior5TrendRow.test.ts`
- `seasonHistoryPartialApiGap.test.ts`
- `sixthLogPrevious5Fill.test.ts`
- `staleFormBadgeAfterTransfer.test.ts`
- `tenthLogPrevious5Saturate.test.ts`

The loader is now explicitly mocked to return `[]` without database access.
The ten files after the score test previously passed despite the extra
loader select because their post-roster fallback responses were empty.

The new `server_config` diagnostics insert/upsert is explicitly handled by
a shared test-only proxy, outside the original stats insert mocks.
Other database operations delegate unchanged. This prevents the diagnostics
path from relying on a caught missing-export error or consuming stats-write
queues. Its real sync persistence is exercised by A6, including the empty
list and one calendar load. No additional production `select` or `update`
was added for diagnostics; its one insert uses `ON CONFLICT DO UPDATE`.

### Confirmed diagnostic sequence

A throwaway run logged select calls before and after the loader mock:

| Call | Before mock | After mock |
| ---: | --- | --- |
| 1 | clubs | clubs |
| 2 | players | players |
| 3 | loader select consumed queued allLast5 response; `.from` not reached because the mock lacked the calendar table export | allLast5 |
| 4 | allLast5 consumed allPrevious5 response | allPrevious5 |
| 5 | allPrevious5 consumed allSeason response | allSeason |
| 6 | allSeason consumed activeInjuries response | activeInjuries |
| 7 | activeInjuries consumed freshPlayers fallback | freshPlayers |
| 8 | freshPlayers used fallback again | no call |

Before: eight selects, score 47, unchanged assertion failed.
After: seven selects, unchanged score 84 assertion passed.
Temporary tracing was removed and is not committed.

No other existing tests were changed. Two unexpected existing failures
caused an immediate pause; work resumed only with the user's specific
authorization above.

## Confirmed: exact development schema SQL

Executed once, only in development:

```sql
CREATE TABLE IF NOT EXISTS "league_seasons" (
  "id" serial PRIMARY KEY NOT NULL,
  "api_football_league_id" integer NOT NULL,
  "league_name" text NOT NULL,
  "api_season" integer NOT NULL,
  "display_label" text NOT NULL,
  "start_date" date NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "league_seasons_league_start_unique"
  ON "league_seasons" USING btree ("api_football_league_id", "start_date");
ALTER TABLE "player_stats"
  ADD COLUMN IF NOT EXISTS "api_football_league_id" integer;
```

Result: `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE`.
No `drizzle-kit generate` or applying schema push was run.

### Complete proposed SQL from the preview-only push

```sh
pnpm --filter @workspace/db run push --strict --verbose < /dev/null
```

After schema introspection, the entire proposed SQL was:

```sql
ALTER TABLE "players" ALTER COLUMN "news_aliases" SET DEFAULT '{}'::text[];
```

The preview then stopped with:

```text
Error: Interactive prompts require a TTY terminal
(process.stdin.isTTY or process.stdout.isTTY is false).
```

No confirmation or push application occurred. No unexpected SQL was proposed.

## Confirmed: development boot verification

The normal startup would launch provider syncs after their expired cooldowns.
As separately authorized, the verification process alone omitted
`API_FOOTBALL_KEY` using `env -u`; the saved secret was not read, printed,
changed, or removed. No configuration change is committed.

The API was rebuilt with `NODE_ENV=development`, then started on port 8080
with the key omitted. The health request used Replit's development proxy
(`http://localhost:80/api/healthz`), rather than directly requesting the
service port. It returned HTTP 200 and:

```json
{"status":"ok"}
```

Read-only development queries confirmed:

```text
data_migrations.id: 0002_league_seasons
applied_at: 2026-11-13T23:07:00.667515+00:00
league_seasons row count: 44
```

`server_config['dataMigrations.lastBoot']`:

```json
{
  "startedAt": "2026-11-13T23:07:00.644Z",
  "finishedAt": "2026-11-13T23:07:00.861Z",
  "applied": ["0002_league_seasons"],
  "failed": null,
  "pending": []
}
```

`GET /api/healthz/jobs` returned healthy, with migration summary:

```json
{
  "lastBootAt": "2026-11-13T23:07:00.861Z",
  "failedId": null,
  "pending": []
}
```

### Provider skip and error evidence from `/tmp/api-server.log`

```text
[23:07:00.885] INFO: Server listening
    port: 8080
[23:07:00.887] WARN: API_FOOTBALL_KEY not set — skipping live fixtures sync, using seeded fixtures only
[23:07:00.887] WARN: API_FOOTBALL_KEY not set — skipping USMNT stats sync, no national-team match logs/cycle stats will be available
```

The full log had zero `v3.football.api-sports.io` matches and zero
unhandled/uncaught errors, fatal errors, port conflicts, or crash-loop
indicators. Provider schedules skipped, provider daily jobs were disabled,
and the API client rejects calls without a key before issuing a request.
No API-Football request or real player-stats sync was triggered by this
verification.

The existing Node `url.parse()` deprecation warning appeared; it was not an
unhandled error or a crash. A screenshot showed the Rankings page rendering
and the Current season heading. Existing inline-script CSP refusals and a
404 remained in the browser log; no unrelated fix was made.

### Development job state and other observed startup effects

Before/after read-only queries compared every `sync_metadata` row and all
`server_config` keys matching `job.%.lastRun`.

- No provider claim changed: `fixtures` and `usmntStats` remained at
  2026-11-13 21:47:50 UTC; `playerClub` and `playerStats` claims and successes
  remained unchanged.
- No `job.<name>.lastRun` configuration records existed before or after.
- Only `rssIngest` changed, from `2026-11-13T22:32:50.989812+00:00` to
  `2026-11-13T23:07:00.907533+00:00`. RSS is not API-Football; its normal
  startup ingestion fetched 277 entries and inserted one news item.
- Normal startup logged three inserted youth fixture bootstrap rows.
- The development visual check created an anonymous viewer record
  (`POST /api/follows/users` returned 201).

No claims, job records, or other observed startup effects were cleaned up.
The verification server was stopped afterward; process inspection confirmed
no remaining `node ... dist/index.mjs` process. The development API is
intentionally stopped for Steve to restart normally.

## Expected Publish schema changes

**Confirmed:** The intended schema additions are only:

1. `CREATE TABLE league_seasons`, including its serial primary key.
2. Its unique `(api_football_league_id, start_date)` index.
3. `ADD COLUMN player_stats.api_football_league_id integer`.

The known redundant `players.news_aliases SET DEFAULT '{}'::text[]` may
also appear. Any other Publish statement is unexpected and should be
reviewed before proceeding.

**Unable to verify:** The actual production Publish diff, because production
was not accessed and publishing was not performed. No production schema or
data migration is claimed to have run.

**Confirmed:** No live player-stats sync was run. Existing real development
stats therefore retain null league IDs until Steve's next normal sync.
That is why the legacy rankings fallback remains necessary.

## Files changed

### Schema and migration

- `lib/db/src/schema/leagueSeasons.ts`
- `lib/db/src/schema/index.ts`
- `lib/db/src/schema/stats.ts`
- `artifacts/api-server/src/dataMigrations/0002_league_seasons.ts`
- `artifacts/api-server/src/dataMigrations/index.ts`

### Backend and frontend

- `artifacts/api-server/src/lib/leagueSeasons.ts`
- `artifacts/api-server/src/lib/playerStatsSync.ts`
- `artifacts/api-server/src/lib/queries.ts`
- `artifacts/api-server/src/routes/rankings.ts`
- `artifacts/usmnt-tracker/src/pages/PlayerProfile.tsx`
- `artifacts/usmnt-tracker/src/pages/Rankings.tsx`

### API contract and generated files

- `lib/api-spec/openapi.yaml`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/clubSeason.ts`
- `lib/api-zod/src/generated/types/index.ts`
- `lib/api-zod/src/generated/types/playerProfile.ts`
- `lib/api-zod/src/generated/types/rankings.ts`

### Tests

- `artifacts/api-server/src/lib/__tests__/leagueSeasons.test.ts`
- `artifacts/api-server/src/lib/__tests__/leagueSeasonsDatabase.test.ts`
- `artifacts/api-server/src/lib/__tests__/leagueSeasonsSync.test.ts`
- `artifacts/api-server/src/lib/__tests__/helpers/leagueSeasonConfigMock.ts`
- `artifacts/api-server/src/lib/__tests__/rankingsSeasonYearResolver.test.ts`
- `artifacts/api-server/src/lib/__tests__/dataMigrations.test.ts`
- `artifacts/api-server/src/lib/__tests__/formTrendBeforeCallUpScore.test.ts`
- `artifacts/api-server/src/lib/__tests__/clearedStatsGuard.test.ts`
- `artifacts/api-server/src/lib/__tests__/clubSyncFailureFormLabel.test.ts`
- `artifacts/api-server/src/lib/__tests__/nationalTeamInjuriesMerge.test.ts`
- `artifacts/api-server/src/lib/__tests__/partialSyncPrior5Trend.test.ts`
- `artifacts/api-server/src/lib/__tests__/playerSeasonStatsFailure.test.ts`
- `artifacts/api-server/src/lib/__tests__/prior5TrendRow.test.ts`
- `artifacts/api-server/src/lib/__tests__/seasonHistoryPartialApiGap.test.ts`
- `artifacts/api-server/src/lib/__tests__/sixthLogPrevious5Fill.test.ts`
- `artifacts/api-server/src/lib/__tests__/staleFormBadgeAfterTransfer.test.ts`
- `artifacts/api-server/src/lib/__tests__/tenthLogPrevious5Saturate.test.ts`
- `artifacts/usmnt-tracker/src/test/PlayerProfile.test.tsx`
- `artifacts/usmnt-tracker/src/test/Rankings.test.tsx`

### Report and retained test-safety guidance

- `docs/per-league-seasons-report.md`
- `.agents/memory/test-integrity.md`
