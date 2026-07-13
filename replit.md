# USMNT Tracker

Tracks US Men's National Team players worldwide — news, fixtures, stats, injuries, transfers, and prospects.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

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
- Fixtures/stats are still seeded data. Two live-sync implementations exist but neither is started (see Gotchas): `artifacts/api-server/src/lib/sportmonksSync.ts` (Sportmonks) and `artifacts/api-server/src/lib/apiFootballSync.ts` (API-Football).

## Product

Dashboard, player pool, fixtures, live news feed, injuries, transfers, and prospect rankings for USMNT players. News is real (RSS-sourced); fixtures/stats/injuries/transfers are still seeded placeholder data.

## User preferences

- Match times on the dashboard should be shown in MST.

## Gotchas

- After changing `artifacts/api-server/src/lib/rssIngest.ts`, restart the workflow to re-run ingestion. If you restart twice in quick succession, the old process may still be mid-insert and can leave one stale/uncleaned row behind — check for and delete duplicates if so.
- `SPORTMONKS_API_TOKEN` is set, but the account is on Sportmonks' Free plan, which only ships sample/demo leagues — none of the leagues the tracked players actually play in (Premier League, Serie A, Bundesliga, Ligue 1, La Liga, Eredivisie, MLS, Champions League). The user declined the paid upgrade (Starter €29/mo covers 5 leagues, Growth €99/mo covers all 8+), so `startSportmonksSyncSchedule()` is deliberately not called from `index.ts`. If the user upgrades later, call it from `index.ts` and it'll resolve club→Sportmonks-team IDs and sync upcoming fixtures automatically.
- `API_FOOTBALL_KEY` is set, but that free plan only serves **historical** seasons (2022-2024) — no current fixtures at all — and the trial account got suspended mid-test after a light burst of requests. `startApiFootballSyncSchedule()` is deliberately not called from `index.ts`. Don't re-enable it without a paid plan with current-season access; see `.agents/memory/usmnt-tracker.md` for what was already tried.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
