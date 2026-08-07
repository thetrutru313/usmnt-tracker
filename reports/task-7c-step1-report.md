# Task 7C — Reserved VM Switch: Step 1 Pre-Flight Report

**Date:** August 7, 2026  
**Scope:** Pre-approval research only. No `deploymentTarget` changes made.

---

## a. The Exact `deploymentTarget` Value

**Correct value: `"vm"`** — not `"reserved_vm"` (7A's guess was wrong).

The deployment skill documents the full accepted vocabulary: `"autoscale"`, `"vm"`, `"static"`, `"scheduled"`. The Replit docs confirm: the type is set via the Publishing tool under **Adjust settings → Deployment type dropdown**. Letting the UI write it is the safest path — it writes to `.replit` automatically using the validated string.

**Current state of `.replit`:**
```toml
[deployment]
deploymentTarget = "autoscale"
```

Neither artifact's `artifact.toml` has a `deploymentTarget` field, so this `.replit` value is what the platform reads. Changing it to `"vm"` is the one-line diff, and the one-line rollback.

---

## b. The Actual Cost Delta

### Reserved VM — smallest adequate machine (Aug 2026 pricing, in effect now)

| Configuration | Per hour | Per month (730 h) |
|---|---|---|
| **0.5 vCPU / 2 GiB RAM** | $0.0208 | **~$15.18 flat** |
| Dedicated 1 vCPU / 4 GiB RAM | $0.0486 | ~$35.48 flat |
| Dedicated 2 vCPU / 8 GiB RAM | $0.0694 | ~$50.66 flat |

The smallest shared VM (0.5 vCPU / 2 GiB) is **$15.18/month regardless of traffic**.

### Autoscale — actual billing

**Not available from here.** Autoscale billing (compute units + requests) is usage-based and only visible in your Usage dashboard. The rate structure (post-Aug 2026) is:

- Base fee: $1.00/month
- Compute units: $0.60 per million
- Requests: $0.40 per million

The actual dollar total for this app's traffic requires reading your live Usage dashboard. **Please check the trailing 30-day figure there before approving.**

### Decision threshold

| Scenario | Recommendation |
|---|---|
| Autoscale trailing-30-day spend < ~$12/month | Autoscale is cheaper; Reserved VM costs more for the always-on guarantee |
| Autoscale trailing-30-day spend ≥ ~$15/month | Reserved VM saves money and buys the guarantee |
| Autoscale spend between $12–$15 | Roughly break-even; the always-on guarantee alone may justify the switch |

---

## c. What Else Changes With the Switch

### Production URL
**No change.** `getDeploymentInfo()` confirms the live URL is `https://usmnt-tracker.replit.app`. Switching deployment type within the same repl preserves the same `.replit.app` subdomain.

### Downtime During the Switch
**Brief, not zero.** The docs state new machine settings take effect on the next deployment. Expect a window of roughly **seconds to ~1 minute** while the new VM container is provisioned and the health check passes. Plan accordingly if there are active users.

### Secrets
**Carry over automatically.** Replit secrets are stored at the workspace level, not per-deployment type. All seven secrets (`ADMIN_PASSWORD`, `API_FOOTBALL_KEY`, `SESSION_SECRET`, `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`, `SPORTMONKS_API_TOKEN`) will be present on the new deployment with no re-entry required.

### Object Storage Sidecar (`127.0.0.1:1106`) — **UNCONFIRMED, SEE BELOW**

This is the most important question per the task instructions. The honest answer:

**The Replit docs do not explicitly confirm OR deny sidecar availability on Reserved VM.**

Evidence reviewed:

| Source | Says |
|---|---|
| App Storage docs | Authentication is "automatically" handled by Replit client libraries; sidecar is "auto-configured" |
| Reserved VM docs | Lists machine power, run commands, port mappings as configuration — no Object Storage restriction mentioned |
| Aug 2026 pricing | App Storage billed identically regardless of deployment type |
| Deployment types comparison | No limitation on Object Storage for Reserved VM listed |

The absence of a stated limitation is meaningful, but is not a confirmed "yes." The architecture is:

```
lib/objectStorage.ts
  → @google-cloud/storage (auth via sidecar)
  → http://127.0.0.1:1106/token         (credential fetch)
  → http://127.0.0.1:1106/object-storage/signed-object-url  (presigned URL generation)
```

Every invoice upload and download routes through the sidecar. A sidecar failure post-switch would return `500` on `GET /api/transparency/invoice/uploads/<uuid>` (the step-3b check), and rollback is clean.

**Recommended approach:** Proceed with the switch, but treat step-3b as a hard gate. Execute it within the first minute post-deploy. Roll back immediately if it returns 500.

---

## Summary Table

| Question | Answer |
|---|---|
| Correct `deploymentTarget` value | `"vm"` (not `"reserved_vm"`) |
| Current value in `.replit` | `"autoscale"` |
| Reserved VM monthly cost (smallest) | ~$15.18/month (0.5 vCPU / 2 GiB, flat) |
| Autoscale actual spend | **Check Usage dashboard — not accessible here** |
| Production URL after switch | Unchanged: `https://usmnt-tracker.replit.app` |
| Downtime | Seconds to ~1 minute during re-deploy |
| Secrets carry over | Yes, automatically |
| Object storage sidecar on Reserved VM | Not explicitly documented either way — verified by step-3b post-deploy |

---

## Pending Before Proceeding to Step 2

1. **Your approval** on cost — requires checking the Usage dashboard for trailing-30-day autoscale spend.
2. No application code changes are involved in this task. The only file that changes is `.replit` (`"autoscale"` → `"vm"`), written by the Publishing UI.

**Rollback:** Change `deploymentTarget` back to `"autoscale"` in `.replit` and redeploy. No data, schema, or application code is involved. Rollback is clean.
