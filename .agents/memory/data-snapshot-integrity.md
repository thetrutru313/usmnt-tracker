---
name: Data snapshot integrity
description: Prevent partial tool output from becoming incomplete sports-data reports.
---

Reject truncated structured-data output even when it still parses as JSON.
Check expected fixture/group coverage as well as parse success.

**Why:** A capped programmatic shell result omitted middle fixture records while
leaving parseable output. Parsing alone did not establish that all requested
fixtures were represented.

**How to apply:** Reduce large API responses to the required columns and teams
inside the shell before returning them. Require `truncated: false` and validate
the expected fixture/group IDs before constructing report totals.
