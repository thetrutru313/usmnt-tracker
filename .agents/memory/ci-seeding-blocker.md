---
name: CI seed assumptions
description: Distinguishing historical fresh-database test failures from current CI evidence
---

Do not treat an old fresh-database seeding failure as a standing CI blocker.
Inspect the current tests and current run before recommending a seed step.
Integration tests should own their required rows rather than silently depend on
the sports data present in development.

**Why:** Earlier fresh-database runs failed on player/club assumptions hidden by
seeded development data. A later verified run passed with the existing
schema-only workflow, disproving the earlier claim that seeding was always
required. A green parallel run alone does not prove every historical data
dependency has been removed.

**How to apply:** If missing data causes a current CI failure, inspect the failing
test's fixture setup and shared-database writers. Do not add unrequested seeding
or change CI solely because this historical note once described a blocker.
