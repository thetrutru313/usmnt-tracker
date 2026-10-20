# Prompt 24 — review decision and completion

## Current decision — October 20, 2026

The user authorized finishing Prompt 24 with **no further production access of
any kind**. The earlier stop and its evidence are preserved below as history.

- The production POST is accepted; no cleanup or record inspection.
- Standing safety rule: read-only production checks mean direct GET requests
  only to API endpoints and static assets. Never load the production app in a
  browser, because startup writes.
- Task B is closed: the omission was not reproduced; the recorded endpoints
  contain broadcast fields and the deployed shared chunk renders them.
  **Possible cause:** stale browser or service-worker state on the user's device.
  No Task B code change.
- Finish only the reviewed Task A changes and documentation; rerun checks,
  push the existing local commits and documentation, and wait for CI.
- Do not publish.

## Original review question — now answered

**Should I finish the dev changes and CI without any more production access?**

- **Finish the dev changes and CI — the user's latest decision.**
- Stop for review — the earlier decision, since superseded.

The authorization is limited to local verification, documentation, Git push,
and GitHub CI. It does not permit any production access, production cleanup,
or publishing.

## Why work stopped

**Confirmed:** during the fresh-browser production check, application startup
automatically sent `POST /api/follows/users`. Production logs recorded:

```text
2026-10-20T15:19:38.591Z
method: POST
url: /api/follows/users
statusCode: 201
```

The browser check was therefore **not read-only**, contrary to the operating
rule. No click or deliberate record-creation request was needed for the app to
send this request.

**Confirmed by the user:** one anonymous visitor row was created, holding only
a token hash, as for any first-time visitor. The existing cleanup job removes
it after 90 days with no follows. The exact record was not inspected in the
production database and will not be inspected or touched.

**Confirmed:** no production cleanup was attempted. No production SQL writes
were issued by the agent. That does not negate the application-generated POST.
No further production access is authorized or being performed.

## Step 0 — confirmed before changes

- `FixtureCard.tsx` displays the home team, then `vs`, then the away team in
  both its mobile and desktop layouts.
- `MatchDetail.tsx` displays home on the left, away on the right, and scores
  in home–away order.
- `ScheduleMatchRow.tsx` was the USA-first exception: USA flag first, `@` for
  USA-away matches, only the opponent's name, and USA-first scores.

## Task A — changes present locally

**Confirmed:** `ScheduleMatchRow` now displays:

```text
[home flag] [home name] [vs or home–away score] [away flag] [away name]
```

- Both names are rendered; each has its own truncating span.
- `@` is no longer rendered.
- Live and finished scores use `homeScore–awayScore`, retaining `LIVE · ` and
  `FT · ` prefixes.
- Both flags use the former larger USA size: **20 × 20 pixels**.
- The existing date/time column, venue/city text, broadcast rules, typography,
  link behavior, and color tokens are retained.
- At narrow widths, broadcast moves below the matchup and remains untruncated.
- The component documentation was updated.

### Application and test files

1. `artifacts/usmnt-tracker/src/components/ScheduleMatchRow.tsx`
2. `artifacts/usmnt-tracker/src/test/ScheduleMatchRow.test.tsx`
3. `artifacts/usmnt-tracker/src/test/NovemberFixtures.test.tsx`

This review report and an internal read-only-browser safety note/index are
documentation additions. No backend, API contract, database schema,
service-worker, or cache implementation change was made for Prompt 24.

## A6 — every rewritten existing assertion

| Location | Old expectation | New expectation |
|---|---|---|
| `ScheduleMatchRow.test.tsx`, test 9, USA-away rerender | `getByText("@")` exists | `getByText("vs")` exists; `queryByText("@")` does not exist |
| `NovemberFixtures.test.tsx`, test 4 | Image with alt `USMNT` uses the USA-away logo | Image with alt `USA` uses that same logo; added an explicit flag DOM-order assertion of `["Haiti", "USA"]` |
| `NovemberFixtures.test.tsx`, hero test 5 | Hero contains `@` | Hero contains two `USA` names and two `vs` labels, and contains no `@` |

The USA-home `vs` assertion and existing date/time, broadcast, and link
assertions were retained. No existing USA-first score assertion was found;
new score-order tests were added instead. No tests were deleted.

## Red-then-green evidence

**Confirmed:** tests were edited before changing the component.

The focused pre-change run had **19 passing and 8 failing tests**. All four
requested change-verifying cases failed on assertions:

1. Haiti-home scheduled: no `@`, Haiti before USA.
2. USA-home scheduled: USA before Haiti, with `vs`.
3. Finished Haiti 0–2 USA: `FT · 0–2`.
4. Finished USA 1–0 Canada: `FT · 1–0`, USA before Canada.

An additional live Haiti 0–2 USA test failed on the old USA-first score.
The other three failures were the authorized existing-assertion rewrites
listed above.

**Confirmed after implementation:** all 27 focused tests passed as part of
the full frontend run. Every one of the 19 pre-change passing tests stayed
green, including the scheduled/live broadcast combinations, finished-row
broadcast exclusion, link behavior, and `Time TBD`.

An added Dashboard hero broadcast regression test passed both before and
after, using the production-reported `TNT` / `HBO Max` field values.

## Task B — production broadcast diagnosis

### Endpoint evidence

**Confirmed:** both endpoints returned HTTP 200. These were direct GETs.

| Endpoint | Fixture ID | Home | Away | Status | tvNetwork | streamingService |
|---|---:|---|---|---|---|---|
| `/api/dashboard` | 4031 | Haiti | USA | scheduled | TNT | HBO Max |
| `/api/dashboard` | 4032 | USA | Haiti | scheduled | TNT | HBO Max |
| `/api/schedule` | 4031 | Haiti | USA | scheduled | TNT | HBO Max |
| `/api/schedule` | 4032 | USA | Haiti | scheduled | TNT | HBO Max |

Dashboard records were under `nextScheduleEvent.fixtures`; Schedule records
were under the Nations League event's `fixtures`.

### Deployed bundle evidence

**Confirmed:** the deployed entry was `/assets/index-CcFov0N8.js`.

- Dashboard chunk: `/assets/Dashboard-CjcF_DUl.js`
- Schedule chunk: `/assets/Schedule-VLaK5eLA.js`
- Shared row chunk: `/assets/schedule-CuNgcdRZ.js`

Both page chunks import the same shared row export. That shared chunk contains
the scheduled/live condition, `tvNetwork`, `streamingService`, the ` · ` join,
and `data-testid="match-row-broadcast"` rendering.

The absence of these strings directly inside the Dashboard page chunk is not
evidence of missing rendering: the implementation resides in its imported
shared chunk.

### Layout and cause

**Confirmed before the home-first change:** at 1280px, both dev hero broadcast
elements were in the DOM, had `display: flex` and `visibility: visible`, had
positive dimensions, and were not clipped by any ancestor.

The fresh production browser also showed both lines at 1280px with no
clipping. This is the browser check that caused the unauthorized POST described
above; it was not repeated.

**Confirmed:** the reported omission was not reproduced in a fresh browser.
Neither missing endpoint fields nor absent deployed rendering explains the
observed current responses.

**Possible:** stale browser/service-worker state or cached client data caused
the user's earlier observation.

**Unable to verify:** the original browser's cache, service-worker state, and
exact cause. A cache-only cause is not established.

No speculative broadcast, service-worker, or cache fix was made.

## Verification completed in dev

| Check | Result |
|---|---|
| Lint | Passed: 0 errors; 8 warnings in unchanged files |
| Workspace typecheck | Passed |
| Full frontend suite | Passed: 255 tests across 16 files |
| Workspace build | Passed |
| Four requested change-verifying cases | Assertion failures before; passed after |
| Broadcast/link/Time TBD guards | Passed before and after |
| Dev frontend and API workflows | Started successfully |

### Visual checks

**Confirmed:** hero and Schedule event card were inspected at both **375px**
and **1280px**, using screenshots and DOM geometry checks.

| Page | Width | Haiti-home row | USA-home row | Broadcast |
|---|---:|---|---|---|
| Dashboard hero | 375px | Haiti vs USA | USA vs Haiti | `TNT · HBO Max` on each row, visible and untruncated |
| Schedule | 375px | Haiti vs USA | USA vs Haiti | `TNT · HBO Max` on each row, visible and untruncated |
| Dashboard hero | 1280px | Haiti vs USA | USA vs Haiti | `TNT · HBO Max` on each row, visible and untruncated |
| Schedule | 1280px | Haiti vs USA | USA vs Haiti | `TNT · HBO Max` on each row, visible and untruncated |

Both names were fully visible for these Haiti rows at 375px. Both flags
measured 20 × 20px. Broadcast scroll width equalled client width and no
horizontal ancestor clipping was detected. Venue/city remained hidden on
mobile and visible on desktop. `Time TBD` remained visible on the first leg.

Checks used a fresh UTC browser context: date labels were Nov 15 / Nov 18,
with `Time TBD` / `12:00 AM UTC`. Date/time formatting code was unchanged.

The dev screenshot emitted CSP inline-script warnings and a 404 resource
warning. Their origin was not investigated; no CSP change was made.

## Historical Git, CI, and publication status at the stop

**Confirmed:** the agent did not issue a manual Git commit or push for Prompt
24, did not wait for or report a CI result, and did not publish.

**Correction to the earlier wording “nothing has been committed”:** a local
read-only history check now shows commit `5133266`, titled
`Refactor match row component and update associated tests`, containing the
home-first implementation. The agent did not issue that commit command.
Its creation mechanism, remote publication status, and CI state were not
verified. No remote lookup was performed after the stop.

The source files were clean in local Git before adding this review document
and safety documentation. At that point the work was stopped for review,
not delivered as a completed/CI-verified Prompt 24.

## Restrictions recorded at the earlier stop

- Any further implementation or investigation.
- Any further production access.
- Commit/push actions and GitHub CI verification.
- Production cleanup or record inspection.
- Publishing.

The later decision permits local checks, documentation, pushing, and CI only.
Production access, record inspection/cleanup, and publishing remain prohibited.

## Completion scope confirmation

**Confirmed locally after the review decision:** the three Task A files are
unchanged from commit `5133266`. Relative to the prior pushed work, the only
other files are this report, safety documentation/index, and automatically
generated Library metadata registering the Markdown reports. There are no
additional application changes.

The existing local documentation commit is `f1663f9`; local history also
includes generated report-asset metadata commit `8240e26`.

## Fresh verification after the review decision

**Confirmed:** reran the requested checks once after authorization:

| Command | Result |
|---|---|
| `pnpm run lint` | Passed: 0 errors; the same 8 warnings in unchanged files |
| `pnpm run typecheck` | Passed across workspace libraries and artifacts |
| `pnpm --filter @workspace/usmnt-tracker run test` | Passed: 255 tests, 16 files |
| `pnpm -r --if-present run build` | Passed |

The recursive build command runs the workspace builds without unnecessarily
repeating the root build wrapper's typecheck. No application source changed
after these checks.

**Confirmed:** no production requests, browser loads, database inspection,
deployment-log retrieval, cleanup, or publishing were performed during this
completion pass. Only local files/commands and the authorized GitHub push/CI
operations are involved.

The final pushed hash and observed GitHub CI outcome are supplied in the
completion delivery rather than embedded in a report committed before CI runs.
