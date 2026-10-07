# Prompt 21 — Broadcast info and clickable results on match rows

This report records the completed implementation and verification. No checks were rerun to create this download.

## Result

**Confirmed:** Committed and pushed to `origin/main`:

```text
f2e0199ca7f262705c4200802fbeedd1fc71b77d
```

**Confirmed:** [CI passed for that exact commit](https://github.com/thetrutru313/usmnt-tracker/actions/runs/37699831035).

## Files changed

**Confirmed:** The implementation commit changed:

- `artifacts/usmnt-tracker/src/components/ScheduleMatchRow.tsx`
- `artifacts/usmnt-tracker/src/test/ScheduleMatchRow.test.tsx`
- `artifacts/usmnt-tracker/src/pages/Dashboard.tsx`

**Confirmed:** The dashboard wrapper changed to prevent nested links when live or finished rows link to match details. “View full schedule” remains a separate link. `Schedule.tsx` and the existing November tests were unchanged.

## Implemented behavior

**Confirmed:** Scheduled and live rows show broadcast information when at least one broadcast value is a non-empty string. Both values render as `TNT · HBO Max`; one value renders alone without a separator. Null, empty, and whitespace-only values are excluded.

**Confirmed:** The broadcast line uses `data-testid="match-row-broadcast"` and a 10px MonitorPlay icon. It renders once in the DOM, below the desktop venue line, using the same text size and colour. Below the `sm` breakpoint, the venue remains hidden while the broadcast line remains visible.

**Confirmed:** Finished rows render no broadcast line. Finished and live rows use a wouter Link to `/matches/${fixture.id}`, with the aria-label `${fixture.homeTeam} vs ${fixture.awayTeam} — match details`. Other statuses remain non-interactive.

**Confirmed:** Linked rows retain the same base layout classes as unlinked rows and add a pointer cursor, token-based hover background, and an inset keyboard-focus ring. The component doc comment now describes navigation and warns against wrapping it in a parent link.

## Red-then-green evidence

**Confirmed:** Each change-verifying test failed against the unchanged component, then passed after implementation.

| Test | Before | After |
|---|---|---|
| 1. Scheduled: TNT + HBO Max | FAIL — broadcast element absent | PASS |
| 2. Scheduled: TV only, no separator | FAIL — broadcast element absent | PASS |
| 3. Live: broadcast line | FAIL — broadcast element absent | PASS |
| 4. Finished: match-details link | FAIL — link absent | PASS |
| 5. Live: match-details link | FAIL — link absent | PASS |

**Confirmed:** Regression guards passed before and after:

| Guard | Before | After |
|---|---|---|
| Finished row with TNT + HBO Max has no broadcast line | PASS | PASS |
| Scheduled row is not a link | PASS | PASS |
| Scheduled row with null broadcast values has no broadcast element | PASS | PASS |
| USA-home `vs` and USA-away `@` remain correct | PASS | PASS |
| Existing November tests, including “Time TBD,” unchanged | PASS | PASS |

**Confirmed:** The baseline command ran the full frontend suite, rather than only the two named files:

```sh
pnpm --filter @workspace/usmnt-tracker run test -- src/test/ScheduleMatchRow.test.tsx src/test/NovemberFixtures.test.tsx
```

- Before implementation: **5 failed, 240 passed across 16 files**
- After implementation: **245 passed across 16 files**

## Ordered verification

**Confirmed:** All requested checks passed:

| Command | Result |
|---|---|
| `pnpm run lint` | PASS — 0 errors, 8 existing warnings |
| `pnpm run typecheck` | PASS |
| `pnpm --filter @workspace/usmnt-tracker run test` | PASS — 245 tests across 16 files |
| `pnpm run build` | PASS — including the frontend production build |

## Dev visual check

**Confirmed:** Inspected the dashboard hero and Schedule page at **375px and 1280px**.

| Surface | Width | Observed |
|---|---:|---|
| Dashboard hero | 375px | Both Haiti legs show `TNT · HBO Max` without truncation; venue text is hidden. The narrow hero can truncate the opponent name. |
| Dashboard hero | 1280px | Both Haiti legs show broadcast text beneath the venue, right-aligned. |
| Schedule page | 375px | Both Haiti legs show broadcast text without truncation; venue text is hidden. |
| Schedule page | 1280px | Both Haiti legs show broadcast text beneath the venue, right-aligned. |

**Confirmed:** The November 14 leg shows `@ Haiti`, “Time TBD,” and `TNT · HBO Max`. The November 17 leg shows `vs Haiti`, its known kickoff time, and `TNT · HBO Max`.

**Confirmed:** The capture browser uses UTC. Those legs therefore displayed as **Nov 15 and Nov 18**, with the return leg showing **12:00 AM UTC**. No timezone or fixture data was changed.

**Unable to verify visually:** No finished October fixture row was present in dev. Finished-row navigation and broadcast suppression were verified in Vitest.

**Unable to verify visually:** Hover and keyboard-focus states were implemented but not interactively checked.

**Confirmed:** Screenshot logs included CSP-blocked inline scripts. These were left unchanged.

## Scope and export note

**Confirmed:** No API, OpenAPI, schema, database, or MatchDetail changes were made. No production database writes and no publish occurred.

**Confirmed:** The subsequent user-requested Markdown export created `reports/match-row-broadcasts-and-results.md` only. It did not rerun checks, modify application code, commit, push, publish, or restart anything.
