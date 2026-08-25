

> Two bugs in `artifacts/api-server/src/lib/playerDiscovery.ts`. I've diagnosed both;
> don't re-diagnose. Fix exactly these two and nothing else.
>
> ## Bug 1 — `rescoreAllCandidates` deadlocks on unscoreable candidates
>
> In `rescoreAllCandidates`, when the API-Football fetch returns no usable profile, the
> code currently does:
>
> ```ts
> if (!profile) {
>   logger.debug({ candidateId: candidate.id, name: candidate.name }, "Rescore: no stats found, skipping");
>   continue;
> }
> ```
>
> `lastScoredAt` is never written. The query orders by `lastScoredAt ASC NULLS FIRST`
> with a cap (default 50), so these rows sort to the front on every run, consume cap
> slots, fail again, and never move. Once the number of unscoreable candidates
> approaches the cap, no other candidate is ever reached. We currently have 92
> never-scored candidates that have not moved in weeks — this is why.
>
> Fix: stamp `lastScoredAt` before continuing, so the row rotates to the back of the
> queue instead of blocking it.
>
> ```ts
> if (!profile) {
>   await dbInstance
>     .update(playerCandidatesTable)
>     .set({ lastScoredAt: new Date() })
>     .where(eq(playerCandidatesTable.id, candidate.id));
>   logger.debug(
>     { candidateId: candidate.id, name: candidate.name },
>     "Rescore: no stats found — timestamped and deferred",
>   );
>   continue;
> }
> ```
>
> Use `dbInstance`, not `db` — that function supports an injected test connection and
> must keep doing so.
>
> Do NOT change the candidate's status, confidence, or signals on this path. The row is
> unscoreable right now; that is not the same as being ineligible, and it must stay
> pending for review.
>
> Add a `skippedNoStats` counter to the return value alongside `processed`, `updated`,
> `failed`, and `skipped`, and include it in the completion log so this failure mode is
> visible instead of silent.
>
> ## Bug 2 — the season fallback never falls back
>
> Both `discoverUSProspects` and `rescoreAllCandidates` contain this pattern:
>
> ```ts
> const seasonCandidates = [currentYear, currentYear - 1];
> for (const season of seasonCandidates) {
>   const results = await afFetch(`/players?id=${id}&season=${season}`);
>   if (results[0]?.statistics?.length) { profile = results[0]; break; }
> }
> ```
>
> The break condition is "a statistics array came back", not "the player actually
> played". API-Football returns stat blocks for the current season as soon as a player
> is registered to a squad, with zeroed games. So right now, in August, a European
> player is evaluated on the barely-started 2026 season with near-zero minutes, fails
> the quality gate, and is discarded — while his complete 2025-26 season is never
> looked at. This produces a wave of false negatives every season turnover.
>
> Fix: fetch all candidate seasons and select the one with the most total minutes,
> rather than breaking on the first non-empty array.
>
> - Write one shared helper used by both call sites — do not duplicate the loop.
> - Sum minutes across stat blocks, excluding friendly competitions, consistent with
>   how `applyQualityGate` already treats them.
> - If every season returns zero minutes, return the most recent season that had any
>   statistics at all, so a genuinely new player still gets a profile rather than
>   nothing.
> - If no season returns any statistics, return null — same as today.
> - Log which season was selected and its minute total at debug level.
>
> Keep `[currentYear, currentYear - 1]` as the season list for now. Do not widen it —
> that changes API quota consumption and I want to measure the effect of this fix
> first.
>
> ## Constraints
>
> - Do not change `MIN_STARTS`, `MIN_MINUTES`, the signal registry, weights, or
>   `ELIGIBILITY_MIN_SCORE`.
> - Do not change `evaluateEligibility.ts`.
> - Do not change the age gate, the dismissal logic, or `knownApiIds` construction.
>   I know there are issues there; they are separate work.
> - Do not change any frontend file or the OpenAPI spec.
> - No schema changes, no migrations.
>
> ## Tests
>
> Add unit tests for both:
>
> 1. A candidate whose fetch yields no profile gets `lastScoredAt` written and is not
>    re-selected first on the following run. Assert status and confidence are unchanged.
> 2. Given a current season with statistics but zero minutes and a prior season with
>    real minutes, the season selector returns the prior season.
> 3. Given both seasons at zero minutes but statistics present, it returns the most
>    recent season rather than null.
> 4. Given no statistics in any season, it returns null.
>
> Run `pnpm run typecheck`, `pnpm run lint`, and the full test suite before finishing.
>
> ## Report back
>
> Tell me what the season selector now picks for a handful of existing candidates —
> specifically whether any that previously failed the quality gate would now pass it.
> Do not change the quality gate based on that; I just want the number.

---

## After it lands

The rescore runs at startup only, so restart the workflow to drain the backlog. With
the cap at 50 and 110 pending candidates, expect two or three restarts before the
queue is fully scored. Watch for `skippedNoStats` in the logs — if it is large, that
tells you how many candidates API-Football simply has no data for, which is a
different problem from the deadlock.

Then, before deciding anything about the quality gate or discovery scope:

```sql
SELECT signal_type, count(*) FROM eligibility_signals GROUP BY 1 ORDER BY 2 DESC;

SELECT eligibility_confidence, count(*) FROM player_candidates
WHERE status = 'pending' GROUP BY 1 ORDER BY 1 NULLS FIRST;
```

And run `POST /admin/backfill-candidate-birthplace`, so `us_state_birthplace` can fire
and scores start to differentiate instead of clustering at a single value.
