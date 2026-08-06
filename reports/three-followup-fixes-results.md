Two items. The first is small and should not wait — CI was just wired up, and a
test that fails in the workflow but passes on manual re-run will teach everyone
to ignore red builds within a week.

────────────────────────────────────────────────────────────────────────
1. youthNtFixtureSync.test.ts is not a flake. It is a time bomb.
────────────────────────────────────────────────────────────────────────

Line 542:

  const FAKE_LIVE_KICKOFF = new Date(Date.now() - 60 * 60 * 1000).toISOString();

This computes a timestamp relative to real wall-clock time and compares it
against the phantom-purge window. Whether it passes depends on when in the run
it executes. That is the same defect class as the 15 frontend date failures,
not an infrastructure hiccup.

Fix it the same way: pin the clock with vi.useFakeTimers in beforeEach and
restore with vi.useRealTimers in afterEach, choosing a fixed instant that puts
FAKE_LIVE_KICKOFF unambiguously inside the intended window. Keep the test's
intent — it should still verify the live-fixture path and the phantom purge.

Then run that file 5 times in a row and confirm 5 clean passes. A single pass
proves nothing about a timing-dependent test.

────────────────────────────────────────────────────────────────────────
2. Redo the time-bomb search. The first pass had a false negative.
────────────────────────────────────────────────────────────────────────

The earlier search looked for `new Date("20xx…")` string literals and cleared 8
files. It missed line 542 above because that code uses Date.now() arithmetic
rather than a date literal — a different spelling of the same problem.

Search both suites again for ALL of these shapes, in any file with no
vi.useFakeTimers in scope:

  Date.now()                     used to build test data or expectations
  new Date()                     with no arguments
  new Date(Date.now() ± n)       relative offsets
  Date.now() ± n                 used in an assertion or a fixture value
  .toISOString() applied to any of the above
  date-fns helpers (subDays, addDays, startOfDay, differenceIn*) called on a
    live date rather than a pinned one

For each hit, state which of these it is:
  (a) SAFE — the value is a static anchor or an input to a pure function that
      never consults the current time
  (b) TIME BOMB — the assertion depends on the relationship between the value
      and the current moment

Report the full list with the classification and your reasoning per file. Fix
only the ones you classify as (b), and say how many you found.

If the count is more than five, stop after reporting and let me look before you
change anything.

────────────────────────────────────────────────────────────────────────

VERIFY:
  pnpm --filter @workspace/api-server run test    (run twice; both must pass)
  pnpm --filter @workspace/usmnt-tracker run test
  pnpm run lint && pnpm run typecheck

Report the 5-run result for youthNtFixtureSync, and the full reclassified
time-bomb list.