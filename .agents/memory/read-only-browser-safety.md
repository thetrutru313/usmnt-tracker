---
name: Read-only production browser safety
description: Loading this app in a browser can create an anonymous identity without user interaction.
---

Standing rule for production application checks over HTTP: use direct GET
requests only (curl or equivalent) to API endpoints and static asset URLs.
Never load the production app in a browser, because the app writes on startup.

**Why:** A fresh production page load automatically posted to the anonymous
following-identity endpoint and received HTTP 201 during a read-only diagnostic.
Static endpoint and bundle GETs had not exposed that side effect.

**How to apply:** For HTTP checks, use direct GETs only; do not substitute a
browser session, even with request blocking. This HTTP restriction does not
replace authorized read-only production database SELECT access. Use the
production read-only database facility when requested; never substitute
mutating SQL, side-effecting functions, DDL, or DO blocks. A narrower
instruction prohibiting all production access takes precedence and rules out
both HTTP GETs and database SELECTs.

**Why the distinction matters:** The user clarified that the browser safety
rule addresses application startup writes, not read-only database evidence.

The user confirmed that a first-time visitor creates one anonymous identity
holding only a token hash; the existing cleanup job removes it after 90 days
without follows. The diagnostic incident was accepted with no cleanup and no
inspection of that record.
