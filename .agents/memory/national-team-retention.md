---
name: National-team fixture retention
description: Curated national-team fixtures deliberately lack player links; general club-orphan purges must not delete them.
---

Curated national-team sentinels deliberately receive no `fixture_players` links. General club-orphan cleanup must protect national-team rows, except unbound negative-ID senior sentinels more than seven days past kickoff.

**Why:** The product owner confirmed that missing player links are intentional for national-team fixtures, not evidence that a fixture has no value. Immediate orphan cleanup can delete an announced match before its API ID binds, but a permanent exemption leaves never-published matches scheduled indefinitely. Seven days is the owner's explicit compromise for late API publication.

**How to apply:** Keep the grace period limited to negative-ID senior NT rows; bound positive-ID NT rows stay protected and club orphans get no grace. Keep scheduled/live and no-player-link safety predicates intact. Retire played matches from startup seed lists so boot cannot recreate purged historical sentinels.
