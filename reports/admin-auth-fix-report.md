# Admin Auth Fix — Implementation Report
**Date:** 2026-08-06  
**Scope:** USMNT Tracker · `artifacts/usmnt-tracker` + `artifacts/api-server`

---

## 1 · Background

Admin authentication was previously migrated from a raw `ADMIN_PASSWORD` Bearer-token scheme to a server-side session system:

- `POST /admin/transparency/verify` validates the password and returns a UUID token.
- All subsequent admin requests carry that UUID.
- Schema: `admin_sessions` table with `token_hash`, `expires_at`, `revoked_at`.

A production outage revealed that the new session system had two code bugs and a missing UX affordance for rate-limit errors.

---

## 2 · Root Causes Identified

### Fix A — Re-auth token never propagated to root state

**Component:** `ReAuthModal` in `artifacts/usmnt-tracker/src/pages/Admin.tsx`

`onSuccess` was typed `() => void` and called with no argument after a successful re-authentication. As a result:

1. `saveSession(newToken)` wrote the new token to `localStorage`.
2. `setToken` in the root `Admin` component was **never called** → root state stayed stale.
3. All subsequent API requests used the old token → 401 responses.
4. `handleUnauthorized()` fired → `clearSession()` wiped the just-saved token.
5. The login form reappeared → loop.

**Fix applied:**

| Location | Change |
|---|---|
| `ReAuthModal` signature | `onSuccess: (token: string) => void` |
| `handleSubmit` call site | `onSuccess(res.token)` (passes the new token) |
| `AdminPanel` function signature | Added `onReauth: (token: string) => void` prop |
| `ReAuthModal` usage inside `AdminPanel` | `onSuccess={(newToken) => { ...; onReauth(newToken); }}` |
| `Admin` root render | `<AdminPanel … onReauth={setToken} />` |

---

### Fix B — Stale validate 401 wipes a freshly issued token (race condition)

**Component:** `AdminPanel.validate` effect in `Admin.tsx`

The `validate` effect (periodic session ping) and a concurrent `LoginForm.handleSubmit` (verify) can race:

1. `validate` sends `GET /admin/session` with the old token (in-flight).
2. Operator submits the login form → `verify` returns 200 → `saveSession(newToken)` writes the new token to `localStorage`.
3. The in-flight validate 401 resolves **after** step 2.
4. `handleUnauthorized()` fires unconditionally → `clearSession()` wipes the new token → login form reappears.

**Fix applied:**

```ts
// Inside validate's catch block, before calling handleUnauthorized():
const stored = loadSession();
if (!stored || stored === token) {
  // The token in localStorage is still the one we validated with (or gone
  // entirely). Safe to clear — no newer session has been established.
  handleUnauthorized();
}
// Otherwise: a newer login already replaced the token. Ignore this stale 401.
```

---

## 3 · Addition — Rate-Limit UX (Addition 2)

When `POST /admin/transparency/verify` returns **429 Too Many Requests**, operators previously saw a generic "Incorrect password" error and could keep retrying, burning their remaining window.

**Changes:**

- **`adminSession.ts`** — Added `RateLimitError` class with `secsRemaining: number | null`. `apiFetch` now detects 429, reads `RateLimit-Reset` (epoch) or `Retry-After` (seconds) header using an epoch-vs-seconds heuristic (`> 1_000_000_000` = epoch timestamp), and throws `RateLimitError`.
- **`Admin.tsx` `LoginForm`** — Catches `RateLimitError`, records `rateLimitUntil` timestamp, shows "Too many attempts — please wait N minutes before trying again.", disables the submit button. An effect auto-clears the block when the window expires.
- **`Admin.tsx` `ReAuthModal`** — Same rate-limit state + catch + UI.
- **`AdminReviewQueue.tsx` `LoginForm`** — Same rate-limit state + catch + UI.

Rate limits on the server were **not changed**.

---

## 4 · Regression Tests Added

**File:** `artifacts/usmnt-tracker/src/test/adminAuth.test.tsx`

### Test 1 — Fix A: token propagation

Renders `ReAuthModal` directly, mocks `fetch` to return `{ ok: true, token: "new-session-token" }`, submits the form, and asserts `onSuccess` was called with `"new-session-token"`.

| State | Result |
|---|---|
| Before fix | `onSuccess` called with no argument — **FAIL** |
| After fix | `onSuccess("new-session-token")` — **PASS** |

### Test 2 — Fix B: stale validate 401 must not evict a fresh token

Renders the `Admin` root with `"old-token"` in `localStorage`, holds the validate fetch in-flight with a deferred promise, calls `saveSession("new-token")` to simulate a concurrent login, then resolves the deferred with a 401. Asserts the password input is **not** in the DOM and `loadSession()` still returns `"new-token"`.

| State | Result |
|---|---|
| Before fix | Login form appeared, new token wiped — **FAIL** |
| After fix | Session intact, form hidden — **PASS** |

---

## 5 · Verification Results

### usmnt-tracker test suite

```
Test Files  12 passed (12)
     Tests  215 passed (215)   Duration 6.48 s
```

(213 pre-existing + 2 new regression tests)

### api-server test suite

```
Test Files  86 passed (86)
     Tests  720 passed (720)   Duration 44.29 s
```

### lint / typecheck / build

```
lint      ✅  0 errors (4 pre-existing warnings, unchanged)
typecheck ✅  api-server, usmnt-tracker, mockup-sandbox, scripts all pass
build     ✅  usmnt-tracker dist built; SW + Workbox assets generated
```

---

## 6 · Healthcheck 500 Investigation (report only — no code changed)

### What the logs showed

```
[22:18:42.645Z ERROR] healthcheck failed error=healthcheck /api returned status 500
[... 8 more identical entries through 22:18:44 ...]
[22:18:44.263Z ERROR] SECURITY WARNING: The SSL modes … treated as aliases for 'verify-full'.
```

Nine consecutive failures over ≈ 2 seconds, then silence. No failures once the server warmed up.

### Root cause: server not yet listening

`index.ts` calls `runCriticalStartupSeeds()` — a block of Drizzle DB operations — before calling `app.listen()`. During this window the TCP port is not open. Any probe that hits the service receives `ECONNREFUSED`; Replit's proxy logs this as "returned status 500".

The DB pool initialisation is confirmed by the SSL warning appearing at the tail of the failure burst (22:18:44). After that, `app.listen()` fires and connections are accepted normally.

### Why the log says `/api`, not `/api/healthz`

`artifact.toml` configures `[services.production.health.startup] path = "/api/healthz"`. That startup probe also fails during the pre-listen window. However, the log entry shows `/api` — the service's registered `paths = ["/api"]` mount — suggesting Replit runs at least two independent checks:

| Check | Path | Configured by |
|---|---|---|
| Startup probe | `/api/healthz` | `artifact.toml` `[services.production.health.startup]` |
| Platform readiness probe | `/api` | Replit; targets the service's `paths` registration |

`routes/health.ts` is **not at fault**. It handles `GET /healthz` → full path `GET /api/healthz` and makes no database calls. If the probe hit that path after `listen()`, it would always return 200.

### Restart risk

The 2-second burst fell within Replit's startup-probe grace period — the deployment succeeded. Risk grows if `runCriticalStartupSeeds()` slows down (larger dataset, cold DB connection). If the pre-listen window ever exceeds the grace period, Replit would restart the deployment in a loop.

**Potential mitigation (not applied):** move `app.listen()` before `runCriticalStartupSeeds()` and run seeds as post-listen background work. This creates a short window where the server responds to requests with potentially stale seed data — a separate trade-off to evaluate.

---

## 7 · Files Changed

| File | Change |
|---|---|
| `artifacts/usmnt-tracker/src/lib/adminSession.ts` | Added `RateLimitError`; `apiFetch` throws it on 429 with parsed wait time |
| `artifacts/usmnt-tracker/src/pages/Admin.tsx` | Fix A + Fix B + rate-limit UI in `LoginForm` and `ReAuthModal`; `ReAuthModal` exported for testing; `AdminPanel` gains `onReauth` prop |
| `artifacts/usmnt-tracker/src/pages/AdminReviewQueue.tsx` | Imported `RateLimitError`; `LoginForm` gains rate-limit state + UI |
| `artifacts/usmnt-tracker/src/test/adminAuth.test.tsx` | New file — two regression tests |
