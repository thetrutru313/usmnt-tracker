---
name: USMNT candidate rescore scheduling
description: rescoreAllCandidates() does not run at server startup — restarting the API server does not drain the eligibility-rescore backlog.
---

`rescoreAllCandidates()` in `playerDiscovery.ts` is only invoked from a `setInterval(..., SEVEN_DAYS_MS)` registered in `index.ts`'s startup block — there is no immediate call on boot. Restarting the `artifacts/api-server` workflow therefore does **not** trigger a rescore pass or drain the pending-candidate backlog, even though several other syncs in that same startup block do run immediately (e.g. anon-user cleanup).

**Why this matters:** it's easy to assume "restart the server" reruns all startup-registered jobs, but recurring rescore/discovery jobs may be interval-only. Confirming this needed reading `index.ts` directly — the `setInterval` call site has no companion immediate invocation.

**How to apply:** to actually drain a rescore backlog on demand, use `POST /admin/trigger-eligibility-rescore` (requires an authenticated admin session — the agent should not attempt to log in with `ADMIN_PASSWORD`; ask the user to trigger it, or wait for the 7-day schedule). Don't assume a workflow restart re-runs interval-scheduled jobs — check for an immediate startup call before promising that.
