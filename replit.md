# USMNT Tracker

Tracks US Men's National Team players worldwide — news, fixtures, stats, injuries, transfers, and prospects.

## Scope — read this first

This application tracks the United States MEN'S National Team. Women's
players, women's clubs, and women's competitions (NWSL, women's UEFA
competitions, SheBelieves Cup, and any other women's league or team) are
out of scope everywhere in this codebase — discovery, candidates, clubs,
fixtures, stats, and display.

A regression test (`womensTeamExclusion.test.ts`) enforces this at both
admission points that could otherwise let a women's team into the pool.
If you are changing code near club or player ingestion and that test
starts failing, the fix is to exclude the offending data, not to weaken
or delete the test.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port **8080**)
- `pnpm --filter @workspace/usmnt-tracker run dev` — run the frontend (port varies; proxies `/api` to port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm run lint` — ESLint across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required env: `DATABASE_URL` — Postgres connection string

### Local setup — three processes

Running the full stack locally requires three things running simultaneously:

1. **PostgreSQL** — Replit provisions this automatically in the workspace. Outside Replit, set `DATABASE_URL` to a local Postgres instance (e.g. `postgresql://localhost:5432/usmnt_tracker`).
2. **API server** — `pnpm --filter @workspace/api-server run dev` (listens on **port 8080**)
3. **Frontend dev server** — `pnpm --filter @workspace/usmnt-tracker run dev` — Vite proxies `/api` to `localhost:8080`. The proxy target is hardcoded in `vite.config.ts`; if you change the API port, update it there too.

### Database migrations

Migrations live in `lib/db/drizzle/`. **See `lib/db/README.md` for the full
workflow** — including how to add a migration, why `push` must not be used,
and the production situation.

Quick reference:
```sh
# Add a migration after editing src/schema/
cd lib/db
node_modules/.bin/drizzle-kit generate --name=<description> --config=./drizzle.config.ts
node_modules/.bin/drizzle-kit migrate --config=./drizzle.config.ts   # apply to dev
```

**Production:** `drizzle-kit migrate` must NOT be pointed at production — the
`__drizzle_migrations` table does not exist there and migrate would try to
recreate all existing tables. Production receives schema changes via Replit's
Publish flow, which computes a **schema diff** between dev and production and
generates DDL from it — **it does not execute migration files**. This means
DDL crosses over; DML (DELETE, UPDATE, backfills) does **not** — data changes
written into a migration file silently never reach production. Data changes
must be applied by hand through the Replit database console (the agent's
`executeSql` with `environment: "production"` is read-only and cannot do this).
See `lib/db/README.md` for the full explanation and a worked example.

**`drizzle-kit push` must never be used** against dev or production — it
bypasses migration history. The CI service container is the sole exception:
it is created from scratch on each run and has no migration history to preserve.

---

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (API), Vite (frontend)

---

## Where things live

| What | Where |
|---|---|
| **DB schema** (source of truth) | `lib/db/src/schema/` — Drizzle schema files; `lib/db/drizzle/` for generated migration SQL |
| **API contract** (source of truth) | `lib/api-spec/openapi.yaml` — OpenAPI 3 spec; codegen produces typed hooks in `lib/api-client-react/` and Zod schemas in `lib/api-zod/` |
| **API server** | `artifacts/api-server/src/` — routes under `src/routes/`, business logic and sync jobs under `src/lib/` |
| **Frontend** | `artifacts/usmnt-tracker/src/` — React SPA, Vite build, pages under `src/pages/`, components under `src/components/` |
| **Theme / design tokens** | `artifacts/usmnt-tracker/src/index.css` — CSS custom properties; `artifacts/usmnt-tracker/tailwind.config.ts` |
| **Background sync jobs** | `artifacts/api-server/src/lib/apiFootballSync.ts` (club fixtures, hourly), `rssIngest.ts` (news, 15 min), `playerClubSync.ts` (club assignments, daily), `usmntSync.ts` (NT stats + sentinel promotion, hourly) |
| **Seed scripts** | `scripts/src/seedUsmnt.ts` and related one-off scripts |
| **Security** | `threat_model.md` (root) |
| **DB workflow** | `lib/db/README.md` |

---

## Architecture decisions

- Player roster, clubs, fixtures, stats, injuries, and transfers are seeded data (`scripts/src/seedUsmnt.ts`) — no live API populates these directly yet.
- **News is live:** `artifacts/api-server/src/lib/rssIngest.ts` pulls free public RSS feeds (BBC Sport, Google News searches for USMNT/ESPN) on a 15-min schedule, keeps only articles naming a tracked player or the senior men's national team, dedupes by URL, and caps inserts per run at 25 to avoid flooding the feed with noise.
- **Club fixtures are live** via API-Football (`artifacts/api-server/src/lib/apiFootballSync.ts`, hourly sync, started from `index.ts`).
- **National-team fixtures** are curated/seeded with the sentinel system — see the Sentinel Fixture System section below.
- **Player club assignments are live** via `artifacts/api-server/src/lib/playerClubSync.ts` (daily): resolves each player's API-Football ID via their club's squad list or a name-search fallback, checks transfer history, and updates `clubId` + inserts a confirmed `transfers` row when they've moved to a tracked club. A move to an untracked club is logged and the last-known club is kept rather than guessing.

---

## Sentinel fixture system

NT (national team) fixtures are curated rather than synced from API-Football, because API-Football publishes them weeks or months after they are announced, and the app should show them immediately.

**How it works:**

1. Announced NT fixtures are seeded into the `fixtures` table with a **negative** `api_football_fixture_id` (e.g. `-1`, `-2`). These sentinels appear in the app immediately, with a real kickoff time, opponent, and venue — they just lack an API-Football match ID.

2. **`syncNationalTeamFixtures()`** (hourly, in `lib/usmntSync.ts`) is the primary binding path. For every unbound sentinel, it matches against the USMNT fixture list from API-Football using a **±1-day date window**. On a match it writes the real positive `api_football_fixture_id`, status, scores, and logo URLs in a single UPDATE.

3. **`promoteNtSentinelIds()`** (also hourly, in `lib/usmntSync.ts`) is the post-match fallback — for cases where API-Football published the fixture after the match was played, or the ±1-day window was missed. It queries match logs (which carry the real fixture ID) within a **±2-day window** of each sentinel's kickoff, processes sentinels **`ORDER BY kickoff ASC`**, and updates any unbound row it can resolve.

**Why both window size and ordering are load-bearing:**

Two distinct corruption paths were found and fixed:

- **Unordered processing (forward-direction corruption):** The Sept 26 and Sept 29 2026 friendlies are 3 days apart. Their ±2-day windows overlap on Sept 27–28. Without `ORDER BY kickoff ASC`, PostgreSQL may return the later sentinel first; it claims the Sept 26 log and writes the wrong ID while the correct fixture stays unbound at kickoff — silent data corruption.

- **Window too wide (reverse-direction corruption):** A window larger than 2 days (the original ±7-day implementation) lets the earlier sentinel reach a log from the later match (3 days away, still inside ±7). `ORDER BY ASC` only prevents the later fixture from claiming an earlier log; it does not prevent the earlier sentinel from over-reaching forward. ±2 days keeps the windows tight enough that a log from one match cannot be in scope for a different match's sentinel, except in the narrow overlap zone where ordering resolves ambiguity.

**Do not widen the ±2-day window or remove the ORDER BY** without understanding both of the above failure modes.

---

## Deployment

The app runs as **Autoscale** on Replit at `https://usmnt-tracker.replit.app`.

Current `.replit` setting: `deploymentTarget = "autoscale"`.

### Reserved VM (task 7C) — evaluated and declined

We evaluated switching to Reserved VM (`deploymentTarget = "vm"` — note: `"vm"`, not `"reserved_vm"`) and decided against it for now.

**What it would buy:**
- Syncs running on real independent hourly intervals rather than clustering at process wake-ups
- A single long-lived API-Football rate-limit budget (no per-process re-accumulation)
- Reliable live-score polling during matches without cold-start gaps

**Why we declined:**
- Every sync runs immediately on cold start, gated by `syncGuard`'s cooldown. Opening the app on a cold instance triggers a sync; the refreshed data lands a view or two later, which is acceptable for schedule and streaming information.
- Live scoring during matches is a secondary feature, not the app's purpose.
- The longer-term migration plan targets a host with persistent processes anyway — paying for always-on twice makes no sense.

**Cost:** 0.5 vCPU / 2 GiB RAM Reserved VM = **~$15.18/month flat** (Aug 2026 pricing: $0.0208/hr × 730 hr). Autoscale is usage-based ($1/month base + $0.60/M compute units + $0.40/M requests) and cheaper at this app's traffic levels.

**Rollback if revisiting:** change `deploymentTarget` in `.replit` from `"autoscale"` to `"vm"` and redeploy. No data or application code changes needed.

---

## Deferred work

These items are explicitly scoped out but documented here so they can be picked up with full context:

1. **`seedYouthNtFixtures.ts`** — Youth NT fixtures are seeded via raw SQL inside `artifacts/api-server/src/index.ts`'s startup seed block (not in `scripts/src/seedUsmnt.ts`, the main seed script). Extract them into a dedicated `scripts/src/seedYouthNtFixtures.ts` to make the seeding auditable and re-runnable without touching server startup.

2. **CI: `drizzle-kit migrate` instead of `push`** — The CI pipeline currently runs `drizzle-kit push` against the test DB, which bypasses migration files. Switching to `migrate` would exercise the generated SQL before production ever sees it. Blocked on ensuring the CI DB has the `__drizzle_migrations` table.

3. **Upload e2e test not in CI** — The invoice upload end-to-end test requires real GCS credentials (the object-storage sidecar) and a pre-seeded admin session. It must NOT use a rate-limit bypass header as a workaround. Until CI has GCS access and a session seed, keep this test local-only and document that it is excluded.

4. **`promoteNtSentinelIds()` cleanup** — This function is removable once all four Sept/Oct 2026 USMNT friendlies have been played and their `fixtures` rows carry confirmed positive `api_football_fixture_id` values. The fast-path short-circuit (returns immediately when no unbound rows exist) makes it nearly free to leave running in the meantime.

5. **Invoice upload file-type and size validation** — Currently missing. Best addressed by proxying uploads through the API server rather than sending them directly from the browser to GCS. Proxying also eliminates the `connect-src https://storage.googleapis.com/<bucket-id>/` CSP exception in `index.html` and removes the frontend's knowledge of the GCS bucket URL.

6. **Sportmonks integration** — Considered but never implemented; `sportmonksSync.ts` was never created. `SPORTMONKS_API_TOKEN` is a configured secret but nothing reads it. If the Sportmonks paid plan is ever purchased, the integration would need to be built from scratch. The secret can be deleted if the plan is no longer being considered.

---

## Product

Dashboard, player pool, fixtures, live news feed, injuries, transfers, and prospect rankings for USMNT players. News is real (RSS-sourced); fixtures, stats, injuries, and transfers are still seeded placeholder data.

---

## User preferences

- Match times on the dashboard should be shown in MST.

---

## Gotchas

- **API server port is 8080, not 5000.** The Vite dev proxy targets `http://localhost:8080`. Confirm this in `artifacts/api-server/.replit-artifact/artifact.toml` and `artifacts/usmnt-tracker/vite.config.ts` if the frontend stops reaching the API.
- **`scripts/src/seedUsmnt.ts` seed rows never reach production via Publish.** Players and clubs defined there are DML (data), not schema — migrations only carry DDL to production through Publish's schema diff. Adding a player to the seed script does not add them to any database. Both dev and production need the row inserted by hand via the database console.

- **After changing `rssIngest.ts`**, restart the workflow to re-run ingestion. If you restart twice in quick succession, the old process may still be mid-insert and can leave one stale/uncleaned row behind — check for and delete duplicates if so.

- **`API_FOOTBALL_KEY` is on a paid plan** (upgraded after the free plan proved unusable — no current-season data, account got suspended under light load). `startApiFootballSyncSchedule()` is live and running hourly. Team-name search is picky about official vs. short names (e.g. "AS Monaco" must be searched as "Monaco") — see `SEARCH_TERM_OVERRIDES` in `apiFootballSync.ts` and `.agents/memory/usmnt-tracker.md` if new clubs fail to resolve.

- **`SESSION_SECRET` exists as a Replit secret but nothing reads it.** It was set during an earlier architecture exploration and is now dead. Recommend deleting it from the Replit secrets panel so operators don't assume it is load-bearing.

- **The ±2-day window and `ORDER BY kickoff ASC` in `promoteNtSentinelIds()` are intentional.** Do not widen the window or remove the ordering — see the Sentinel Fixture System section for the two corruption paths they prevent.

- **`syncGuard`** prevents concurrent duplicate sync runs and enforces cooldown between runs. If a sync appears stuck, check whether a previous run is still in progress before restarting.

---

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- `lib/db/README.md` — full DB migration workflow and production situation
- `threat_model.md` (root) — security architecture, rate limiters, CORS/CSP details
