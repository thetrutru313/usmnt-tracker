# Eligibility Correctness Fixes — Report

_USMNT Tracker · api-server · prepared 2026-08-26_

## Summary

Three bugs were fixed in the eligibility/discovery pipeline, per the attached instructions. All required tests pass (772/772), `typecheck` and `lint` are clean, and the schema migration has been applied to the dev database.

---

## Bug 1 — `detectUsStateBirthplace` false positives

**Problem:** non-English place-name particles collided with US state abbreviations/names — e.g. "Rio de Janeiro" → DE (Delaware), "La Plata"/"La Paz" → LA (Louisiana), "Al Rayyan" → AL (Alabama), "Tbilisi, Georgia" → the US state Georgia instead of the country.

**Fix:** `detectUsStateBirthplace` now splits the birthplace on commas. A two-letter abbreviation is only accepted from the final segment (or the segment before a trailing country name), and only if it was already uppercase in the source string — this alone rules out "de"/"la"/"al" positionally. Full state names are matched via a word-boundary regex against the whole string. "Georgia" is special-cased to require independent US evidence (a trailing US country segment, another US-indicator signal, or a confirmed US `birthCountry`) before it's treated as the state rather than the country.

**Pre-change SQL report** (run before any code changes):

```sql
SELECT * FROM eligibility_signals WHERE signal_type = 'us_state_birthplace';
```

- **4 rows matched**, all with US nationality/birth_country already on file.
- **0 existing firings would be eliminated** by the fix — none of the 4 rows were false positives on live data.

**Conclusion:** the bug was real but hadn't yet produced an incorrect signal on existing candidates. It was a latent risk for the exact non-English place names above, now closed going forward.

---

## Bug 2 — duplicated / conflicting senior-caps logic

**Problem:** `playerDiscovery.ts` had its own buggy senior-non-US-caps detector, separate from and disagreeing with the correct logic already in `evaluateEligibility.ts`. The buggy version did not exclude youth national-team appearances from the senior cap count.

**Fix:** the buggy trio (`NATIONAL_TEAM_RE`, `looksLikeNationalTeamCompetition`, `hasSeniorNonUsCaps`) was deleted from `playerDiscovery.ts`. It now imports the correct `detectSeniorNonUsCaps` and a new `countNationalTeamCaps` from `evaluateEligibility.ts`, which splits caps into `seniorCaps` and `youthCaps`. A new `priorYouthNtCaps` column/counter was added (via migration) so youth-only history is tracked separately and never inflates `priorNationalTeamCaps` (senior-only).

**Empirical check** (existing candidates flagged `dual_national_unconfirmed` / `DUAL_NATIONAL` on what should have been youth-only appearances):

```sql
SELECT status, id, name FROM player_candidates
WHERE status IN ('promoted','pending')
  AND (eligibility_basis = 'dual_national_unconfirmed' OR usmnt_status = 'DUAL_NATIONAL')
  AND COALESCE(prior_national_team_caps, 0) = 0;
```

- **0 rows.**

**Conclusion:** the buggy code never actually reached the `usmnt_status` enum shown to operators (that always went through the correct `evaluateEligibility()` logic) — it only fed a legacy display field (`eligibilityBasis`) and the old cap count. No existing candidate's real status was wrong as a result of this bug.

---

## Bug 3 — `age` frozen at discovery time

**Problem:** a candidate's `age` was computed once at discovery and never recomputed, so a player could silently age past the cutoff without ever being re-evaluated.

**Fix:**
- Added a nullable `date_of_birth` column to `player_candidates`.
- Populated on every write path: initial discovery insert, the `onConflictDoUpdate` upsert path, and `rescoreAllCandidates`.
- Every age gate (`discoverUSProspects`, `rescoreAllCandidates`, and the `/admin/review-queue` over-age filter) now computes live age from `date_of_birth` via the existing `ageFromBirthDate()` helper, falling back to the stored `age` column only when no birth date is on file.
- The stored `age` column remains as a display-only fallback.
- A `backfillCandidateDatesOfBirth()` function was added (mirrors the existing birthplace backfill) and exposed via `POST /admin/backfill-candidate-dob` — **not invoked automatically**, per instructions. Trigger it manually when ready.

**Migration confirmation:** `lib/db/drizzle/0005_candidate_dob_and_youth_caps.sql` contains exactly two `ALTER TABLE ... ADD COLUMN` statements — **no DML, pure DDL**. It has been applied to the dev database via `drizzle-kit migrate`.

---

## Scope discipline confirmed

- No changes to signal weights, `ELIGIBILITY_MIN_SCORE`, `DISCOVERY_MAX_AGE`, `MIN_STARTS`, `MIN_MINUTES`, review-queue sort/ranking, or `knownApiIds`/discovery club scope.
- No dismissed candidates are re-opened by any of these changes.
- The Bug 3 backfill was **not run** — only exposed via the admin route, awaiting a manual trigger.

## Testing

- New test file `eligibilityCorrectnessFixes.test.ts` covers all three bugs (birthplace true/false-positive matrix, senior/youth cap-exclusion scenarios, live-vs-stale age).
- Existing test fixtures that paired a display `age` with an unrelated `birth.date` were corrected where the new live-age computation changed their gate outcome.
- Full suite: **772 passed**, `pnpm run typecheck` and `pnpm run lint` both clean.

## Operational note

`rescoreAllCandidates` only runs on its existing 7-day interval (not at server startup), so none of these fixes retroactively change existing candidate rows until you trigger a manual rescore or run the DOB backfill.
