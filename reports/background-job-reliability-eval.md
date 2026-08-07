# Background Job Reliability — Read-Only Evaluation

**Date:** 2026-08-07  
**Constraint:** No code, no config, no deployment changes.  
**Goal:** Establish whether a web/worker process split is necessary or even
possible on this platform before building it.

---

## Platform note

`searchReplitDocs`, `webSearch`, and `webFetch` all returned no results in
this session. Questions 1, 2a, and 3 are answered from platform knowledge,
not verified current documentation. Where uncertain, that is flagged
explicitly.

---

## Q1 — Can this Repl run more than one deployment?

**No.**

`.replit` has a single `deploymentTarget = "autoscale"` key. Replit's
deployment model maps one Repl to one deployment target. There is no mechanism
to mark one service as Reserved VM and another as Autoscale within the same
Repl. **The worker-split plan as a multi-process deployment cannot be deployed
here.**

What the workspace actually contains: two artifacts — the api-server (a
runnable Node process) and the usmnt-tracker (static file serving, no server
process in production). Static serving doesn't count as a second deployment
target; it is handled by the platform's own proxy in front of the single
runnable artifact. A persistent worker process would be a second runnable
service, which requires a different Repl or a different host.

This is not verified from current docs. The Deployments section of the Replit
pricing/docs page is the authoritative source.

---

## Q2 — What would switching to a Reserved VM do?

### a. Availability and cost

Reserved VM is available on Core and higher plans. Pricing is a flat monthly
fee per instance (~$10–20/month depending on machine spec), billed whether the
instance handles traffic or not. Autoscale charges per compute-second of actual
request handling plus a small per-request fee. For a low-traffic app, autoscale
is almost certainly cheaper in raw compute cost — but the cost of autoscale
sleeping is the missed sync cycles.

**Exact current pricing must be confirmed from the Replit pricing page before
deciding.**

### b. Does switching require any code change?

No application code changes. The only change is in `.replit`:

```toml
# Current
[deployment]
deploymentTarget = "autoscale"

# After
[deployment]
deploymentTarget = "reserved_vm"   # ← confirm exact string from Replit UI
```

The `artifact.toml` files do not specify a deployment target — that is
entirely in `.replit`. The production run command is already declared:

```toml
# artifacts/api-server/.replit-artifact/artifact.toml
[services.production.run]
args = ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
```

That command, the build step before it, and every `setInterval` timer in
`index.ts` are all unchanged. They already work correctly for a persistent
process — autoscale sleep is the only reason they don't work now.

**One uncertainty:** the exact string Replit expects for `deploymentTarget` on
a Reserved VM is not confirmed. "reserved_vm" is the most likely value but
must be verified before editing.

### c. Does it change how Publish works or how schema reaches production?

No. `lib/db/README.md` is explicit:

> Production schema changes are delivered via **Replit's Publish flow**, which
> diffs the dev and production databases and applies changes when you publish.

That mechanism is platform-level, not tied to `deploymentTarget`. It operates
the same way for Reserved VM and Autoscale. The note about `drizzle-kit
migrate` never being pointed at production remains in force regardless of
deployment type.

### d. Downsides

| | Autoscale (current) | Reserved VM |
|---|---|---|
| Billing | Per compute-second, near-zero at low traffic | Fixed monthly, billed 24/7 |
| Instances | 0–N, sleeps when idle | 1, always running |
| Background jobs | Missed cycles when sleeping | Fire on real schedule, every cycle |
| Rate-limit throttle | Wrong: concurrent instances each claim full budget | Correct: one process, one budget |
| Startup cost (healthcheck failures) | On every wakeup — frequent | On every deploy — infrequent |
| Sentinel promotion (Block D) | On wakeup (traffic-driven) | On deploy only — same caveat |
| Deploy restart | Instances drain gracefully | Single instance restarts; brief window |
| Traffic spikes | Scales to N instances | Single instance, no auto-scale |

**Sentinel promotion note:** Block D running only at startup is a pre-existing
limitation, noted in the code's own comment: _"This logic belongs in
`startUsmntStatsSyncSchedule()` — moving it is a separate change."_ Reserved
VM is no worse than autoscale here: on autoscale, wakeups from traffic happen
to trigger promotion, but that is accidental and unreliable. The underlying
issue is the same in both cases; it needs its own fix regardless of deployment
type.

---

## Q3 — Replit Scheduled Deployments

Scheduled deployments exist on Replit: a cron expression triggers a full
process start, the process runs, then stops. They are for one-shot batch jobs,
not for persistent listeners.

**What they would solve:** daily syncs (club stats, national team caps, anon
cleanup, commitment sweep, weekly rescore). These are already structured as
one-shot `run()` functions inside each `start*Schedule()` wrapper. They could
be called directly from a job entry point that imports the function, calls it,
and exits.

**What they cannot solve:** the live fixture poll. `startApiFootballSyncSchedule()`
also starts a live poll every 5 minutes during matches. A scheduled deployment
cannot maintain a running loop between cron triggers. During an active USMNT
match, a persistent process polling every 5 minutes is the only way the match
feels live.

**What they would require:**

- A new entry point (e.g. `scripts/runJob.ts`) that accepts a job name as an
  argument, calls the relevant function, and exits cleanly.
- The "POST to an authenticated endpoint" approach (job runner POSTs to
  `/admin/run-sync?job=hourly`) requires the autoscale instance to be awake —
  defeating the purpose.
- Each cold start also re-runs `runCriticalStartupSeeds()` before opening
  the port. A pure job runner that never opens an HTTP port would need those
  seeds extracted or skipped.
- The in-memory `syncGuard` / `claimSyncRun` already uses the database as its
  lock, so cold-starting is safe — overlapping triggers would be no-op'd.

**Verdict:** scheduled deployments partially solve daily jobs but not live
match monitoring. They do not replace a persistent worker.

---

## Q4 — Worker.ts inventory

Full `index.ts` read (435 lines). Block labels from the brief.

### What worker.ts must own

| Item | Lines in index.ts | Interval |
|---|---|---|
| `startRssIngestionSchedule()` | 376 | 15 min |
| `startApiFootballSyncSchedule()` | 381 | 60 min + live poll every 5 min |
| `startPlayerClubSyncSchedule()` | 386 | 24 h |
| `startPlayerStatsSyncSchedule(afterSync)` | 400–405 | 24 h; afterSync chains `syncUsmntStats → runCommitmentSweep` |
| `startUsmntStatsSyncSchedule()` | 409 | 60 min |
| `startNationalTeamSyncSchedule()` | 415 | 24 h |
| `startAnonUserCleanupSchedule()` | 420 | 24 h + immediate on boot |
| `setInterval(rescoreAllCandidates, 7 days)` | 427–433 | Weekly, gated on `API_FOOTBALL_KEY` |
| `checkAndApplyWeightDrift()` | 219–221 | One-shot at startup, not an interval |
| **Block D** — NT fixture ID backfill | 223–303 | One-shot at startup |
| **Block J** — US U20/U17 youth fixture seed | 305–371 | One-shot at startup, `ON CONFLICT DO NOTHING` |

**Block D detail:** `KEEP: Active duty`. The **only** mechanism promoting
sentinel fixture IDs (negative values, e.g. −2001) to real
`api_football_fixture_id` values once API-Football match logs arrive after a
game is played. Deleting or not running this block leaves all sentinel rows
stuck at their negative IDs. In a split architecture, Block D must live in
the worker so it runs on the persistent process rather than only when traffic
wakes the web server.

**Block J detail:** Uses `ON CONFLICT (api_football_fixture_id) DO NOTHING` —
idempotent, safe to run on every startup. Per the code comment, the eventual
home is a standalone `scripts/src/seedYouthNtFixtures.ts` bootstrap script;
until that exists, Block J belongs in worker startup rather than in the web
server.

### What stays in the web server (index.ts)

| Item | Reason |
|---|---|
| `runCriticalStartupSeeds()` — Block A | Must complete before `app.listen()`. Seeds Sept/Oct 2026 friendlies and retires stale sentinels. The comment is explicit: running it after `app.listen()` would allow `/api/schedule` and `/api/dashboard` to return stale data during first seconds of startup. Cannot be deferred to an asynchronously starting worker. |

### Things that would break or need attention if moved

**PORT env var:** `index.ts` lines 15–27 throw immediately if `PORT` is not
set. A worker process doesn't need to bind a port and has no HTTP routes.
`artifact.toml` defines the health check at `/api/healthz:8080` for the web
server. A worker service would either need its own health port + endpoint, or
the health check config must be absent from its service definition. This is
the only configuration-level change required beyond `deploymentTarget`.

**The `afterSync` chain:** Defined inline in index.ts as a closure passed to
`startPlayerStatsSyncSchedule`. The chain — `syncUsmntStats()` then
`runCommitmentSweep()` — must be replicated verbatim in worker.ts. The
libraries don't change; only the glue code moves.

**In-memory rate-limit throttle (`apiFootballSync.ts:30`):** Module-level
`nextSlotAt` variable. In a split architecture, the worker is the sole
importer of `apiFootballSync`. The web server stops importing it. The throttle
becomes accurate by default: single consumer, single in-memory slot. This is
**strictly better** than the current situation.

**`syncGuard` / `claimSyncRun`:** Already uses the database as the lock
(`sync_metadata` table). Safe to move. No change needed.

### The six lazy `require()` calls

| File | Line | Target | Why lazy |
|---|---|---|---|
| `apiFootballSync.ts` | 1517 | `./playerStatsSync` | Breaks circular import: apiFootballSync ↔ playerStatsSync |
| `apiFootballSync.ts` | 2199 | `./playerStatsSync` | Same |
| `playerClubSync.ts` | 929 | `./syncGuard` | Lazy require pattern (circular or load-order) |
| `playerStatsSync.ts` | 1042 | `./syncGuard` | Same |
| `nationalTeamSync.ts` | 300 | `./syncGuard` | Same |
| `usmntSync.ts` | 368 | `./syncGuard` | Same |

**Effect of splitting entry points: unchanged.** All six lazy requires live
inside `lib/` modules. They are not in `index.ts`. Whether the entry point is
`index.ts` or `worker.ts`, those modules are imported the same way — the
lazy-require pattern is between library modules, not between the entry point
and the libraries.

---

## Recommendation

**Switch to Reserved VM. Change no application code.**

The only file to edit is `.replit`: change `deploymentTarget` from
`"autoscale"` to the Reserved VM string (verify the exact key from the Replit
deployment UI before touching the file).

This eliminates every described symptom:

- Daily and hourly syncs fire on their real schedules. The
  timestamp-clustering burst-at-startup pattern goes away because restarts
  happen at deploy time, not at traffic wakeup.
- The in-memory rate-limit throttle is correct: one long-lived process, one
  budget.
- Startup healthcheck failures (9 over ~2 seconds) stop mattering: they happen
  once per deploy, not per wakeup.
- Sentinel promotion (Block D) dependency on restart frequency stops being a
  live concern: restarts are deliberate, not traffic-driven.

**The worker-process split cannot be deployed here** (one `deploymentTarget`
per Repl). Even if the platform later supports it, the required changes are
non-trivial: new entry point, health endpoint for the worker, PORT guard
removal, Block D relocation, afterSync chain replication. Reserved VM achieves
the reliability goal at the cost of a fixed monthly fee and a one-line config
edit.

The code split remains the right long-term architecture if the app moves to a
platform that supports multi-process deployment (Railway, Fly, Render). The
inventory in Q4 is what that migration would require.
