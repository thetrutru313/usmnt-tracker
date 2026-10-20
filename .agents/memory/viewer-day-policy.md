---
name: Viewer calendar-day scope
description: Product-owner scope decisions for viewer-day filtering versus existing schedule and Watch Guide behavior.
---

Viewer-local “today” filtering applies to the dashboard and API callers requesting
today's fixtures. The Watch Guide must not acquire a new Today view or send an
ignored time-zone parameter on its all-fixtures request.

**Why:** The user explicitly clarified that the Watch Guide already groups dates
correctly in the browser; changing that request or UI would add unrelated work.

**How to apply:** Preserve the all-fixtures request and display formatting.
Also preserve the existing UTC event-attachment windows and 30-hour event-expiry
extensions: these are intentional schedule rules, not the viewer's day boundary.
Only the start-only event's “today” comparison follows the viewer's calendar date.
