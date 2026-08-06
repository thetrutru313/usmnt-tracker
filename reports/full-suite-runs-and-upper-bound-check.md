# Full-Suite Runs & Upper-Bound Check
_Generated: 2026-08-06_

---

## Three consecutive full-suite runs

```
pnpm --filter @workspace/api-server run test
```

| Run | Test Files | Tests | Duration |
|---|---|---|---|
| 1 | 84 passed | **712 / 712** ✅ | 43.15 s |
| 2 | 84 passed | **712 / 712** ✅ | 43.61 s |
| 3 | 84 passed | **712 / 712** ✅ | 51.75 s |

Suite C tests passed in all three runs, including runs 2 and 3 where real
wall-clock time accumulated across all 84 test files before Suite C ran. This
is the exact ordering condition that caused the original CI failure. The fix
holds.

---

## Upper-bound check — does `syncYouthNtFixtures` have a lookahead ceiling?

### The bound that exists

`purgePhantomNtFixtures` (`apiFootballSync.ts` line 1622) contains the only
date-range gate in the entire `syncYouthNtFixtures` call path:

```ts
// line 1619
if (row.apiFootballFixtureId !== null) continue;
// …
// line 1622
if (kickoffMs > nowMs + NINETY_DAYS_MS) continue; // too far out — may not be in API-Football yet
```

The 90-day ceiling is real. Fixtures with `apiFootballFixtureId === null` and
a kickoff more than 90 days from `nowMs` are skipped — they are not phantom-purged
because the API may not have published them yet. The insertion path has no
upper bound at all.

### Why the ceiling cannot reach the `+30 d / +35 d / +40 d / +43 d / +50 d` constants

Line 1622 is only reachable after line 1619 has been evaluated. Line 1619
ejects **every row whose `apiFootballFixtureId` is not null**. Every fake
fixture inserted by Suites A and B carries an explicit non-null ID:

| Suite | Kickoff constant | `apiFootballFixtureId` stored | Reaches line 1622? |
|---|---|---|---|
| A | `FAKE_KICKOFF_NEW` (+30 d) | `9_999_200` — non-null | **No** — ejected at 1619 |
| A | `FAKE_KICKOFF_PRESEEDED` (+35 d) | `9_999_201` — non-null | **No** — ejected at 1619 |
| B | `FAKE_GS_KICKOFF_1` (+40 d) | `9_998_100` — non-null | **No** — ejected at 1619 |
| B | `FAKE_GS_KICKOFF_2` (+43 d) | `9_998_101` — non-null | **No** — ejected at 1619 |
| B | `FAKE_KO_KICKOFF` (+50 d) | `9_998_102` — non-null | **No** — ejected at 1619 |

The growing gap between `SUITE_C_NOW` (pinned `2026-06-01`) and
`Date.now() + 30 d` (currently ~96 days ahead of the pinned instant, ~460 days
in a year) is irrelevant: no code path in `syncYouthNtFixtures` can reach those
fixtures through the 90-day gate because they are all bypassed at line 1619
before the gate is evaluated.

### The gap is also irrelevant for a second independent reason

Suite C's `syncYouthNtFixtures` call never encounters Suite A/B's fixtures in
the database. Vitest flushes each `describe` block's `afterAll` hooks before
beginning the next `describe`. The file-level `afterAll` at line 150 and Suite
B's block-level `afterAll` at line 377 both run and delete their rows before
Suite C's first `beforeEach` fires. By the time the pinned clock is active and
`syncYouthNtFixtures` is called in Suite C, those rows do not exist.

### Verdict

Lines 56–57 and 279–281 do **not** need to be pinned to absolute values.
The `Date.now() + n` arithmetic at those lines is safe indefinitely because:

1. The 90-day phantom-purge window is never checked for those rows — the
   non-null `apiFootballFixtureId` guard at line 1619 short-circuits first.
2. Those rows are deleted by Suite A/B's `afterAll` hooks before Suite C
   ever calls `syncYouthNtFixtures`.
3. The offsets (30 d – 50 d) remain well within 90 days of real `Date.now()`
   regardless of what year the suite runs in — so even if the guard were
   reached, the fixtures would still be within the purge window.

No further changes are required to `youthNtFixtureSync.test.ts`.
