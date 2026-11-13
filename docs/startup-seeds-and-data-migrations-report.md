# Startup fixture seeds and recorded data migrations

## Confirmed: completed scope

- Extracted the senior and youth startup fixture lists into
  `artifacts/api-server/src/lib/ntFixtureSeeds.ts`.
- Exported `MatchDef`, `SENIOR_SENTINEL_FIXTURES`,
  `seedSeniorSentinelFixtures(db, matches = SENIOR_SENTINEL_FIXTURES)`,
  `YOUTH_NT_BOOTSTRAP_FIXTURES`, and `seedYouthNtBootstrapFixtures(db)`.
- Senior fixture values, the senior insert/correct/dedup/retire SQL and log body,
  and all six youth row values were compared with the original and matched.
  Existing comments, including EST notes, logo/API IDs, KEEP, and Removable when,
  were retained. Youth values now feed the same INSERT columns and
  `ON CONFLICT (api_football_fixture_id) DO NOTHING` behavior.
- The entrypoint contains no fixture data. Migration application is awaited
  through `runNonFatal` before the senior seed and before listening. The senior
  seed remains awaited and non-fatal. Youth bootstrap remains fire-and-forget
  inside the listen callback.
- Added the schema ledger and a data-only migration runner. The only registered
  migration is the no-op `0001_baseline`.
- Migration IDs are checked for uniqueness and strict ascending order before
  executing any migration. Every pending ID runs in its own transaction under
  fixed advisory transaction lock key `739067431`, with an after-lock record
  re-check. Migration work and its ledger insert commit or roll back together.
  A failure preserves earlier commits, rolls back the failed migration, stops
  later ones, logs the failure, and does not stop the server.
- Each boot persists `startedAt`, `finishedAt`, applied IDs, failed ID/error,
  and pending IDs in `server_config` at `dataMigrations.lastBoot`.
  Missing `data_migrations` is a logged failure, not a trigger for startup DDL.
- Job health reads that key and adds
  `dataMigrations: { lastBootAt, failedId, pending }`. A migration failure makes
  the endpoint unhealthy/503; a missing key is healthy. Error text is not
  included in the public migration health summary.
- Added a short migration-authoring README. It requires next-number ordering,
  guarded/idempotent SQL, string date-only values, immutable main-branch
  migrations, and editing the canonical sentinel list rather than using a data
  migration to change sentinel fields.

## Confirmed: baseline and final results

The full API baseline ran unchanged before any edits, including the original
public-table lifecycle guard, as expressly approved. The frontend baseline also
ran before changes.

| Check | Before | After |
| --- | ---: | ---: |
| Full API suite | 132 files / 1,037 passed | 135 files / 1,048 passed |
| Full frontend suite | 33 files / 352 passed | 33 files / 352 passed |
| `novemberQuarterfinals.test.ts` | 3 passed | 3 passed |
| `decemberFriendly.test.ts` | 5 passed | 5 passed |
| `friendlySeedLifecycle.test.ts` | 1 passed | 1 passed |
| New migration/health tests | 11 assertion failures before implementation | 11 passed |

Final required commands:

```sh
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/usmnt-tracker run test
pnpm run typecheck && pnpm run lint
```

All passed. Lint reported eight existing `no-explicit-any` warnings in untouched
files and zero errors. Typecheck built the shared library declarations first.

The focused post-implementation run covered six files and all 20 tests passed:
the 11 new tests plus all nine fixture guards.

### Confirmed: guard implementation and isolation

`friendlySeedLifecycle.test.ts` previously copied INSERT and dedup SQL rather
than calling the real seed. It now calls the shared function with its own
test-only match list. Its pre-seed, first seed, positive-ID bind, restart,
and dedup checks remain, along with its other product assertions.

The lifecycle test now runs entirely within a rolled-back transaction with
**both `fixtures` and `fixture_players` temp-table shadows**. The real seed's
retirement of unlisted sentinels cannot touch public dev fixtures or their links.

The November/December guards now import the real function instead of reading,
slicing, transpiling, and evaluating the entrypoint. Their product assertions
and pinned 2026 dates/clocks remain unchanged. Only the obsolete source-slice
boundary checks were removed together with the source-extraction machinery.

All new or rewritten database tests use rolled-back transactions and
`CREATE TEMP TABLE ... (LIKE public.... INCLUDING ALL) ON COMMIT DROP` for every
table they control. New time-relevant test values use 2099. Existing guards
retain their specified dates, as approved.

### Confirmed: each new test's fail-before output

The red run used an inactive, typed runner scaffold solely to make behavior
assertions executable before implementation, rather than fail on missing imports.
The health endpoint was still unchanged. All 11 failures were assertions:

| New test | Captured fail-before output |
| --- | --- |
| a: pending migrations apply in order and second run applies nothing | `expected [] to deeply equal [ '0001_one', '0002_two' ]` |
| b: failure rollback, earlier work retained, later IDs stopped | `expected [] to deeply equal [ '0001_ok' ]` |
| c: unsorted list rejected and failure reported | `expected null to match object { applied: [], failed: { …(2) }, …(1) }` |
| c: duplicate ID list rejected and failure reported | `expected null to match object { applied: [], failed: { …(2) }, …(1) }` |
| d: recorded IDs skipped even if their code now throws | `expected [ '0001_recorded' ] to deeply equal [ '0001_recorded', '0002_new' ]` |
| Default baseline migration is recorded without application data changes | `expected [] to deeply equal [ '0001_baseline' ]` |
| e: record re-check occurs after advisory lock | `expected [] to deeply equal [ 'lock', 'recheck' ]` |
| Missing ledger is reported without creating a table | `expected undefined to be defined` |
| f: failed boot produces 503 with IDs and no error text | `expected 200 to be 503 // Object.is equality` |
| f: successful boot produces 200 with migration summary | `expected undefined to deeply equal { …(3) }` |
| f: absent key produces 200 with null boot and no failure | `expected undefined to deeply equal { lastBootAt: null, …(2) }` |

All these tests subsequently passed without weakening their assertions.
The lock test is a unit-level simulated peer commit, not a race between two
connections against the shared dev database.

**Existing jobHealth/healthz tests modified: none.** Review found no existing
whole-response expectation for `/api/healthz/jobs` that needed extending.
The whole-response plain `/api/healthz` assertion remains unchanged.
`/healthz/jobs` was not in the OpenAPI spec and was not added to it.

## Confirmed: development schema change

The normal initial Drizzle preview proposed the new table plus an unrelated
`players.news_aliases` default statement. No statements were applied by a push.
Table-filtered previews also proposed unrelated enum/sequence drops and were
not applied. The temporary filtered config was removed.

Following explicit approval, the following Drizzle-generated SQL was applied
**to development exactly once**, using the development SQL interface:

```sql
CREATE TABLE "data_migrations" (
"id" text PRIMARY KEY NOT NULL,
"description" text NOT NULL,
"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
"duration_ms" integer
);
```

No other schema SQL was applied. No schema push or filtered push applied
anything during this task.

### Confirmed: approved read-only default check

After that CREATE, ran:

```sql
SELECT column_default
FROM information_schema.columns
WHERE table_name = 'players' AND column_name = 'news_aliases';
```

Result:

```text
'{}'::text[]
```

### Confirmed: complete normal post-CREATE preview statement list

Ran the normal, unfiltered Drizzle push in preview-only mode:

```sh
pnpm --filter @workspace/db run push --strict --verbose < /dev/null
```

Its **entire proposed SQL statement list** was:

```sql
ALTER TABLE "players" ALTER COLUMN "news_aliases" SET DEFAULT '{}'::text[];
```

`data_migrations` no longer appeared. There were no drops or other statements
in this normal post-CREATE preview. The noninteractive strict confirmation
stopped the command with “Interactive prompts require a TTY terminal”; the
statement was not applied.

### Expected Publish change

**Confirmed:** The schema feature introduced by this task is only
`CREATE TABLE data_migrations` with the four columns above. No existing schema
declaration was changed.

**Unable to verify the actual production Publish diff:** production was not
accessed. The residual default statement in the dev preview is documented
above; do not assume a future Publish UI can contain no other drift.
No production data migration was run or claimed to have run.

## Confirmed: development startup and health

The dev API was rebuilt and restarted after the server changes. Startup recorded:

```text
Data migrations boot complete
applied: ["0001_baseline"]
failedId: null
pending: []
```

Read-only dev verification returned:

```text
id: 0001_baseline
applied_at: 2026-11-13 20:00:34.971264+00
```

The dev `dataMigrations.lastBoot` value was:

```json
{
  "startedAt": "2026-11-13T20:00:34.937Z",
  "finishedAt": "2026-11-13T20:00:34.984Z",
  "applied": ["0001_baseline"],
  "failed": null,
  "pending": []
}
```

`GET /api/healthz/jobs` returned HTTP 200 with:

```json
{
  "lastBootAt": "2026-11-13T20:00:34.984Z",
  "failedId": null,
  "pending": []
}
```

`GET /api/healthz` also returned HTTP 200 and `{"status":"ok"}`.
The development dashboard screenshot rendered successfully.

## Files added or changed for this task

### Schema

- `lib/db/src/schema/dataMigrations.ts`
- `lib/db/src/schema/index.ts`

### Migration implementation and authoring documentation

- `artifacts/api-server/src/dataMigrations/types.ts`
- `artifacts/api-server/src/dataMigrations/0001_baseline.ts`
- `artifacts/api-server/src/dataMigrations/index.ts`
- `artifacts/api-server/src/dataMigrations/README.md`
- `artifacts/api-server/src/lib/dataMigrations.ts`

### Startup and health

- `artifacts/api-server/src/lib/ntFixtureSeeds.ts`
- `artifacts/api-server/src/index.ts`
- `artifacts/api-server/src/lib/jobHealth.ts`

### Tests

- `artifacts/api-server/src/lib/__tests__/dataMigrations.test.ts`
- `artifacts/api-server/src/lib/__tests__/dataMigrationsLock.test.ts`
- `artifacts/api-server/src/lib/__tests__/dataMigrationHealth.test.ts`
- `artifacts/api-server/src/lib/__tests__/novemberQuarterfinals.test.ts`
- `artifacts/api-server/src/lib/__tests__/decemberFriendly.test.ts`
- `artifacts/api-server/src/lib/__tests__/friendlySeedLifecycle.test.ts`

### Report and retained safety guidance

- `docs/startup-seeds-and-data-migrations-report.md`
- `.agents/memory/test-integrity.md`
- `.agents/memory/shared-db-test-writers.md`
- `.agents/memory/drizzle-preview-safety.md`
- `.agents/memory/MEMORY.md`

## Skipped, limitations, and out-of-scope observations

- **Confirmed:** No production access or publishing. No seed scripts were run.
  `scheduleEventsData.ts`, seed scripts, `apiFootballSync.ts`, season handling,
  and `promoteNtSentinelIds` were not changed. Existing schedule seed constants
  were only imported by existing guard tests into their isolated temp tables.
- **Confirmed:** No migration other than `0001_baseline`; no historical hand-run
  SQL was converted. No startup application of schedule events was added.
- **Confirmed:** The source's older senior KEEP comment still refers to
  September/October and four sentinels; it was preserved as requested rather
  than rewritten during extraction.
- **Confirmed:** Existing pg client query-serialization and Node `url.parse`
  deprecation warnings appeared. Existing lint warnings remained. The dev
  screenshot logged inline-script CSP refusals and a 404 while the dashboard
  still rendered. These were not changed.
- **Confirmed:** Earlier frontend workflow history contained Vite load errors
  for generated API client files. The final dev dashboard loaded successfully.
  **Unable to verify:** the exact cause of the originally reported runtime
  crash was not reproduced during this task; no claim is made that an unrelated
  frontend defect was diagnosed by these server changes.

## For Steve after publishing: read-only verification

```sql
SELECT id, applied_at FROM data_migrations ORDER BY id;
SELECT value FROM server_config WHERE key = 'dataMigrations.lastBoot';
```

Expect `0001_baseline` in the ledger and no failed or pending migration IDs.
