---
name: DUAL_NATIONAL team-identity gate
description: detectSeniorNonUsCaps/countNationalTeamCaps require API-Football team.national, not just league-name matching, to count a cap.
---

## Rule
League-name matching (`isNationalTeamComp`) is only a cheap pre-filter to skip
obviously-club leagues before a lookup. It must never be sufficient on its
own to decide a stat block is a national-team appearance — club competitions
like "CONCACAF Champions League" and "FIFA Club World Cup" match the same
keywords as genuine national-team competitions ("CONCACAF Nations League",
"FIFA World Cup"). The actual gate is team identity: `isTeamNational(teamId,
teamName)` in `artifacts/api-server/src/lib/teamNationalityCache.ts`, backed
by a permanent DB cache (`api_football_teams` table) of API-Football's
`/teams?id=` `national` boolean.

**Why:** this exact keyword collision caused capped USMNT internationals to
be wrongly flagged `DUAL_NATIONAL` — their club had played CONCACAF Champions
League / FIFA Club World Cup matches, which the old regex-only check
couldn't distinguish from a real senior cap for another country. A live
dry-run after the fix found only 5 of 31 previously-flagged DUAL_NATIONAL
candidates still qualify; the other 26 were this false positive.

`isTeamNational` also ORs in the pre-existing `isLikelyNationalTeamName`
name-heuristic (see the api-football-squad-national-flag memory) as a
backstop, because API-Football's `national` flag is a known false negative
for national *youth* teams. This only adds true positives on top of the API
flag — it can't turn a real club into "national" for the patterns it
matches (youth-suffix, "USA"/"United States" exact match) — so it doesn't
reopen the original league-name-collision bug.

**How to apply:** `evaluateEligibility`, `detectSeniorNonUsCaps`, and
`countNationalTeamCaps` are all `async` and take an optional injectable
`resolveIsNational` resolver (default: the real cached lookup) specifically
so tests can stub team identity without hitting the DB/API. Any new caller
of these three functions must `await` them. The `api_football_teams` cache
is seeded for free for every already-tracked club (`clubs` table) via a
data-only backfill SQL file, since a tracked club is never a national team —
no API call needed for that common case.
