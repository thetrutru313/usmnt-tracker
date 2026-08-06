# USMNT Tracker

Tracks US Men's National Team players worldwide — news, fixtures, stats, injuries, transfers, and prospects.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required env: `DATABASE_URL` — Postgres connection string

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
recreate all 21 existing tables. Production receives schema changes via
Replit's Publish flow. See `lib/db/README.md` for the full explanation and
resolution path.

**`drizzle-kit push` must never be used** against dev or production — it
bypasses migration history.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

- Player roster, clubs, fixtures, stats, injuries, and transfers are seeded fabricated data (`scripts/src/seedUsmnt.ts`) — no live API for these yet.
- News is live: `artifacts/api-server/src/lib/rssIngest.ts` pulls free public RSS feeds (BBC Sport, Google News searches for USMNT/ESPN) on a 15-min schedule, keeps only articles naming a tracked player or the senior men's national team, dedupes by URL, and caps inserts per run at 25 to avoid flooding the feed with noise.
- Club fixtures are now live via API-Football (`artifacts/api-server/src/lib/apiFootballSync.ts`, hourly sync, started from `index.ts`). National-team fixtures/windows stay curated/seeded (out of scope for the sync, lower churn). A Sportmonks sync also exists (`sportmonksSync.ts`) but is unused/not started — see Gotchas.
- Player club assignments are kept current automatically via `artifacts/api-server/src/lib/playerClubSync.ts` (daily, started from `index.ts`): resolves each player's API-Football id (via their on-file club's squad list, or a name search fallback), checks their transfer history, and updates `clubId` + inserts a confirmed `transfers` row when they've moved to a club we already track. A move to an untracked club is logged and the last-known club is kept rather than guessing.

## Product

Dashboard, player pool, fixtures, live news feed, injuries, transfers, and prospect rankings for USMNT players. News is real (RSS-sourced); fixtures/stats/injuries/transfers are still seeded placeholder data.

## User preferences

- Match times on the dashboard should be shown in MST.

## Gotchas

- After changing `artifacts/api-server/src/lib/rssIngest.ts`, restart the workflow to re-run ingestion. If you restart twice in quick succession, the old process may still be mid-insert and can leave one stale/uncleaned row behind — check for and delete duplicates if so.
- `SPORTMONKS_API_TOKEN` is set, but the account is on Sportmonks' Free plan, which only ships sample/demo leagues — none of the leagues the tracked players actually play in (Premier League, Serie A, Bundesliga, Ligue 1, La Liga, Eredivisie, MLS, Champions League). The user declined the paid upgrade (Starter €29/mo covers 5 leagues, Growth €99/mo covers all 8+), so `startSportmonksSyncSchedule()` is deliberately not called from `index.ts`. If the user upgrades later, call it from `index.ts` and it'll resolve club→Sportmonks-team IDs and sync upcoming fixtures automatically.
- `API_FOOTBALL_KEY` is on a paid plan now (upgraded after the free plan proved unusable — no current-season data, account got suspended under light load). `startApiFootballSyncSchedule()` is live and running hourly. Team-name search is picky about official vs. short names (e.g. "AS Monaco" must be searched as "Monaco") — see `SEARCH_TERM_OVERRIDES` in `apiFootballSync.ts` and `.agents/memory/usmnt-tracker.md` if new clubs fail to resolve.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
