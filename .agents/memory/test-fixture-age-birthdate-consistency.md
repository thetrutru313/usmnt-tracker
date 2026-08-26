---
name: Player-discovery test fixtures pair a display `age` with an unrelated `birth.date`
description: playerDiscovery.ts test fixtures often set player.age to a small round number for readability while birth.date is a copy-pasted placeholder from another fixture — fine as long as nothing derives age from birth.date, but breaks the moment it does.
---

Several `playerDiscovery.ts` / `evaluateEligibility.ts` test files set `player.age: 21` (or similar) purely for readability, while `birth.date` is an unrelated placeholder string (e.g. `"2001-04-20"`) copied between fixtures. As long as production code only reads the `age` field for gating, this mismatch is harmless.

**Why it matters:** once age gates are changed to compute live age from `birth.date` (via `ageFromBirthDate`) instead of trusting the stored/mocked `age` field, any fixture whose `birth.date` implies an age over the mocked `getMaxCandidateAge()` cap will silently flip from "passes the gate" to "skipped/dismissed for age" — even though the test's `age` field still looks fine at a glance. This surfaces as insert/update calls never firing (captured arrays staying empty) with no thrown error, which is confusing to debug.

**How to apply:** whenever an age-gate computation source changes (e.g. moving from stored `age` to `ageFromBirthDate(birth.date)`), grep test fixtures for `birth: { ... date: "..."` and recompute each implied age against "today" and the file's mocked max-age cap — don't assume the paired `age` field is representative.
