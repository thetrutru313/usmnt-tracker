---
name: Read-only production browser safety
description: Loading this app in a browser can create an anonymous identity without user interaction.
---

Standing rule: a read-only production check means direct GET requests only
(curl or equivalent) to API endpoints and static asset URLs. Never load the
production app in a browser, because the app writes on startup.

**Why:** A fresh production page load automatically posted to the anonymous
following-identity endpoint and received HTTP 201 during a read-only diagnostic.
Static endpoint and bundle GETs had not exposed that side effect.

**How to apply:** Use direct GETs only; do not substitute a browser session,
even with request blocking. A narrower instruction prohibiting all production
access takes precedence and rules out even GETs.

The user confirmed that a first-time visitor creates one anonymous identity
holding only a token hash; the existing cleanup job removes it after 90 days
without follows. The diagnostic incident was accepted with no cleanup and no
inspection of that record.
