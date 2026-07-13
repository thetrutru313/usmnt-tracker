---
name: USMNT Tracker data model
description: Conventions used for the USMNT Tracker artifact (players/clubs/fixtures/news/injuries/transfers) — useful for future work on this or similar seeded sports-data apps in this monorepo.
---

The USMNT Tracker artifact (`artifacts/usmnt-tracker` + shared `@workspace/api-server`/`@workspace/db`) uses realistic **seeded** data rather than live feeds/scraping/AI summarization — those were explicitly deferred (admin panel, notifications, live RSS ingestion, call-up predictor are natural follow-ups, not yet built).

Drizzle timestamp columns (default mode, not `{ mode: "string" }`) require JS `Date` objects on insert, not ISO strings — passing a string throws `value.toISOString is not a function` deep in drizzle's query builder. Only `date` columns declared with `{ mode: "string" }` accept plain date strings.

**Why:** easy to mix up since some schema fields (e.g. `contractUntil`, `debutDate`, `startDate`) intentionally use string-mode `date` columns while others (`kickoff`, `publishedAt`, `announcedAt`) are full `timestamp` columns — inconsistent value types across a single seed script silently type-check (drizzle doesn't statically enforce it well) but fail at runtime.

**How to apply:** when writing seed/insert scripts, check the column definition's `mode` before deciding whether to pass a `Date` object or an ISO date string. Also make seed scripts idempotent — `TRUNCATE ... RESTART IDENTITY CASCADE` at the top — since seeding a monorepo db can fail partway through (e.g. from the above pitfall) and a rerun otherwise hits unique-constraint errors on the already-inserted rows.

## Live news via free RSS (no API key)

News is no longer seeded-only: `rssIngest.ts` polls public RSS feeds (BBC Sport, Google News searches) every 15 min, no paid key needed. Fixtures/stats/injuries/transfers are still seeded — those need a paid provider (Sportmonks/API-Football) that the user hasn't approved yet.

**Why:** raw RSS/Google-News search results are extremely noisy — a bare org-name keyword like "US Soccer" or "U.S. Soccer" matches youth academies, women's team, and unrelated op-eds, and floods the feed. Matching on player surnames alone also false-positives on common names.

**How to apply:** keep relevance keywords narrow (must name the senior men's team specifically, e.g. "USMNT", "U.S. men's national team" — not bare org names), require a real player-name match or a narrow keyword hit, cap inserts per run (~25) prioritizing player-matched articles, dedupe by URL, and strip outlet-name suffixes ("Headline - ESPN" / "Headline | ESPN") from titles before storing. Also: don't restart the workflow twice in quick succession — the dying old process can race the new one's first insert and leave one stale/uncleaned row (harmless but worth a cleanup query if noticed).

## Sportmonks free-plan league coverage gap

Sportmonks' Free plan (what you get by just registering, distinct from the 14-day trial of a *paid* plan) includes only sample/demo leagues — none of the Premier League/Serie A/Bundesliga/Ligue 1/La Liga/Eredivisie/MLS/Champions League tier that a roster of pro players actually needs. Team search and fixture calls all succeed (200 OK) but return empty `data` with a "no access to it via your current subscription" message — this looks like a bug (silent empty result) if you don't read the `message` field.

**Why:** easy to misdiagnose as a broken integration (token invalid, wrong endpoint, etc.) when it's actually a plan/league-selection limitation. Confirmed by direct curl: `{"data":[],"message":"...you don't have access to it via your current subscription."}`.

**How to apply:** before assuming a Sportmonks integration is broken, log/inspect the raw response body (not just whether `data` is empty) — the `message` field says exactly this. Starter (€29/mo) lets you pick 5 leagues, Growth (€99/mo) covers 30 — pick a plan that includes every league your tracked entities are actually in, not just headline competitions.

## API-Football free-plan limitations

Tried API-Football (`v3.football.api-sports.io`, header `x-apisports-key`) as a Sportmonks alternative. Two free-plan blockers hit in one test run: (1) the `next=N` upcoming-fixtures param isn't available — had to fall back to `/fixtures?team={id}&season={year}` and filter client-side for not-yet-started fixtures; (2) the free plan only serves **historical** seasons (the error literally said "try from 2022 to 2024") — no current-season data at all, so it can't produce "upcoming fixtures" regardless of the `next`-param workaround; (3) the trial account got flagged/suspended mid-test ("Your account is suspended, check on...dashboard") after a modest burst of ~15 requests spaced 7s apart — free-tier abuse detection here is aggressive.

**Why:** worth recording so a future session doesn't re-diagnose the same dead end — this key/plan combination cannot serve live fixtures no matter how the request is shaped.

**How to apply:** if the user wants to revisit API-Football, they need a paid plan with current-season access (check api-football.com pricing) and should watch for suspension/rate-limit emails after signup. The sync code (`artifacts/api-server/src/lib/apiFootballSync.ts`) already handles team-id caching, throttling (7s/request), and season fallback — it just isn't started from `index.ts` right now.
