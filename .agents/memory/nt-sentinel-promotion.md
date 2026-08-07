---
name: NT sentinel fixture promotion architecture
description: Two-path design for promoting negative-sentinel api_football_fixture_ids to real positive IDs; ORDER BY kickoff ASC is load-bearing and must not be removed.
---

## The two paths

**Path 1 — primary, pre-match:** `syncNationalTeamFixtures()` in `apiFootballSync.ts`. Runs hourly. For each unbound row (null or negative `api_football_fixture_id`), matches by kickoff date ±1 day against the full USMNT fixture list fetched from API-Football. Writes the real positive ID, status, scores, and logo URLs in a single UPDATE. This is the path that covers Sept 26 and Sept 29 fixtures — they will have real IDs weeks before kickoff once API-Football publishes them.

**Path 2 — fallback, post-match:** `promoteNtSentinelIds()` in `usmntSync.ts`. Runs hourly inside `startUsmntStatsSyncSchedule()`, and also as a belt-and-braces startup call in `index.ts` Block D. For each unbound row, looks up match logs within ±7 days of kickoff for any player linked via `fixture_players`, then uses `pickBestNtFixtureId()` (vote-count + date-proximity tiebreaker) to pick the right API-Football ID.

## `pollLiveFixtures` safety

`pollLiveFixtures` filters `WHERE status = 'live' AND api_football_fixture_id IS NOT NULL`. A sentinel starts as `'scheduled'`. `syncNationalTeamFixtures()` always sets `status` and `apiFootballFixtureId` in the **same UPDATE** — there is no intermediate state where a sentinel is `'live'` but still negative. Sentinels can never reach the live poll while unbound.

## ORDER BY kickoff ASC is load-bearing

The Sept 26 and Sept 29 friendlies are 3 days apart. Their ±7-day windows overlap almost completely. Without `ORDER BY kickoff ASC` in the initial query, PostgreSQL can return the later sentinel first. If processed first, it claims the Sept 26 log and writes the wrong ID. The constraint then fires on the correct (Sept 26) fixture, leaving it unbound at kickoff.

**Why ASC ordering fixes it:** the earlier kickoff always wins the shared log; the later sentinel hits the unique constraint and stays correctly unbound (because its match has not been played yet). When the later match is played and its own log exists, `pickBestNtFixtureId` uses date proximity to pick the right ID over the earlier one.

**Do not remove this ORDER BY.** The per-fixture try/catch is a safety net for the collision, not the primary guard — the ordering prevents the corruption.

## Per-fixture try/catch scope

The try/catch is inside the loop (not around it). A unique-constraint collision on fixture N must not abort promotion of fixtures N+1, N+2. The outer try/catch only guards the initial query and setup.

## When to remove Block D / promoteNtSentinelIds

Remove from `startUsmntStatsSyncSchedule()` and from `index.ts` Block D once all four Sept/Oct 2026 friendlies have been played, their match logs synced, and their `api_football_fixture_id` values confirmed positive. At that point the fast-path short-circuit (returns immediately when no unbound rows) makes it nearly free to keep, but it should be cleaned up anyway.
