# CI & Lint Setup Report

_Generated 2026-08-06_

---

## Task B — ESLint + Prettier

### Packages added (workspace root devDependencies)

| Package | Role |
|---|---|
| `eslint@^9` | Linter engine (flat config) |
| `typescript-eslint@^8` | TypeScript parser + rules |
| `eslint-plugin-react-hooks@^5` | React hooks rules |
| `prettier@^3.9.4` | Formatter (was already present; config added) |

### New files

| File | Purpose |
|---|---|
| `eslint.config.mjs` | Flat ESLint config: typescript-eslint recommended, React hooks rules, `_`-prefix allowance for intentionally unused vars |
| `.prettierrc` | Formatting rules: semi, double quotes, 2-space tabs, trailing commas, printWidth 100 |
| `.prettierignore` | Excludes `dist/`, `pnpm-lock.yaml`, generated OpenAPI client directories |

### New root `package.json` scripts

```
pnpm run lint          # eslint artifacts lib
pnpm run lint:fix      # eslint --fix artifacts lib
pnpm run format        # prettier --write .
pnpm run format:check  # prettier --check .
```

### Lint results after cleanup

| Rule | Errors before | Errors after | Notes |
|---|---|---|---|
| `@typescript-eslint/no-unused-vars` | 70+ | **0** | Removed 30+ stale imports/vars; renamed `_`-prefixed intentional ones |
| `@typescript-eslint/no-require-imports` | 7 | **0** | Suppressed inline on 7 lazy circular-dep `require()` calls; each already carries a "Lazy require avoids circular import" comment in the source |
| `prefer-const` | 3 | **0** | Auto-fixed by `eslint --fix` |
| `@typescript-eslint/prefer-as-const` | 1 | **0** | Auto-fixed |
| `@typescript-eslint/no-unused-expressions` | 1 | **0** | Rewrote ternary-as-statement to `if/else` in `MyPlayersContext.tsx` |
| `react-hooks/exhaustive-deps` (stale disables) | 5 warnings | **0** | Stale `eslint-disable` directives removed |
| `@typescript-eslint/no-explicit-any` | 4 warnings | **4 warnings** | Pre-existing in `follows.test.ts` and `PlayerProfile.tsx`; left as warnings |

**`pnpm run lint` exits 0.**

### Files touched (unused import / var removals)

**API server source**
- `routes/admin.ts` — removed `gte`
- `routes/dashboard.ts` — removed `lte`
- `routes/fixtures.ts` — removed `z` (unused zod import)
- `routes/transparency.ts` — removed `desc`
- `lib/playerClubSync.ts` — removed `sql`; added inline disable for lazy `require()`
- `lib/playerDiscovery.ts` — removed `asc`, `ne`
- `lib/playerStatsSync.ts` — removed `inArray`; added inline disable for lazy `require()`
- `lib/rssIngest.ts` — removed unused `eq` import line
- `lib/apiFootballSync.ts` — added inline disables on 3 lazy `require()` calls
- `lib/nationalTeamSync.ts` — added inline disable for lazy `require()`
- `lib/usmntSync.ts` — added inline disable for lazy `require()`

**API server tests**
- `__tests__/clubSyncFailureFormLabel.test.ts` — renamed `ON_FIRE_STATS_ROWS` → `_ON_FIRE_STATS_ROWS`
- `__tests__/commitmentSweep.test.ts` — renamed `whereResult` → `_whereResult`
- `__tests__/commitmentTracker.test.ts` — removed unused `evaluateFlagConditions` import
- `__tests__/formBadgeAfterSync.test.ts` — removed `injuriesTable`, `transfersTable`
- `__tests__/friendlySeedLifecycle.test.ts` — removed `and`, `gte`, `lte`
- `__tests__/phantomYouthNtFixturePurge.test.ts` — removed dead `const now = new Date()`
- `__tests__/playerIdResolverNationalityGate.test.ts` — renamed `player` → `_player`
- `__tests__/prior5TrendRow.test.ts` — renamed `statsInserts` → `_statsInserts`
- `__tests__/purgeStaleFixtureLinks.test.ts` — renamed `linkExists` → `_linkExists`; `playerId` param → `_playerId`
- `__tests__/weightDriftStartup.test.ts` — removed unused `getMinEligibilityScore` import; renamed `setupSelectSequence` → `_setupSelectSequence`

**Frontend**
- `hooks/use-toast.ts` (usmnt-tracker + mockup-sandbox) — added inline disable for `actionTypes` (shadcn pattern: const used only via `typeof`)
- `context/MyPlayersContext.tsx` — rewrote ternary expression statement to `if/else`
- `pages/MatchDetail.tsx` — added inline disable for unused `PlayerRow` component definition
- `pages/PlayerProfile.tsx` — removed `ChevronRight` from lucide import
- `pages/Schedule.tsx` — removed `ChevronRight` from lucide import
- `pages/Transparency.tsx` — removed dead `const net = ...` assignment

**lib/db**
- `seeds/scheduleEvents.ts` — removed unused `sql` import

---

## Task C — CI Workflow

### File updated: `.github/workflows/codegen-drift.yml`

Key changes from the original:

| Setting | Before | After |
|---|---|---|
| Job name | `codegen-drift` | `ci` |
| Node version | `"20"` | `"24"` |
| Postgres service | none | `postgres:16` with health check |
| Steps | codegen drift only | drift → lint → typecheck → build → schema push → api-server tests → frontend tests |

### Full workflow summary

```
on: push / pull_request (all branches)

services:
  postgres:16
    POSTGRES_DB: usmnt_test
    health: pg_isready

env:
  DATABASE_URL: postgres://postgres:postgres@localhost:5432/usmnt_test
  SESSION_SECRET: ci-placeholder-session-secret   # replace with ${{ secrets.SESSION_SECRET }}
  ADMIN_PASSWORD: ci-placeholder-admin-password   # replace with ${{ secrets.ADMIN_PASSWORD }}
  PORT: 5173
  BASE_PATH: /

steps:
  1. Checkout
  2. Node 24
  3. pnpm 10
  4. Cache pnpm store
  5. pnpm install --frozen-lockfile
  6. bash scripts/check-codegen-drift.sh
  7. pnpm run lint
  8. pnpm run typecheck
  9. pnpm run build
  10. pnpm --filter @workspace/db run push   (schema → CI postgres)
  11. pnpm --filter @workspace/api-server run test
  12. pnpm --filter @workspace/usmnt-tracker run test
```

---

## Seeding decision required — 3 CI test files will fail

The api-server test step (step 11) will fail on a fresh schema-only database until you decide on a seeding strategy. These three files were written against the dev database and rely on rows that don't exist in a clean CI database:

| Test file | CI failure | What it needs |
|---|---|---|
| `coleCampbellNoStatsGraceful.test.ts` | `"Cole Campbell not found in players table — was the seed run?"` | A `players` row for Cole Campbell |
| `recoveryRoundTrip.test.ts` | `"No players found in the database — recovery-round-trip test requires at least one seeded player row."` | ≥1 `players` row |
| `rescoreCapOrderingIntegration.test.ts` | FK violation: `player_candidates_club_id_clubs_id_fk` — `club_id=1` not in `clubs` | A `clubs` row with `id = 1` |

### Options

**Option A — Self-contained fixtures (recommended)**  
Convert each test to insert and clean up its own rows via `beforeEach`/`afterEach`. No shared state; safe for parallel runs. More work per file but removes the fragile dependency on the dev DB.

**Option B — Shared CI seed script**  
Add `pnpm --filter @workspace/db run seed:ci` as step 10a. The script inserts the minimum rows all three tests need and is safe to run on a fresh schema. Faster to implement; rows are shared across tests.

The CI workflow comment (`# NOTE: 3 test files require seeded rows…`) points here.

---

## Verification (all run locally before this report)

| Command | Result |
|---|---|
| `pnpm run lint` | ✅ 0 errors, 4 warnings |
| `pnpm run typecheck` | ✅ exit 0 |
| `pnpm run build` | ✅ Vite build complete |
| `pnpm --filter @workspace/usmnt-tracker run test` | ✅ 212 / 212 pass |
| `pnpm --filter @workspace/api-server run test` | ✅ 712 / 712 pass (real dev DB) |
