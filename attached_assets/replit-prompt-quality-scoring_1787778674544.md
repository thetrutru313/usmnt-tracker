
> Add a prospect **quality score** to the candidate pipeline, separate from the existing
> eligibility confidence. Eligibility answers "can he play for the US"; quality answers
> "is he worth my attention". They are different questions and must not share a number.
>
> Do not modify the eligibility scoring, its signals, or its weights. This is additive.
>
> ## 1. Normalize league identity first
>
> `clubs.league` is inconsistent — "MLS" and "Major League Soccer" both appear for the
> same league. Any coefficient keyed on that string would give the same league two
> different values.
>
> Key everything on **API-Football's numeric league id**, which is present in the
> `league.id` field of every stat block the scorer already reads. Do not key on names.
>
> ## 2. League strength coefficients
>
> Create a `league_strength` table: `api_football_league_id` (pk), `name`,
> `coefficient` (numeric), `updated_at`.
>
> Seed defaults from a version-controlled file (`leagueStrengthDefaults.ts`) on server
> startup, inserting **only leagues not already present**. A hand-tuned coefficient must
> never be overwritten by a restart — insert-if-missing, never upsert.
>
> Starting values (tune later):
>
> | League | Coefficient |
> |---|---|
> | Premier League, La Liga, Bundesliga, Serie A, Ligue 1 | 1.00 |
> | Eredivisie, Primeira Liga, Championship (England) | 0.75 |
> | Belgian Pro League, Austrian Bundesliga, Swiss Super League, Danish Superliga | 0.65 |
> | 2. Bundesliga, Serie B, Ligue 2, La Liga 2, Liga MX | 0.60 |
> | Major League Soccer | 0.55 |
> | USL Championship | 0.30 |
> | MLS Next Pro, USL League One | 0.25 |
>
> Look up the real API-Football league ids rather than guessing them, and report which
> ids you used.
>
> **Unknown leagues** get a default coefficient of 0.25 — the MLS Next Pro level — and
> log a warning naming the league and its id, so I can see what is showing up
> unclassified and add it. Do not silently assign zero; that would bury players in
> leagues I simply have not classified yet.
>
> ## 3. The formula
>
> Quality is **multiplicative**, not additive. League strength must gate the score
> rather than being one term among several — a strong performance in a weak league
> should not accumulate its way past a modest performance in a strong one.
>
> ```
> quality = leagueStrength × ageMultiplier × performance
> ```
>
> **performance** — combine minutes, starts, and rating for the selected season:
>
> - Minutes must **saturate**, not scale linearly. Use a square-root or log curve so the
>   gap between 200 and 900 minutes matters and the gap between 2,400 and 3,100 barely
>   does. Volume is exactly what a young prospect lacks, and linear minutes would let
>   established starters dominate on volume alone.
> - Rating only counts above a minutes floor — ignore it below roughly 300 minutes. A
>   7.4 average from one appearance is noise.
> - Starts relative to appearances indicates trust from the manager; weight it modestly.
>
> **ageMultiplier** — reward being young. The curve must be steep enough that a 17-year-
> old with limited minutes outranks a 22-year-old with substantially more in the same
> league, because that is the ranking I actually want. Something like:
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
> | 23 | 0.9 |
>
> Compute age from `date_of_birth`, falling back to the `age` column only when no birth
> date exists — same precedence as the existing age gates.
>
> Normalize the final result to 0–100 for display.
>
> ## 4. Storage and surfacing
>
> - Add `quality_score` (integer, nullable) and `quality_scored_at` (timestamp, nullable)
>   to `player_candidates`.
> - Compute and write it wherever eligibility is computed — the discovery insert, the
>   `onConflictDoUpdate` branch, and `rescoreAllCandidates`.
> - Add it to the review-queue API response and the OpenAPI spec, then re-run
>   `pnpm --filter @workspace/api-spec run codegen`.
> - In `AdminReviewQueue.tsx`, display it alongside eligibility confidence and **make it
>   the default sort**, descending. Eligibility confidence stays visible but stops being
>   the ordering.
> - Show the league and coefficient used for each candidate, so I can see at a glance
>   why someone scored the way they did.
>
> ## 5. Store the inputs, not just the output
>
> Persist the components that produced the score — league id, coefficient, age
> multiplier, and the performance subtotal — either as columns or a small JSON column.
> When I retune coefficients I need to see what changed and why, and a bare score makes
> that impossible.
>
> ## Constraints
>
> - Do not change eligibility scoring, signal weights, `ELIGIBILITY_MIN_SCORE`, or the
>   `DUAL_NATIONAL` logic.
> - Do not change the age gate that dismisses candidates. Quality scoring ranks; it does
>   not filter.
> - Do not change discovery scope.
> - Migrations are DDL only. Per `lib/db/README.md`, Publish carries the schema diff but
>   not data, so give me any seed or backfill SQL separately to run by hand.
>
> ## Tests
>
> - A 17-year-old with 600 minutes in the Bundesliga outranks a 22-year-old with 2,500
>   minutes in the Bundesliga.
> - A 22-year-old with 2,500 minutes in the Bundesliga outranks a 22-year-old with 2,500
>   minutes in USL Championship.
> - A 22-year-old with 3,000 minutes in USL Championship does **not** outrank a
>   17-year-old with 400 minutes in the Premier League.
> - A candidate in an unclassified league receives the 0.25 default and logs a warning.
> - Rating is ignored below the minutes floor.
> - A hand-edited coefficient in `league_strength` survives a server restart.
>
> Run `pnpm run typecheck`, `pnpm run lint`, and the full suite.
>
> ## Report back
>
> Once implemented, run a **read-only dry run** over all pending candidates and show me
> the top 20 by quality score, with name, age, club, league, coefficient, minutes, and
> final score. Do not write scores to the database — I want to sanity-check the ranking
> before it becomes the queue's default order.

---

