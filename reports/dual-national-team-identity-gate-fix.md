# Fix: DUAL_NATIONAL False Positives from Club-Competition Name Collisions

## Summary

Capped USMNT internationals were being wrongly flagged `DUAL_NATIONAL` because
the eligibility engine detected "senior non-US caps" by matching **league
names** against a national-team-competition regex. Club competitions such as
**"CONCACAF Champions League"** and **"FIFA Club World Cup"** matched the same
keywords as genuine national-team competitions ("CONCACAF Nations League",
"FIFA World Cup"), so a USMNT player whose *club* had played in one of those
club tournaments could be misread as having capped for another country.

This has been fixed by gating cap detection on **confirmed team identity**
instead of league-name text.

## Root cause

- `detectSeniorNonUsCaps` and `countNationalTeamCaps` (in
  `evaluateEligibility.ts`) previously counted a stat block as a national-team
  appearance whenever `isNationalTeamComp(league.name)` matched — a regex
  looking for keywords like "nations league", "world cup", "gold cup", etc.
- That regex cannot distinguish a club playing in a club competition with a
  national-team-sounding name from an actual international appearance,
  because both put the same keywords in the league name.
- Live API-Football data (pulled during the investigation) confirmed 4
  capped USMNT players — Arriola, Morris, Delgado, and Jonathan David's
  club — were flagged this way.

## Fix

1. **New permanent DB cache** — `api_football_teams` table
   (`api_football_team_id`, `name`, `country`, `is_national`, `fetched_at`).
   A team's national/club status never changes, so a team is looked up via
   API-Football's `/teams?id=` endpoint **at most once, ever**.
2. **New resolver** — `isTeamNational(teamId, teamName)` in
   `teamNationalityCache.ts`:
   - Checks the DB cache first.
   - On a miss, calls `/teams?id=` and trusts API-Football's authoritative
     `team.national` boolean.
   - ORs in the existing `isLikelyNationalTeamName` heuristic as a backstop,
     because that flag is a known false negative specifically for national
     *youth* teams (e.g. "United States U20" can return `national: false`).
     This backstop can only add true positives for youth-suffix/exact
     "USA"/"United States" name patterns — it can never turn a real club
     competition name into evidence of a cap, so it doesn't reopen the
     original bug.
   - **Fails closed**: a missing team id, a failed lookup, or an empty
     API-Football response all return `false` (treated as non-national) and
     log a warning, rather than guessing.
3. **Gating change** — `isNationalTeamComp(league.name)` is now only a cheap
   pre-filter to skip obviously-club leagues (Premier League, Bundesliga,
   MLS, ...) before doing a lookup. The actual decision of "does this count
   as a national-team appearance" is `resolveIsNational(team.id, team.name)`.
   This applies uniformly to:
   - `detectSeniorNonUsCaps` (drives `DUAL_NATIONAL` status)
   - `countNationalTeamCaps` (drives `priorNationalTeamCaps` /
     `priorYouthNtCaps`)
4. **Youth exclusion logic is unchanged** — youth appearances are still
   excluded from the senior bucket by team-name regex before the
   team-identity check ever runs.
5. **Cache seeded for free** — every already-tracked club in the `clubs`
   table is a club by definition, so the cache was seeded with
   `is_national = false` directly from existing club data, at zero
   API-Football calls (92 rows in the dev database). The same backfill SQL
   is provided separately (not embedded in the schema migration) for
   production, per the project's migration conventions:
   `lib/db/drizzle/backfill/0006_seed_api_football_teams_from_clubs.sql`.

## Verification

- `evaluateEligibility`, `detectSeniorNonUsCaps`, and `countNationalTeamCaps`
  are now `async` with an injectable resolver parameter (defaulting to the
  real cached lookup), so tests can stub team identity without hitting the
  database or API-Football.
- New regression tests cover exactly the specified scenarios:
  - Club (Seattle Sounders) in CONCACAF Champions League → does **not**
    count.
  - Club (LAFC) in FIFA Club World Cup → does **not** count.
  - Genuine national team (Canada) in CONCACAF Nations League → **does**
    count.
  - USA in CONCACAF Gold Cup → not counted as a *non-US* cap.
  - Youth block ("United States U20") → not counted as senior; correctly
    increments `priorYouthNtCaps` instead.
- `pnpm run typecheck`, `pnpm run lint`, and the full API server test suite
  all pass (787 tests, 0 failures).
- The API server workflow restarted cleanly with the new code and DB table
  in place.

## Impact on existing data (read-only dry run — no candidate statuses were changed)

Re-evaluated every candidate currently stored with `usmntStatus =
DUAL_NATIONAL` against the corrected logic, using live API-Football data,
without writing anything back to the database:

| Result | Count |
|---|---|
| Total candidates currently flagged `DUAL_NATIONAL` | 31 |
| Still flagged under the corrected logic (genuine dual nationals) | 5 |
| Would clear — confirmed false positives from this bug | 26 |
| Could not re-fetch stats | 0 |

Note: an earlier estimate referenced "53" `DUAL_NATIONAL` candidates; the
actual current count in the database is 31. No stored candidate statuses
were modified — trigger a rescore (via the admin "Rescore All" action)
whenever you're ready to apply this correction to the stored data.
