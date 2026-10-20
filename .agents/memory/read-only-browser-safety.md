---
name: Read-only production browser safety
description: Loading this app in a browser can create an anonymous identity without user interaction.
---

Treat production browser navigation as potentially mutating, even when the
navigation itself is a GET and no buttons are clicked.

**Why:** A fresh production page load automatically posted to the anonymous
following-identity endpoint and received HTTP 201 during a read-only diagnostic.
Static endpoint and bundle GETs had not exposed that side effect.

**How to apply:** For read-only production work, prefer direct GETs for API,
HTML, and bundle inspection. Do not execute production application JavaScript
unless explicitly authorized or all mutating requests are reliably blocked
before navigation, including service-worker bypass considerations.
