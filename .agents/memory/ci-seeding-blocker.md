---
name: CI api-server test seeding blocker
description: Three integration test files fail in a schema-only CI database and need seed rows before the api-server test step can be green.
---

Three test files in `artifacts/api-server/src/lib/__tests__/` fail on a fresh schema-only DB (no seeded rows).
They pass on the Replit dev database which has real seed data.

| File | Failure | Needs |
|---|---|---|
| `coleCampbellNoStatsGraceful.test.ts` | "Cole Campbell not found in players table" | A seeded `players` row for Cole Campbell |
| `recoveryRoundTrip.test.ts` | "No players found in the database" | At least one seeded `players` row |
| `rescoreCapOrderingIntegration.test.ts` | FK violation on `clubs` table (`club_id=1`) | A seeded `clubs` row (id=1) |

**Why:** These tests were written against the dev DB and rely on pre-existing rows rather than inserting their own fixtures.

**How to apply:** When adding a CI seed step or deciding to convert these tests to self-contained fixtures, address all three together. The CI workflow at `.github/workflows/codegen-drift.yml` includes the api-server test step with a comment noting these files as the blocker.
