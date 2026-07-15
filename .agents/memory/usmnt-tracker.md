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

## Seed data narrative must stay cross-consistent

The seed script (`scripts/src/seedUsmnt.ts`) drives Injuries, News, and Fixtures together — they need to agree on the same story (e.g. an injured player shouldn't also be "Player of the Month" in a same-week news item, or featured in a fixture happening during their injury). When adding/editing one of these seed sections, check the other two for contradictions before re-seeding.

**Why:** the user caught Christian Pulisic showing as fully fit and thriving in News/Fixtures while having no Injuries record at all, despite being hurt in-story — the sections had drifted out of sync.

**How to apply:** re-running `pnpm --filter @workspace/scripts run seed:usmnt` truncates `clubs` and `fixtures` (cascades), which wipes any live API-Football sync data (`apiFootballTeamId` on clubs, `apiFootballFixtureId` on fixtures) — restart the api-server workflow right after reseeding so the hourly sync re-resolves team IDs and repopulates live fixtures (takes a few minutes on the 7s/request throttle).

## API-Football free-plan limitations

Tried API-Football (`v3.football.api-sports.io`, header `x-apisports-key`) as a Sportmonks alternative. Two free-plan blockers hit in one test run: (1) the `next=N` upcoming-fixtures param isn't available — had to fall back to `/fixtures?team={id}&season={year}` and filter client-side for not-yet-started fixtures; (2) the free plan only serves **historical** seasons (the error literally said "try from 2022 to 2024") — no current-season data at all, so it can't produce "upcoming fixtures" regardless of the `next`-param workaround; (3) the trial account got flagged/suspended mid-test ("Your account is suspended, check on...dashboard") after a modest burst of ~15 requests spaced 7s apart — free-tier abuse detection here is aggressive.

**Why:** worth recording so a future session doesn't re-diagnose the same dead end — this key/plan combination cannot serve live fixtures no matter how the request is shaped.

**How to apply:** if the user wants to revisit API-Football, they need a paid plan with current-season access (check api-football.com pricing) and should watch for suspension/rate-limit emails after signup. The sync code (`artifacts/api-server/src/lib/apiFootballSync.ts`) already handles team-id caching, throttling (7s/request), and season fallback — it just isn't started from `index.ts` right now.

**Update:** user upgraded to a paid plan — sync is now live and started from `index.ts`. On the paid plan, team search still fails for a handful of clubs whose official DB name differs from API-Football's short name (e.g. "AS Monaco" → search "Monaco", "FC Barcelona" → "Barcelona", "Inter Miami CF" → "Inter Miami", "Olympique de Marseille" → "Marseille", "Seattle Sounders FC" → "Seattle Sounders"). Fixed via a `SEARCH_TERM_OVERRIDES` map plus preferring an exact case-insensitive name match over "first result" (searches like "Barcelona" return a dozen youth/reserve/women's teams). If a new club fails to resolve, check this pattern first before assuming it's a plan/API issue. Newly added clubs (Vancouver Whitecaps, Club America, Borussia Monchengladbach, Coventry City, Hajduk Split, etc.) haven't been checked against this override list yet — do that if their crest/team-id sync comes back empty.

## Auditing syncPlayerClubs "not tracked" warnings

To find real transfer destinations worth seeding into `clubs`, don't just trust the warning's `newClubName` — verify each case before adding a club row, since three different root causes produce the same warning text: (1) a genuinely untracked club (add it), (2) an already-tracked club whose seeded `apiFootballTeamId` is simply wrong (team-search resolved the wrong entity — e.g. a club's official full name resolves to a different team id than the short name API-Football's transfers endpoint reports, such as "Leeds United" search-resolving to a different id than the "Leeds" id its transfer records use), or (3) a misresolved player id entirely (the "transfer" belongs to a same-named stranger, not the tracked player — check `/players/profiles?player=<id>` nationality/bio before trusting the transfer). Case (2) is a fixture/team-id-resolution bug, not a missing club; case (3) is a name-matching bug. Only case (1) belongs to "add more tracked clubs" work.

**Why:** conflating these wastes effort (e.g. adding a duplicate club row won't fix a wrong-id case) and case (3) can actively corrupt data if you seed a club based on a wrong player match.

**How to apply:** for each warning, fetch the player's transfer history directly and cross-check the destination team's real API-Football id via a fresh `/teams?search=` call before adding anything to `clubs`. Before inserting, also check whether a club with that `api_football_team_id` already exists under a different name (no DB constraint currently prevents duplicates — see the "duplicate club" follow-up task) to avoid creating a second row for the same real club.

## No fabricated player stats — live-sync-only invariant

Player stats, match logs, and injuries must reflect only real, currently-fetchable API-Football data — never a fabricated default (0/false) and never a stale row left over from a prior run once this run had the chance to refresh it. Missing-but-real-eventually values are `null`, not `0`.

**Why:** a delete-only-when-fresh-data-exists sync looks correct in the common case but silently preserves fabricated/seeded or outdated rows for exactly the players/clubs most likely to need correction (recent transfers, injuries, unresolved API ids) — the failure is invisible until someone checks a specific player.

**How to apply:** any per-entity sync loop (by player, by club, by stat-period) must clear that entity's existing rows unconditionally, before branching on whether fresh data was actually fetched — including on early-return paths (failed lookups, unresolved external ids, empty API responses). Insert-if-fresh must never be allowed to skip the clear step.

## Per-player stats table: delete scope must match the row's uniqueness key

`player_stats` rows are unique per `(playerId, periodType)` for the single-row period types (`season`, `previous_season`, `last5`) — the `season` *column* on those rows is just a display label, not part of the key, and it can change value between runs (e.g. the year rolls over). History-style period types (`season_all` for club seasons, `national_team_cycle` for USMNT World Cup cycles) are the exception: one row per `(playerId, periodType, season)` where `season` holds the year/cycle label, replaced as a full set each run.

**Why:** scoping a single-row period's delete-before-insert by `(playerId, periodType, season)` instead of just `(playerId, periodType)` silently leaves the previous run's row behind as a stale duplicate the moment the season label changes — easy to introduce by copy-pasting the history-style delete logic onto the single-row upsert helper.

**How to apply:** before changing the delete/upsert helper for any `player_stats` period type, check whether that periodType is single-row-per-player or a real history — only history types should filter their delete by `season`.

## orval codegen: path+query param name collision

The first OpenAPI operation with both a path param and a query param triggers an orval bug: `generated/types/<operationId>Params.ts` (the plain-TS mirror, not the zod file) gets generated under the *path*-param's name but contains the *query*-param shape, colliding with the correctly-named zod-file export of the same name when both are re-exported from `lib/api-zod/src/index.ts`.

**Why:** produces a confusing `TS2308: Module has already exported a member named 'X'` pointing at `generated/api`, when the real duplicate is in `generated/types`.

**How to apply:** since app code only ever imports the zod objects (never the plain-TS mirrors) from `@workspace/api-zod`, the fix is to stop re-exporting `./generated/types` from `lib/api-zod/src/index.ts` (keep only `./generated/api`) — cheaper than fighting orval config. Re-verify no consumer imports plain types before doing this on a fresh occurrence.

## USMNT stats sync runs independently of the club sync

National-team match logs/cycle stats sync on their own schedule (`usmntSync.ts`, hourly), separate from the club sync's 50-club crawl (`playerStatsSync.ts`, daily, ~1hr to complete). World Cup cycle labels are derived from match date vs. known/estimated tournament end-date cutoffs, not stored as static config.

**Why:** national-team games are rare relative to club fixtures, so tying USMNT sync to "whichever step happens last in the club crawl" meant new World Cup roster call-ups showed zero stats for up to an hour after kickoff. There's no webhook/push for match completion on API-Football — only polling — so the fix is a cheap poll (compare freshly-fetched finished fixture ids against what's already in `match_logs`) that only pays for the expensive per-fixture lineup fetch when something genuinely new happened.

**How to apply:** all three schedules (`apiFootballSync.ts` fixtures, `playerStatsSync.ts` club stats, `usmntSync.ts` USMNT stats) call the same `afFetch` against one shared per-minute rate limit and all fire immediately on server boot — expect a burst of "Too many requests" warnings in the first minute or two after every restart; each sync degrades gracefully (skips and logs, retries next scheduled run) rather than corrupting data, so this is noisy but not broken. See task backlog for the follow-up to stagger/throttle these against each other.

## Player-pool completeness audits

When asked to audit the Player Pool for missing eligible players, the durable criteria are: (1) ≥1 senior cap, (2) any youth national team (U-15–U-23) appearance, (3) US-eligible, under-20, and a current club starter. Cross-reference against the real official World Cup/senior roster plus a reputable U-21 prospects ranking (e.g. ESPN) rather than trying to enumerate the whole real-world pool from scratch — bounds the work while staying evidence-based. Always resolve real API-Football team IDs/logos for any new club before writing seed rows (some very new/small clubs, e.g. a 2025 MLS expansion side, genuinely aren't in API-Football's DB — leave `logoUrl` null rather than guessing).
