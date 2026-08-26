# Replit prompt — step 1: correctness fixes to the eligibility pipeline

---

> Three correctness bugs in the eligibility pipeline. I've diagnosed all three; don't
> re-diagnose. Fix exactly these and nothing else.
>
> ## Bug 1 — `detectUsStateBirthplace` fires on non-US birthplaces
>
> **File:** `artifacts/api-server/src/lib/evaluateEligibility.ts`
>
> The function splits a birthplace string on whitespace and commas, uppercases each
> token, and tests it against a set of two-letter US state abbreviations. Common
> non-English place-name particles collide with those abbreviations:
>
> - "Rio **de** Janeiro" → `DE` → Delaware
> - "**La** Plata", "**La** Paz" → `LA` → Louisiana
> - "**Al** Rayyan" → `AL` → Alabama
>
> Separately, the substring loop over full state names matches the *country* Georgia:
> "Tbilisi, Georgia" fires the signal.
>
> Each false positive awards 15 points of US-eligibility evidence to a player with no
> US connection.
>
> Fix:
>
> - Only accept a two-letter abbreviation when it appears as the **final** token of the
>   string, or the token immediately before a trailing country name — i.e. the position
>   a US state actually occupies in "Dallas, TX" or "Dallas, TX, USA". Never match an
>   abbreviation appearing mid-string.
> - Require the abbreviation to have been uppercase in the original string. "de" is not
>   "DE".
> - For full state names, require a word-boundary match, not `includes()`.
> - Special-case Georgia: only treat it as the US state when the string also contains a
>   US indicator (a US city, "USA", "United States"), or when `birth.country` is USA.
>   Otherwise treat it as the country.
> - When `birth.country` is present and is **not** USA or United States, do not fire
>   this signal at all. A player born in Brazil did not have a US-state birthplace.
>
> That last rule alone eliminates most of the false positives; implement the others
> anyway, because `birth.country` is sometimes null.
>
> Before you change anything, run this and show me the output so we can see how many
> existing firings are wrong:
>
> ```sql
> SELECT es.signal_value, pc.name, pc.nationality, pc.birth_country
> FROM eligibility_signals es
> JOIN player_candidates pc ON pc.id = es.candidate_id
> WHERE es.signal_type = 'us_state_birthplace';
> ```
>
> ## Bug 2 — two conflicting implementations of "senior non-US caps"
>
> **Files:** `playerDiscovery.ts` and `evaluateEligibility.ts`
>
> Both define the same concept, and they disagree.
>
> `evaluateEligibility.ts` is **correct**: `detectSeniorNonUsCaps` excludes youth teams
> via `US_YOUTH_RE` and `ANY_YOUTH_NT_RE`, so a U20 appearance is not treated as a
> senior commitment.
>
> `playerDiscovery.ts` has its own `hasSeniorNonUsCaps` plus a local `NATIONAL_TEAM_RE`
> with **no youth exclusion**. Its regex matches "World Cup - U17" and "CONCACAF U20".
> Consequences:
>
> - `eligibilityBasis` is set to `dual_national_unconfirmed` for players whose only
>   representative appearances are youth-level.
> - `priorNationalTeamCaps` counts youth appearances as senior caps.
>
> Youth caps do not cap-tie a player. Treating them as a senior commitment inverts the
> meaning of the signal — a US-eligible youth international looks *less* attractive
> than an unknown.
>
> Fix:
>
> - Delete `hasSeniorNonUsCaps`, `NATIONAL_TEAM_RE`, and
>   `looksLikeNationalTeamCompetition` from `playerDiscovery.ts`.
> - Export the equivalents from `evaluateEligibility.ts` and import them. One
>   implementation, one source of truth.
> - Add a separate `priorYouthNtCaps` count alongside `priorNationalTeamCaps`, so youth
>   appearances are recorded as their own thing rather than folded into senior caps.
>   Add the column via a Drizzle migration.
> - `priorNationalTeamCaps` must count senior caps only.
>
> Check whether `looksLikeNationalTeamCompetition` is used anywhere else in
> `playerDiscovery.ts` before deleting it — `applyQualityGate` and `computeAvgRating`
> may reference related helpers. Report what you find rather than changing their
> behaviour.
>
> ## Bug 3 — `age` is frozen at discovery time
>
> **Files:** schema, `playerDiscovery.ts`
>
> `player_candidates.age` is written once when the candidate is discovered and never
> updated. Every age check compares against a stale value. Players age; the column does
> not.
>
> This matters more than it sounds: **84 of 84 dismissals in production were on age,
> and exactly 1 on score.** Age is the only filter doing real work, and it is operating
> on data that goes stale immediately. Dismissed candidates are also invisible to future
> discovery runs, so a wrong dismissal is permanent.
>
> Fix:
>
> - Add `date_of_birth` (date, nullable) to `player_candidates` via a Drizzle migration.
> - Populate it from API-Football's `birth.date` on every write path — discovery insert,
>   the `onConflictDoUpdate` branch, and rescore.
> - Compute age from `date_of_birth` wherever an age check happens. Keep the `age`
>   column for now as a display fallback for rows without a birth date, but do not gate
>   on it when `date_of_birth` is present.
> - Add a backfill function that populates `date_of_birth` for existing candidates from
>   API-Football, following the same pattern as `backfillCandidateBirthplaces`. Expose
>   it on an admin route. Do **not** run it — I will trigger it.
>
> ## Constraints
>
> - Do not change signal weights, `ELIGIBILITY_MIN_SCORE`, `DISCOVERY_MAX_AGE`,
>   `MIN_STARTS`, or `MIN_MINUTES`.
> - Do not change how the queue is sorted or ranked. That is separate work.
> - Do not change `knownApiIds` construction or the discovery club scope.
> - Do not re-open or un-dismiss any existing candidate. I will decide what to do with
>   the 84 dismissed rows after the birth-date backfill runs.
> - Migrations contain DDL only. Per `lib/db/README.md`, Replit's Publish computes a
>   schema diff and does not execute migration files, so any data backfill written into
>   a migration will silently never reach production. Give me backfill SQL separately if
>   any is needed.
>
> ## Tests
>
> - Birthplace: assert "Rio de Janeiro", "La Plata", and "Tbilisi, Georgia" do **not**
>   fire the signal; assert "Dallas, Texas", "Dallas, TX", and "Atlanta, Georgia, USA"
>   **do**.
> - Senior caps: assert a player whose only NT appearances are "World Cup - U17" for
>   Brazil is not flagged `DUAL_NATIONAL` and has `priorNationalTeamCaps = 0` with
>   `priorYouthNtCaps > 0`.
> - Age: assert a candidate with a `date_of_birth` making them 24 today is treated as
>   over the cap even when the stored `age` column says 22.
>
> Run `pnpm run typecheck`, `pnpm run lint`, and the full suite.
>
> ## Report back
>
> 1. The birthplace query output from before your changes, and how many of those
>    firings your fix would eliminate.
> 2. How many existing candidates are currently flagged `DUAL_NATIONAL` on the strength
>    of youth-only appearances.
> 3. Confirmation that the migration contains DDL only.


