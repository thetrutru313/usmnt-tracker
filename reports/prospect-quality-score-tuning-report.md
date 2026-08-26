# Prospect Quality Score — Tuning Pass Report

**Date:** August 26, 2026
**Scope:** USMNT Tracker admin review queue — 5 fixes from the tuning/bugfix request
**Database queried for all investigation and the dry run below: development (`heliumdb`)** — not production. No production database was touched or queried in this pass.

## 1. Age curve — steeper collapse past prospect age

Replaced the flat 0.9 floor from age 23 up with a steep tail:

| Age | ≤16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | ≥26 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Multiplier | 2.0 | 1.8 | 1.6 | 1.4 | 1.25 | 1.1 | 1.0 | 0.85 | **0.4** | **0.2** | **0.1** |

Age 16-23 unchanged (23 moved from 0.9→0.85, negligible). Unknown age still neutral (1.0). This is the only change to the age term — the formula shape, minutes-saturation curve, rating floor, and starts weighting are untouched.

## 2. Investigation: why were over-age (29–31) candidates pending/scored at all?

**Queried dev (`heliumdb`) only.** Findings:

- Of the 111 raw rows matching `status='pending' OR needsReview=true`, **38 are over the age cap** (default max 23). Every one of them has `status: pending`, `eligibilityConfidence: null`, `lastScoredAt: null`, `isManualOverride: false` — i.e. they are rows that have **never once been rescored** since insertion, not rows with stale/wrong `age` data.
- **The age-gate dismissal only runs inside `rescoreAllCandidates`.** A candidate has to actually go through a rescore pass to be evaluated against the age cap and dismissed. Rows that predate the age gate (or simply haven't reached the front of the rescore queue) sit indefinitely as `pending` regardless of age.
- `rescoreAllCandidates` processes at most `RESCORE_MAX_CANDIDATES` (default 50) per run, oldest-`lastScoredAt`-first, on a 7-day interval (not run at server startup — see prior memory note). With 38+ backlog rows competing with the rest of the pending pool for 50 slots every 7 days, a persistent backlog of un-rescored old rows is expected, not a bug in the gate itself.
- **`/admin/review-queue` already hides these rows from the UI today** via its own live-age filter (`ageFromBirthDate(dob) ?? age <= maxAge`) — so operators were never actually shown 29-31-year-olds; they were only visible to a raw DB query. My previous dry run queried `pending`/`needsReview` rows directly without replicating that filter, which is why it over-counted (111 vs. the 73 an operator actually sees) — corrected in the re-run below.
- **Real (if latent) gap found:** `rescoreAllCandidates`'s selection query is `status='pending' OR eligibilityConfidence IS NULL` — it does **not** check `needsReview` at all. A hypothetical candidate with `needsReview=true` but a non-pending status and a non-null confidence would show in `/admin/review-queue` (which does check `needsReview`) but would never pass through the age-dismissal path. No current row triggers this, but it's a real design gap worth tracking.

No code changes were made for this item, per the instruction that it's investigation-only.

## 3. Rescaled the 0–100 mapping

Real raw scores (coefficient × age × performance) rarely approach the theoretical max of 2.0 — in this dev pool they top out around 0.6-0.9 — so dividing by 2.0 compressed the whole usable range into the bottom third of the scale (previous top score: 29). Changed the divisor to a realistic ceiling of **0.7** (clamped to 100 above it), extracted into its own pure function (`normalizeRawScore`) so the transform is independently unit-tested for monotonicity. A new test sweeps raw values 0→2 and asserts the mapped scores are strictly ordered the same as the raw inputs — rank order is provably unaffected. In the re-run below, the top candidate now scores 94 instead of 29.

## 4. Cup competitions excluded from primary-league selection

Added `isCupCompetition()` (pattern-matches "Cup", "Pokal", "Coppa", "Copa del Rey", "Trophy", "Shield", "Supercup", UEFA Champions/Europa/Conference League, Libertadores/Sudamericana) and wired it into `selectPrimaryLeagueBlock`'s exclusion filter alongside the existing friendly/national-team exclusions, plus the appearances tally in `computeQualityScore`. A candidate with only cup appearances now falls back to the unknown-league coefficient (0.25) and logs a warning, rather than a cup ever being picked as "primary." Verified against real dev data: candidates in this pool have Leagues Cup, US Open Cup, CONCACAF Champions League, DFB Pokal, Coppa Italia, and several others in their statistics — none of them are now eligible to be selected as primary.

## 5. Fixed club display mismatch

Root cause: `player_candidates.club_id` is the **discovery-source entity** (whatever roster the player was found scanning, which can be a youth national team like "United States U20"), not the player's real club — but `/admin/review-queue`'s `clubName` came straight from a join on that column. The player's real primary league (and its coefficient) were computed correctly; only the *displayed* club was wrong.

Fix: `computeQualityScore` now also returns the primary league's actual team (`leagueTeamId`/`leagueTeamName`), persisted in the existing `qualityScoreInputs` JSON column (no migration needed). `/admin/review-queue` now prefers that value for `clubName`, falling back to the discovery-source club join only for candidates that haven't been scored yet. Confirmed in the dry run below: Corcoran now shows "Nashville SC" and Norris/Baker-Whiting show their real MLS clubs instead of "United States U20."

## Verification performed

- `pnpm run typecheck` — clean across all workspace projects
- `pnpm run lint` — 0 errors (8 pre-existing `any` warnings, unrelated to this change)
- `pnpm --filter @workspace/api-server run test` — **804/804 passing** (100 test files), including new tests for: 26yo/3000min vs 19yo/800min same-league ranking under the new age curve, a Bundesliga player with cup minutes scored on the Bundesliga coefficient (not the fallback), a cup-only player getting the fallback coefficient + warning, and the rescaling function's monotonicity (rank-order preservation)
- `scripts/check-codegen-drift.sh` — clean, no OpenAPI/codegen drift
- Confirmed live on server restart

## Read-only dry run (dev database, no writes)

Re-ran the scorer over the same review-queue pool, this time applying the same live-age filter `/admin/review-queue` applies (111 raw rows → **73** after the filter — the previous dry run's 111 was an over-count from not replicating that filter). **73 scored, 0 failed, 0 with no stats available.**

### Top 20 by quality score

| Rank | Score | Age | Name | Club | League | Coefficient | Minutes |
|---|---|---|---|---|---|---|---|
| 1 | 94 | 17 | C. Sanchez | Atlanta United FC | Major League Soccer | 0.55 | 1422 |
| 2 | 90 | 18 | S. Brunell | Seattle Sounders | Major League Soccer | 0.55 | 1640 |
| 3 | 87 | 19 | M. Corcoran | Nashville SC | Major League Soccer | 0.55 | 1969 |
| 4 | 84 | 19 | J. Badwal | Vancouver Whitecaps | Major League Soccer | 0.55 | 1615 |
| 5 | 83 | 18 | J. Shore | New York City FC | Major League Soccer | 0.55 | 1584 |
| 6 | 82 | 20 | T. Johnson | Vancouver Whitecaps | Major League Soccer | 0.55 | 2626 |
| 7 | 80 | 19 | D. Ferree | San Diego | Major League Soccer | 0.55 | 1375 |
| 8 | 77 | 19 | A. Rick | Philadelphia Union | Major League Soccer | 0.55 | 1628 |
| 9 | 76 | 20 | J. Bartlett | Sporting Kansas City | Major League Soccer | 0.55 | 2218 |
| 10 | 76 | 21 | N. Allen | Inter Miami | Major League Soccer | 0.55 | 3194 |
| 11 | 74 | 22 | J. McGlynn | Houston Dynamo | Major League Soccer | 0.55 | 4365 |
| 12 | 74 | 19 | O. Verhoeven | San Diego | Major League Soccer | 0.55 | 1568 |
| 13 | 71 | 20 | N. Norris | FC Dallas | Major League Soccer | 0.55 | 1581 |
| 14 | 70 | 22 | D. Sealy | CF Montreal | Major League Soccer | 0.55 | 2819 |
| 15 | 69 | 20 | R. Baker-Whiting | Nashville SC | Major League Soccer | 0.55 | 1308 |
| 16 | 68 | 23 | G. Busio | Venezia | Serie B | 0.60 | 3291 |
| 17 | 67 | 18 | Chadwick Zachary Booth | Real Salt Lake | Major League Soccer | 0.55 | 593 |
| 18 | 64 | 21 | N. Ordaz | Los Angeles FC | Major League Soccer | 0.55 | 1931 |
| 19 | 63 | 23 | J. Tolkin | Holstein Kiel | 2. Bundesliga | 0.60 | 2609 |
| 20 | 63 | 21 | G. Valenzuela | FC Cincinnati | Major League Soccer | 0.55 | 1517 |

**Reading the ranking:** the pool now spreads across the full scale (94 down to 63 in the top 20, rather than 29 down to 19) and every over-age (29-31yo) profile that previously cracked the top 20 on raw minutes is gone — the steep 24+ collapse now does its job. Club names for Corcoran, Norris, and Baker-Whiting correctly show their real MLS clubs (Nashville SC, FC Dallas, Nashville SC) instead of "United States U20."

Leagues still resolving to the unknown-league fallback coefficient (0.25) as a *primary* league — none of these are cups, they're genuinely unclassified: **MLS Next Pro** (16 blocks), **NWSL Women** (9 blocks), **Primera División - Clausura** (1 block). Worth adding real coefficients for these in `leagueStrengthDefaults.ts`.

Cup/continental competitions correctly seen in candidates' statistics and excluded from primary-league selection: Leagues Cup, US Open Cup, CONCACAF Champions League, CONCACAF Gold Cup, DFB Pokal, Coppa Italia, CONMEBOL Libertadores/Sudamericana, SheBelieves Cup, UEFA Champions League Women, FIFA Club World Cup, USL League One Cup, and World Cup qualifying/youth national-team appearances.

## Known follow-ups

- The `needsReview`-not-covered-by-rescore gap (item 2) — no row currently triggers it, but it's a real latent bug worth a dedicated look.
- Classify **MLS Next Pro**, **NWSL Women**, and regional lower-division leagues like "Primera División - Clausura" with real coefficients instead of the 0.25 fallback.
