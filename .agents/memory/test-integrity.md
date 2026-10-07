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
