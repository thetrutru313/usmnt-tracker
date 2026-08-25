# Replit prompt — Turn 2: implement the U17/U20 fix

Send this after the diagnostic. It incorporates what the diagnostic found, including two
things that change the approach.

---

> Your diagnostic is correct and I'm working from it. Implement the fix now.
>
> The root cause: `is_national_team` is `true` for senior, U17, and U20 alike, and there
> is no other discriminator in the schema. Every senior-only surface is therefore asking
> a question the database cannot answer. We are going to add the missing column.
>
> ## 1. Schema
>
> Add `nt_level` to the `fixtures` schema in `lib/db/src/schema/`. Text, nullable.
>
> - `NULL` when `is_national_team = false` (club fixtures)
> - `'SENIOR' | 'U23' | 'U20' | 'U17'` when `is_national_team = true`
>
> Generate the migration with `drizzle-kit generate` per `lib/db/README.md`. Never
> `drizzle-kit push`.
>
> ## 2. Derivation helper
>
> `isUsMensNationalTeamName()` already exists in `apiFootballSync.ts` and matches both
> senior and youth by design. Leave it alone — other call sites depend on that behaviour.
>
> Add a new exported function beside it, `deriveNtLevel(homeTeam, awayTeam)`:
>
> - Identify the US side (`"USA"` or `/^United States/`)
> - Read the age suffix from **that side only**. Never the opponent — U20 fixtures have
>   faced `Georgia U21` and `North Macedonia U21`, and reading the opponent would
>   mislabel them.
> - US side has no age suffix → `'SENIOR'`
> - US side matches `/\bU(\d{2})\b/` → `'U17'`, `'U20'`, `'U23'` accordingly
> - Neither side is a US team → return `null` and log a warning
>
> Every write path and the backfill use this one function. No duplicated regex.
>
> ## 3. Set `nt_level` on every write path
>
> The diagnostic identified these. All of them must populate it:
>
> - **`artifacts/api-server/src/index.ts` — the startup youth fixture seed.** This is raw
>   SQL, so a Drizzle-level default will not reach it. Add the column to the INSERT
>   column list with literal values (`'U20'`, `'U17'`) matching each row.
> - **`artifacts/api-server/src/index.ts` — the startup senior sentinel seed.** Same, with
>   `'SENIOR'`.
> - **`syncYouthNtFixtures()`** in `apiFootballSync.ts` — the insert path that creates new
>   youth rows on an ongoing basis. Use `deriveNtLevel()`.
> - **Club fixture sync upsert** in `apiFootballSync.ts` — it sets `isNationalTeam` from
>   `isUsMensNationalTeamName()`, so it can produce national-team rows of any age group.
>   Set `nt_level` in the same `values` object, using `deriveNtLevel()`.
> - **`scripts/src/seedUsmnt.ts`** — its one senior fixture gets `'SENIOR'`.
>
> A national-team row that `deriveNtLevel()` cannot classify should be logged loudly, not
> written with a silent default.
>
> ## 4. Shared predicate — allowlist, not denylist
>
> Create `isSeniorNtFixture()` in one module. True only when
> `is_national_team === true && nt_level === 'SENIOR'`. Provide the Drizzle condition
> equivalent for use in queries.
>
> Write it as an allowlist. A row with null or unrecognised `nt_level` must fail closed —
> out of the hero — never fail open into it. That inversion is the fix; everything else
> is scaffolding.
>
> ## 5. Apply it to the surfaces — exactly two queries change
>
> Your render trace confirmed the hero and the Upcoming Matches card are fed by
> independent queries, so this is a narrow change.
>
> **Change these two, both currently bare `eq(fixturesTable.isNationalTeam, true)`:**
>
> - `routes/dashboard.ts:211-221` — the `nextEventFixtures` query that populates
>   `nextScheduleEvent.fixtures`. This is the hero's only fixture source.
> - `routes/schedule.ts:56-66` — the USMNT Schedule page query.
>
> Add the senior condition alongside the existing `isNationalTeam` check and kickoff
> window. Nothing else about either query changes.
>
> **Leave these completely unchanged:**
>
> - `routes/dashboard.ts:47-77` — `todaysGamesRaw` and `upcomingGamesRaw`, which feed the
>   Upcoming Matches card. Youth fixtures must keep appearing there.
> - `GET /api/fixtures` in `routes/fixtures.ts` — the Fixtures page keeps all age groups.
>
> Do not touch the `or(isNationalTeam, notIlike(competition, '%Friendlies%'))` branch or
> the linked-player guard in the two list queries. They are behaving as intended.
>
> No frontend changes. No OpenAPI or codegen changes. `Dashboard.tsx` and `Schedule.tsx`
> are not modified — the filtering is entirely server-side.
>
> **One thing to check before you finish:** the hero query is scoped to the next
> `schedule_events` row's date window. Confirm that `schedule_events` contains only
> senior windows. If any row represents a youth tournament, filtering its fixtures to
> senior will leave that event with an empty `fixtures` array, and the hero will fall
> back to rendering `nextEvent.description`. Tell me if you find any such rows rather
> than working around it.
>
> ## 6. Do not touch
>
> - `syncNationalTeamFixtures()` and `promoteNtSentinelIds()` — no unbound sentinels
>   exist; they are not involved.
> - `isUsMensNationalTeamName()` — other call sites rely on it matching youth too.
>
> ## 7. Backfill — do not put it in a migration
>
> Per `lib/db/README.md`, Replit's Publish computes a schema diff. DDL crosses to
> production; DML does not. A backfill written into a migration will silently never reach
> production, leaving every `nt_level` null there — and with a fail-closed predicate the
> hero would then fall back to rendering `nextEvent.description` with no match tiles, and
> the Schedule page would show empty windows. Quiet enough to miss, so the backfill must
> run before the schema change publishes.
>
> Put only the `ALTER TABLE` in the migration. Give me the backfill `UPDATE` as a separate
> SQL block in your response, which I will run by hand in the Replit database console
> against production before publishing. It should classify all 666 existing rows and
> report how many landed in each bucket.
>
> ## 8. Tests
>
> Add a test asserting what each surface returns for: a senior fixture, a U17 fixture, a
> U20 fixture, a club fixture, and a national-team fixture with `nt_level = NULL`.
>
> - Hero and schedule: senior only
> - `todaysGames` and `upcomingGames`: senior, U17, U20, and club fixtures all present —
>   assert the youth rows are still there, so a future change cannot quietly drop them
> - Fixtures page: all of them
> - The null row must not appear on the hero or the schedule
>
> Run `pnpm run typecheck` and `pnpm run lint` before finishing.
>
> ## 9. Docs
>
> `replit.md` states youth NT fixtures are seeded inline in the main seed script. That is
> wrong — `seedUsmnt.ts` contains no youth fixtures; they are raw SQL in
> `artifacts/api-server/src/index.ts`. Correct that, and document the `nt_level` column
> and the predicate.

---

## Follow-ups — separate turns, after the above lands

**Duplicate U17 rows.** Three February 2025 matches exist twice, each once as
`'CONCACAF U17'` and once as `'World Cup - U17'` with different
`api_football_fixture_id` values, so a duplicate-ID check misses them:

- US vs St. Kitts and Nevis U17, 2025-02-13 (ids 4545, 4552)
- US vs US Virgin Islands U17, 2025-02-11 (ids 4547, 4551)
- US vs Cuba U17, 2025-02-16 (ids 4546, 4553)

Ask which label is correct, whether ingest can reproduce this when API-Football lists one
match under two league IDs, and get the DELETE as hand-run SQL.

**Startup seed re-running.** The raw SQL youth seed in `index.ts` runs on every cold
start. Fixtures 14449–14452 were created today by it. Confirm it is idempotent — that it
has an `ON CONFLICT` guard or an existence check — since Autoscale cold-starts frequently.

**Optional: `purgePhantomYouthNtFixtures()`.** It identifies youth rows by team-name
regex. Once `nt_level` is populated it could read the column instead. Low priority, and
it is a delete path, so change it deliberately rather than as a drive-by.

**Optional: expose `nt_level` in the API contract.** Not needed for this fix — the
filtering is entirely server-side. Worth doing only if you want `FixtureCard` to badge
youth fixtures differently instead of showing `INTERNATIONAL` for every age group. Add
the field to `lib/api-spec/openapi.yaml` and re-run
`pnpm --filter @workspace/api-spec run codegen`.
