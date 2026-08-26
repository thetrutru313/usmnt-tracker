

> The quality score works, but the dry run exposed four problems. Fix them, then re-run
> the dry run so I can compare.
>
> ## 1. The age curve asymptotes when it should collapse
>
> Current curve bottoms at 0.9 for age ≥23. A 31-year-old is therefore penalized barely
> more than a 22-year-old, and volume easily overcomes the difference — which is why
> Delgado (31), Horvath (31), Tafari (29) and Marcinkowski (29) all placed in the top 20.
>
> This is a prospect queue. Past a certain age a player is not a prospect regardless of
> how well he is playing, and no amount of minutes should compensate.
>
> Replace the tail of the curve:
>
> | Age | Multiplier |
> |---|---|
> | ≤16 | 2.0 |
> | 17 | 1.8 |
> | 18 | 1.6 |
> | 19 | 1.4 |
> | 20 | 1.25 |
> | 21 | 1.1 |
> | 22 | 1.0 |
> | 23 | 0.85 |
> | 24 | 0.40 |
> | 25 | 0.20 |
> | ≥26 | 0.10 |
>
> Keep the neutral 1.0 fallback when age is genuinely unknown.
>
> ## 2. Separately — find out why over-age candidates are pending at all
>
> The age gate should have dismissed everyone over 23 well before scoring. Your dry run
> covered 111 pending/needs-review candidates including several 29–31 year olds.
>
> Investigate and report — do not change the age gate yet:
>
> - Which database did the dry run query? Production has 48 pending; 111 suggests dev,
>   or that `needs_review` rows bypass the age dismissal. State the environment
>   explicitly.
> - Does the dismissal path cover `needs_review` status, or only `pending`?
> - Are these candidates over-age because of stale `age` values, or does the gate simply
>   not reach them?
>
> Going forward, every report you produce must state which database it queried. Several
> earlier investigations drew conclusions from dev while I was looking at production.
>
> ## 3. The score scale is compressed into uselessness
>
> Normalization divides by a theoretical maximum of 2.0 that nothing approaches. Real
> raw scores top out around 0.6, so the top of the queue reads 29 and the twentieth
> reads 19 — a one-point gap between ranks 10 and 15, which is noise rather than signal.
>
> Recalibrate so the range is actually used. Either divide by a realistic ceiling
> (~0.7), or rescale against the observed distribution. I want the strongest candidate
> in a typical pool to read in the 80s and genuine separation between adjacent ranks.
>
> Do not change the ordering — only the mapping from raw score to the 0–100 display
> value. Rank order before and after must be identical; assert that in a test.
>
> ## 4. Cup competitions must not be selected as a primary league
>
> DFB Pokal, Coppa Italia, and Leagues Cup were all chosen as primary leagues and
> assigned the 0.25 unknown fallback. That is actively wrong: a Bundesliga player with a
> handful of Pokal appearances can be scored as though the Pokal is his league, dragging
> a strong-league player down to the fallback coefficient.
>
> Exclude domestic and continental cups from primary-league selection entirely. Do not
> give them coefficients — they should never be the league a player is judged by.
>
> Primary league should be the league competition with the most minutes. If a candidate
> has *only* cup appearances, fall back to the unknown-league coefficient and log it,
> rather than picking a cup.
>
> Also exclude national-team competitions from primary-league selection, for the same
> reason.
>
> ## 5. The club field is showing national teams
>
> Corcoran, Norris, and Baker-Whiting all display "United States U20" as their club,
> with "Major League Soccer" as their league — so the team shown does not match the
> league shown. Find where the displayed club comes from and make it the club
> corresponding to the selected primary league, not whichever stat block happened to be
> read first.
>
> ## Constraints
>
> - Do not change the formula's shape. It stays
>   `leagueStrength × ageMultiplier × performance`.
> - Do not change the minutes saturation curve, the rating floor, or the starts weighting.
> - Do not change eligibility scoring, signal weights, or `DUAL_NATIONAL` logic.
> - Do not change the age gate or dismissal behaviour — item 2 is investigation only.
> - Migrations DDL only; give me any data changes as separate SQL to run by hand.
>
> ## Tests
>
> - A 26-year-old with 3,000 minutes in Serie A ranks below a 19-year-old with 800
>   minutes in Serie A.
> - A Bundesliga player with 2,000 league minutes and 200 DFB Pokal minutes is scored
>   with the Bundesliga coefficient, not the fallback.
> - A player with only cup appearances gets the unknown-league coefficient and logs a
>   warning.
> - Rescaling preserves rank order exactly.
>
> Run `pnpm run typecheck`, `pnpm run lint`, and the full suite.
>
> ## Report back
>
> Re-run the read-only dry run over the same candidate set and give me the top 20 in the
> same format, plus the answers to item 2. State which database you queried.

