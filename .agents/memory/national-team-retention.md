---
name: National-team fixture retention
description: Curated national-team fixtures deliberately lack player links; general club-orphan purges must not delete them.
---

Curated national-team sentinels deliberately receive no `fixture_players` links. General club-orphan cleanup must exclude national-team rows, including past scheduled/live rows; dedicated national-team cleanup owns their retention.

**Why:** The product owner confirmed that missing player links are intentional for national-team fixtures, not evidence that a fixture has no value. A past-orphan predicate without the national-team exclusion can delete an announced match before its API ID binds.

**How to apply:** Preserve the national-team exclusion whenever general orphan cleanup changes. Test both negative-ID and positive-ID past national-team fixtures, alongside a club-fixture control.
