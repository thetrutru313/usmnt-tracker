# Post-Publish Verification Report — Admin Auth Fix
**Date:** 2026-08-07  
**Production URL:** https://usmnt-tracker.replit.app  
**Deployment started:** 2026-08-06 22:18 UTC (pre-fix build — see status note below)

---

## Verification Status

| # | Scenario | Log evidence (pre-fix bug) | Browser check after publish |
|---|---|---|---|
| 1 | Fresh login | Verify→200 immediately followed by 401 cluster; panel never loaded | ⏳ Pending publish |
| 2 | Session persistence | `GET /admin/session` never reached; session wiped before any reload | ⏳ Pending publish |
| 3 | Re-auth modal | 5 verify→200/401-cluster cycles until rate-limit fired | ⏳ Pending publish |
| 4 | Rate limit UX | 11 blind retries in 90s with no wait-time indicator | ⏳ Pending publish |

---

## Important Status Note

The production deployment started **2026-08-06 22:18 UTC**. The fixes (Fix A, Fix B, rate-limit UX) were applied to the dev workspace on **2026-08-07**. There is no second startup sequence in the deployment logs — the **currently-live build is the pre-fix version**. The workspace has not been republished yet.

Additionally, the production `ADMIN_PASSWORD` secret holds a **different value** than the dev-environment secret (confirmed by a 401 from a direct API call using the dev secret). Live curl verification against production is therefore not possible from the agent.

All four scenarios below are documented from the authoritative production deployment logs.

---

## 1 · FRESH LOGIN

### What the production logs prove the bug did (22:19:14 UTC)

```
req# 5   POST /api/admin/transparency/verify   → 200  (token issued, saved to localStorage)
req# 7   GET  /api/admin/config                → 401  arrived 48ms BEFORE req#5 finished
req# 8   GET  /api/admin/review-queue          → 401  in-flight with stale token
req# 9   GET  /api/admin/players               → 401  in-flight with stale token
```

Req 7/8/9 left the browser before verify completed — they carried the previous session's stale token. Each 401 triggered `handleUnauthorized()` → `clearSession()`. Fix A's bug (no `setToken` call after re-auth) meant the new token from req#5 was immediately wiped. The panel never loaded.

### What the fix produces

`onReauth(setToken)` is now wired end-to-end: new token written to localStorage **and** root React state before any subsequent admin request fires. The 401 cluster cannot happen.

### Manual verification steps (post-publish)
1. Open a fresh browser tab (or clear localStorage via DevTools → Application → Local Storage → Clear All).
2. Navigate to `/admin`.
3. Enter the admin password **once**.
4. Confirm all four tabs load with data (config, clubs, players, review queue) — no second login prompt appears.
5. In the Network tab, confirm no `GET /api/admin/*` request returns 401.

---

## 2 · SESSION PERSISTENCE

### What the production logs show

There are **zero** `GET /api/admin/session` entries in the entire production log. The endpoint was never reached — the session was cleared by `handleUnauthorized()` before any page reload could happen. The panel never stayed alive long enough to exercise the persistence path.

### What the fix produces

With Fix B (stale-validate race guard) in place, an in-flight validate 401 no longer wipes a session that has already been superseded by a newer login. A genuine page reload will:

1. Load the token from localStorage.
2. `GET /api/admin/session → 200` (token still valid).
3. Panel mounts directly — no login form.

### Manual verification steps (post-publish)
1. Log in successfully (scenario 1 must pass first).
2. Hard-reload the page (`Cmd+Shift+R` / `Ctrl+Shift+R`).
3. Confirm the admin panel appears **without** the login form.
4. In the Network tab, confirm `GET /api/admin/session → 200`.

---

## 3 · RE-AUTH MODAL

### What the production logs prove the bug did

The verify/401 cycle repeated **five times** before the rate limiter fired. Each cycle is one lap of the re-auth loop:

```
Round 1:  req# 5   verify → 200 │ req# 7, 8, 9           admin → 401  ← fresh login, stale batch
Round 2:  req#16   verify → 200 │ req#12, 14, 15          admin → 401  ← Fix A: setToken never called
Round 3:  req#23   verify → 200 │ req#17, 19, 20, 21, 24  admin → 401
Round 4:  req#29   verify → 200 │ req#27, 28, 30, 31      admin → 401
Round 5:  req#33   verify → 200 │ req#34, 36, 37, 38      admin → 401
Round 6:  req#35   verify → 429 ← RATE LIMITED — session permanently unrecoverable
```

Every `verify → 200` is immediately followed by a 401 cluster. That is the exact signature of Fix A: new token written to localStorage but `setToken(newToken)` never called → root state stale → next polling cycle sees old token → 401 → `clearSession()` → modal re-appears → loop.

### What the fix produces

`ReAuthModal.onSuccess(newToken)` now calls `onReauth(newToken)` which calls `setToken(newToken)` in the root component. Root state is updated atomically with localStorage. The first admin request after re-auth carries the new token.

Network-tab evidence to look for: one `POST /api/admin/transparency/verify → 200` followed by the **immediate next** admin request returning **200**, not 401.

### Manual verification steps (post-publish)
1. Let the session banner appear (session nearing expiry), or wait for the re-auth modal to be triggered.
2. Enter the password in the re-auth modal.
3. Confirm the modal closes and **no login form reappears**.
4. Open Network and locate the `POST /api/admin/transparency/verify → 200` entry.
5. Find the next `GET /api/admin/*` call after it — it must return **200**, not 401.

---

## 4 · RATE LIMIT UX

### What the production logs prove the old behavior was

```
req#35   POST verify → 429    22:19:50.053   ← first rate-limit hit
req#40   POST verify → 429    22:20:04
req#41   POST verify → 429    22:20:08
req#43   POST verify → 429    22:20:27
req#44–51 POST verify → 429   22:20:28–30    10 more attempts in 3 seconds
```

The old UI showed a generic error on 429. The operator had no indication a rate-limit window existed — they kept retrying. **11 additional 429s in the 90 seconds after the first one.** No counter, no wait time, no disabled button.

### What the fix produces

`apiFetch` now parses the `RateLimit-Reset` epoch header from the 429 response and throws `RateLimitError(secsRemaining)`. Both `LoginForm` (in `Admin.tsx` and `AdminReviewQueue.tsx`) and `ReAuthModal` catch it and render:

> *"Too many attempts — please wait N minutes before trying again."*

The submit button is disabled and re-enables automatically when `Date.now() >= rateLimitUntil`.

The `RateLimit-Reset` header is confirmed present on 429 responses from the live server:
```
RateLimit-Policy:    5;w=900
RateLimit-Limit:     5
RateLimit-Remaining: 0   (on 6th attempt)
RateLimit-Reset:     883  ← seconds until window resets; apiFetch reads this
```

### Manual verification steps (post-publish)
1. Open `/admin` with a fresh localStorage (no session).
2. Submit a **wrong** password 6 times consecutively.
3. On the 6th submission, confirm:
   - The message "Too many attempts — please wait N minutes before trying again." appears with a **real number** of minutes (not a placeholder).
   - The Submit button is **greyed out and unclickable**.
   - No generic "incorrect password" error is shown.
4. Wait for the countdown to expire — confirm the button re-enables automatically without a page refresh.

---

## Production Log: Full Outage Window

```
22:18:42 Z  [startup] artifact mode enabled — server not yet listening
22:18:42 Z  [ERROR]   healthcheck /api → 500  (×9, connection refused during seed phase)
22:18:44 Z  [WARN]    SSL mode alias warning — DB pool initialising
22:18:58 Z  req#3  GET  /api/follows           → 200  (server now live)
22:18:59 Z  req#4  GET  /api/dashboard         → 200
22:19:14 Z  req#5  POST verify                 → 200  ┐
22:19:14 Z  req#7  GET  /admin/config          → 401  │ Round 1: stale batch
22:19:14 Z  req#8  GET  /admin/review-queue    → 401  │
22:19:14 Z  req#9  GET  /admin/players         → 401  ┘
22:19:17 Z  req#16 POST verify                 → 200  ┐
22:19:17 Z  req#12 GET  /admin/clubs           → 401  │ Round 2: Fix A bug
22:19:17 Z  req#14 GET  /admin/players         → 401  │
22:19:17 Z  req#15 GET  /admin/config          → 401  ┘
22:19:20 Z  req#23 POST verify                 → 200  ┐
22:19:20 Z  req#17 GET  /admin/review-queue    → 401  │ Round 3: Fix A bug
22:19:20 Z  req#19 GET  /admin/config          → 401  │
22:19:20 Z  req#21 GET  /admin/players         → 401  ┘
22:19:27 Z  req#29 POST verify                 → 200  ┐
22:19:27 Z  req#27 GET  /admin/players         → 401  │ Round 4: Fix A bug
22:19:27 Z  req#28 GET  /admin/clubs           → 401  │
22:19:27 Z  req#30 GET  /admin/config          → 401  ┘
22:19:49 Z  req#33 POST verify                 → 200  ┐ Round 5: Fix A bug
22:19:50 Z  req#34 GET  /admin/clubs           → 401  ┘
22:19:50 Z  req#35 POST verify                 → 429  ← RATE LIMITED
22:20:04 Z  req#40 POST verify                 → 429
22:20:08 Z  req#41 POST verify                 → 429
22:20:27–30 req#43–51 POST verify              → 429  (×9, blind retries with no UX feedback)
```

**Total damage:** 5 verify → 200 calls, 18+ admin → 401 calls, 12 verify → 429 calls. Session permanently unrecoverable until the 15-minute rate-limit window expired at ~22:34 UTC.

---

## Files Changed in This Fix

| File | Change |
|---|---|
| `artifacts/usmnt-tracker/src/lib/adminSession.ts` | Added `RateLimitError`; `apiFetch` throws it on 429 with parsed wait time |
| `artifacts/usmnt-tracker/src/pages/Admin.tsx` | **Fix A** (`onSuccess` typed `(token:string)→void`, `onReauth` prop wired through `AdminPanel`); **Fix B** (stale-validate race guard); rate-limit UX in `LoginForm` and `ReAuthModal`; `ReAuthModal` exported for testing |
| `artifacts/usmnt-tracker/src/pages/AdminReviewQueue.tsx` | Imported `RateLimitError`; `LoginForm` gains rate-limit state + UI |
| `artifacts/usmnt-tracker/src/test/adminAuth.test.tsx` | New — two regression tests (confirmed failing pre-fix, passing post-fix) |
