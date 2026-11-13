---
name: Drizzle preview safety
description: Filtered schema pushes can propose unrelated destructive statements despite a table-only intent.
---

Treat table-filtered Drizzle pushes as unsafe until their entire SQL plan has
been inspected. Filtering tables does not reliably isolate all schema objects:
previews here proposed dropping unrelated enums and sequences, including when
the schema input described only the new table. None of those drops were applied.

**Why:** Drizzle's introspection filtering and exported schema can describe
different sets of objects. A filtered push is not a guarantee that only the
named table will change.

**How to apply:** Preview without approval or an interactive terminal before
applying anything. If the plan contains out-of-scope changes, stop and get
approval for a narrower approach rather than forcing the push. An unchanged
`news_aliases` default can still appear as a redundant `SET DEFAULT` in a normal
preview; inspect the current catalog rather than assuming the diff proves a
semantic change.
