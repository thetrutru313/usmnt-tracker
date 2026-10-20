---
name: SQL notice capture
description: One-time SQL maintenance needs a notice-capturing client if per-step NOTICE output is a required deliverable.
---

Do not assume the database execution tool returns PostgreSQL RAISE NOTICE
messages: a successful DO execution can return only the command tag `DO`.

**Why:** A one-time guarded removal succeeded, but its NOTICE lines were not
included in the tool result. Replaying it could not recover the original
messages because the first guard correctly rejected the now-absent player.

**How to apply:** Arrange notice capture before executing one-time maintenance
when the user requires those messages. Never rerun destructive work merely to
reconstruct output, and never label state-derived counts as captured notices.
Report the observed command result and independently verified before/after
state separately if notice capture was unavailable.
