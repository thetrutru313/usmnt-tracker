---
name: Shared-database test writers
description: Diagnosing national-team repair interference between parallel integration tests
---

Integration tests against the shared development database can observe links added
by a different test's global national-team repair pass. The running development
server is another possible writer, but do not blame it without evidence.

**Why:** A full API run logged an NT repair insertion into the exact fixture whose
purge test then observed an unexpected extra player link. The purge test's earlier
finished-fixture case supplied the same-competition history until file-level
cleanup. The isolated file passed, as did the subsequent authorized full run.

**How to apply:** Correlate fixture-specific repair logs with the failing assertion
before changing checks or repair behavior. Inspect transient fixtures retained
until `afterAll`, not just persistent sports data. A post-run query returning no
finished-fixture history does not disprove interference during the run, because
cleanup may already have removed it. Preserve assertions and respect the user's
limits on diagnostic reruns and out-of-scope fixes.
