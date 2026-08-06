# Admin Session Auth Migration Report

**Date:** 2026-08-06  
**Commit:** `38c4c62`  
**Status:** ✅ Shipped — 720/720 tests pass, typecheck clean, codegen drift clean

---

## Summary

Replaced the raw-password-as-Bearer-token pattern with a proper server-side session
system. The `ADMIN_PASSWORD` environment variable is now the login credential only —
it is checked once at `/admin/transparency/verify`, never stored, and never sent
again. On successful login the server returns a one-time UUID token; only its
SHA-256 hash persists in the database. All subsequent admin requests carry the token.

---

## What Changed

### Database

| Item | Detail |
|------|--------|
| New table | `admin_sessions` |
| Columns | `id` (serial PK), `token_hash` (varchar, unique), `created_at`, `expires_at`, `revoked_at` |
| Migration file | `lib/db/drizzle/0001_add_admin_sessions.sql` |
| Applied to dev | ✅ |

The plaintext token never touches the database.

---

### Backend — new files

#### `artifacts/api-server/src/lib/adminAuth.ts`

New `requireAdminSession` middleware used by every admin route:

1. Extracts the Bearer token from `Authorization`.
2. Hashes it with SHA-256.
3. Queries `admin_sessions` for a row that is **not** revoked and **not** expired.
4. Returns **503** (not 500) when the table is missing — protects the window between
   a deploy that adds the table and the next full server restart.
5. Returns **401** when no valid session is found.
6. Calls `next()` on success.

---

### Backend — modified files

#### `transparency.ts` — verify endpoint and logout

- `POST /api/admin/transparency/verify`  
  Unchanged surface: still accepts `Authorization: Bearer <password>`.  
  Changed behaviour: on success, generates a UUID token, stores the hash in
  `admin_sessions`, and returns `{ ok, token, sessionExpiryMs }`.  
  The rate limiter (5 req / 15 min) fires **before** the password check — unchanged.

- `POST /api/admin/logout` *(new)*  
  Extracts the Bearer token, looks up the session row, sets `revoked_at = now()`.
  Returns `{ ok: true }` (idempotent — missing token returns 200 not 401).

#### `admin.ts`

- Removed local `requireAdminToken` function and `timingSafeEqual` import.
- Added `requireAdminSession` to the global `router.use("/admin", …)` chain.
- Added `GET /admin/session` — lightweight probe used by the frontend to validate
  a stored token on page load without re-entering the password.

#### `storage.ts`

- Removed inline password-equality check.
- Uses `requireAdminSession` middleware.

#### `schedule.ts`

- Removed local `requireAdminToken` function (was using `===` plain-text comparison,
  no timing-safe equality — additionally a security bug, now gone).
- All four admin schedule routes use `requireAdminSession`.

#### `anonUserCleanup.ts`

- Added `cleanupExpiredAdminSessions()`: deletes rows where `expires_at < now()`
  or `revoked_at IS NOT NULL`.
- Called inside the existing daily cleanup `run()` sweep.

---

### Frontend — new file

#### `artifacts/usmnt-tracker/src/lib/adminSession.ts`

Extracted shared session helpers that were duplicated across `Admin.tsx` and
`AdminReviewQueue.tsx`:

| Export | Purpose |
|--------|---------|
| `STORAGE_KEY` | localStorage key for the token |
| `STORAGE_TS_KEY` | localStorage key for the save timestamp |
| `STORAGE_EXPIRY_KEY` | localStorage key for the expiry duration |
| `DEFAULT_SESSION_EXPIRY_MS` | fallback expiry (8 h) |
| `getSessionExpiryMs()` | reads the stored expiry or returns the default |
| `saveSession(token, expiryMs)` | writes all three storage keys |
| `loadSession()` | reads and validates the stored session; clears on expiry |
| `clearSession()` | removes all three storage keys |
| `SessionExpiredError` | typed error thrown by `loadSession` on expiry |
| `authHeaders(token)` | returns `{ Authorization: "Bearer <token>" }` |
| `apiFetch(url, token, opts)` | fetch wrapper that injects auth and throws on 401/403 |

---

### Frontend — modified files

#### `Admin.tsx` and `AdminReviewQueue.tsx`

| Before | After |
|--------|-------|
| `LoginForm` submitted password, stored it as the "token" | Submits password, stores the **returned UUID token** |
| `ReAuthModal` same | Same fix |
| Validate-on-mount called `POST /admin/transparency/verify` (would reject a session token) | Calls `GET /admin/session` |
| Logout cleared localStorage only | Calls `POST /admin/logout` first, then clears localStorage |
| Session helpers duplicated in each page | Imported from `../lib/adminSession` |

---

## Tests

### New test files

| File | Tier | Covers |
|------|------|--------|
| `adminSessionAuth.test.ts` | App (real DB) | Token returned on verify; wrong password → 401; valid token → 200 on admin route; raw password rejected; expired token → 401; revoked token → 401; logout → subsequent 401 |
| `adminSessionMissingTable.test.ts` | Mock | Missing `admin_sessions` table → 503 (not 500) |

### Updated test files

| File | Change |
|------|--------|
| `transparencyInvoiceLabelEdit.test.ts` | `beforeAll` calls verify to get a session token; `afterAll` calls logout to clean up the row |
| `transparencyInvoiceDeletion.test.ts` | Same |
| `transparencyInvoiceValidation.test.ts` | Same |
| `reOverrideAuditTrail.test.ts` | Added `adminSessionsTable` and `gt` to the `@workspace/db` / `drizzle-orm` mocks |
| `bulkApproveSlugCollision.test.ts` | Same mock additions; `select` chain made both thenable (route handler) and `limit()`-capable (session middleware) in `beforeEach` |

### Unchanged tests that still pass

- `transparencyVerifyRateLimit.test.ts` — the rate limiter still fires before the
  password check; the endpoint surface is unchanged.

### Result

```
Test Files  86 passed (86)
     Tests  720 passed (720)   (+8 vs. before this feature)
  Duration  ~47s
```

---

## Security properties

| Property | Status |
|----------|--------|
| Password never stored | ✅ |
| Password never sent after login | ✅ |
| Token stored as SHA-256 hash only | ✅ |
| Timing-safe password comparison | ✅ (`timingSafeEqual` in verify) |
| Session expiry enforced server-side | ✅ |
| Session revocation enforced server-side | ✅ |
| Rate limit on verify endpoint | ✅ (5 req / 15 min, unchanged) |
| Deploy-ordering 503 guard | ✅ |

---

## Operational notes

### First deploy

All existing admin sessions will be invalidated on the first deploy. Any token
created before this deploy was the raw `ADMIN_PASSWORD` string (not a UUID) and
will be rejected by the new middleware. Anyone using the admin panel will be
prompted to log in once. **This is expected and correct.**

### Rollback

Reverting the commit and republishing restores the old auth path. The
`admin_sessions` table's presence is harmless to the old code — it simply goes
unused.

### Session cleanup

Expired and revoked rows are automatically deleted by `cleanupExpiredAdminSessions()`
inside the existing daily `anonUserCleanup` sweep. No manual maintenance required.

---

## CI recommendation

The migration file (`0001_add_admin_sessions.sql`) is validated at deploy time only
if CI runs `drizzle-kit migrate`. If CI currently runs `drizzle-kit push`
(schema-sync), the migration file is never exercised in CI — only the resulting
schema state is. Switching CI to `drizzle-kit migrate` would catch migration syntax
errors and out-of-order conflicts before they reach production.
