---
name: Test integrity
description: Product-owner constraints on regression evidence and frontend timer failures
---

Do not alter working code to manufacture a failing baseline. Report a regression test that already passes as passing.

Frontend timer errors that make the test command exit nonzero are required scope, not optional cleanup. Fix component unmount cleanup while preserving mounted behavior; do not suppress unhandled errors, filter rejections, or introduce fake timers to conceal them.

Date-dependent regression tests must freeze the clock rather than depend on the actual date. Freezing Date for formatting tests is distinct from faking animation timers to conceal lifecycle defects.

**Why:** The product owner explicitly requires truthful before/after evidence and green CI without hiding real defects.

**Why freeze dates:** The product owner reports that this repo has already shipped two tests that failed on a future date.

**How to apply:** Use real timers for animation-unmount regressions and assert that the actual pending timeout is cancelled. Audit other timers when requested, but do not broaden a narrowly authorized cleanup beyond the instances firing in the suite.

New database tests must use rolled-back transactions, temp shadows of every
table they control, and 2099 timestamps when time matters. Existing
November/December fixture guards keep their specified 2026 dates and pinned
clocks; the future-date rule applies only to new tests.

**Why:** The product owner explicitly required isolation without changing the
real-date fixture assertions or the unchanged baseline.

Isolate incidental metadata loaders and diagnostic writes in legacy tests
whose database responses are queued by call order. Preserve the business
assertions and the original business-query sequence.

**Why:** An added metadata read consumed a queued form-stat response and
shifted every later input. Nonempty fixtures exposed a wrong score, while
tests with empty fallback responses concealed the same unexpected read.

**How to apply:** Confirm the actual call sequence before changing mocks.
Mock the incidental loader explicitly, cover its diagnostic persistence in
focused integration tests, and remove temporary call tracing before committing.

**How to apply:** Convert rewritten DB tests to isolation, but preserve all
existing behavior assertions. Do not treat baseline permission as permission
for new tests to modify public development rows.
