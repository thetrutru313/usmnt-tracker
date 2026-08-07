# Admin Invoice Upload — CSP & CORS Fix Report

**Date:** 2026-08-07  
**Scope:** Unblock the admin transparency invoice upload path end-to-end, fix the
duplicate-month 500, and verify everything in a real Playwright browser.

---

## Problem Summary

Three separate issues were preventing a successful invoice upload from the admin
transparency form:

| # | Issue | Symptom |
|---|-------|---------|
| 1 | `connect-src` CSP blocked PUT to GCS | Browser console: "Refused to connect to 'https://storage.googleapis.com/…'" |
| 2 | API server rejected `http://localhost:*` CORS origins | Upload-url POST returned a CORS error in non-proxied dev flows |
| 3 | `POST /admin/transparency` returned 500 on duplicate month | Drizzle unique-violation error code `23505` was not recognised; wrong HTTP status surfaced to the client |

---

## Changes Made

### 1. CSP Fix — `artifacts/usmnt-tracker/index.html`

Extended `connect-src` to include the exact GCS bucket path used for presigned
PUT uploads:

```
https://storage.googleapis.com/replit-objstore-7761b4b7-4dc3-42da-a4a4-8ade75ae1d75/
```

**Why path-scoped (not the whole GCS origin):**  
Presigned PUT URLs never redirect, so scoping to the bucket path is safe and
avoids opening `connect-src` to all of `storage.googleapis.com`.  
A comment in `index.html` documents the bucket ID and removal path should object
storage ever be replaced.

---

### 2. CORS Fix — `artifacts/api-server/src/app.ts`

`buildAllowedOrigins()` previously had no mechanism to accept `localhost` origins
in non-production environments, which blocked Playwright-direct and curl-style
dev flows where the Vite proxy forwarded the browser's `Origin` header.

**Fix:** A sentinel string `"__localhost__"` is pushed into the allowed-origins
array when `NODE_ENV !== "production"`. The CORS callback checks for this
sentinel and, when found, accepts any `http://localhost(:\d+)?` origin.

```typescript
// In buildAllowedOrigins():
if (!isProduction) {
  origins.push("__localhost__");   // sentinel for the callback below
}

// In the cors() callback:
if (allowedOrigins.includes("__localhost__") &&
    /^http:\/\/localhost(:\d+)?$/.test(origin)) {
  return callback(null, true);
}
```

**Why a sentinel instead of a regex in the array:**  
The sentinel makes the special-case logic explicit and avoids storing a RegExp
object inside an array that is otherwise flat strings. It is visible and
grep-able.

---

### 3. Vite Proxy Cleanup — `artifacts/usmnt-tracker/vite.config.ts`

A prior workaround stripped the `Origin` header from proxied requests before
they reached the API server (so the CORS check never ran). This was reverted
because it prevented the dev environment from ever exercising CORS — any CORS
bug introduced in production would be invisible in dev.

The proxy now uses plain `changeOrigin: true` only:

```typescript
'/api': {
  target: API_BASE,
  changeOrigin: true,
}
```

---

### 4. Duplicate-Month 409 Fix — `artifacts/api-server/src/routes/transparency.ts`

`POST /admin/transparency` was returning 500 instead of 409 when a
year/month combination already existed. Drizzle surfaces the PostgreSQL
unique-violation error with code `23505`, but the original handler only checked
for the substring `"unique"` or `"duplicate"` in the error message — which
Drizzle's error message does not always include.

**Fix:** Check `err.code === "23505"` in addition to the text match:

```typescript
const isDuplicate =
  (err instanceof Error &&
    /unique|duplicate/i.test(err.message)) ||
  (err as { code?: string }).code === "23505";

if (isDuplicate) {
  return res.status(409).json({ error: "Month already exists" });
}
```

---

## New Files

### Unit Test — `artifacts/api-server/src/lib/__tests__/transparencyDuplicateMonthCreate.test.ts`

Mocked unit test that pins the `23505 → 409` fix without requiring a live
database. Uses `vi.hoisted()` to mock the Drizzle insert chain and the
`admin_sessions` lookup. Sets `process.env.ADMIN_PASSWORD` in `beforeAll`
and removes it in `afterAll`.

**Test cases:**
- `23505` PG code → 409
- `unique constraint` in message → 409
- Generic error → 500

### E2E Test — `e2e/tests/admin-upload-verify.spec.ts`

Playwright CSP round-trip test. Exercises the full upload path in a real
Chromium browser:

1. `POST /admin/transparency/upload-url` → 200 (server signs a presigned URL)
2. Browser `PUT` directly to GCS → 200 (the CSP fix is what allows this)
3. No `connect-src` CSP violation in the console
4. `POST /admin/transparency` (save month) → 201 first run / 409 re-run
5. Invoice download link → 200 / 302 / opaque-redirect (0)

**Test isolation:**
- Fixture year/month: **2035-12** — within the form's `max={2035}` constraint
  and definitively unused by real data.
- `afterAll` captures the admin bearer token from the verify response and uses
  it to `DELETE /api/admin/transparency/:id` so the record does not appear on
  the public transparency page after the run.
- The uploaded GCS object is left in the bucket (no admin delete-object API
  exists); it is unreachable without a DB entry because the download route
  validates the path against `transparency_months` before signing.

**Known runtime note:** The object storage sidecar occasionally returns 500
immediately after an API server restart (not yet fully initialised). The test
will fail in that window. Re-running 30–60 seconds after a restart is reliable.

### Env Docs — `.env.example`

Documents all environment variables including `ALLOWED_ORIGINS`, with an
explanation of why `http://localhost:*` is auto-permitted in non-production.

---

## Verification Results

All checks run after the final edits:

| Check | Result |
|-------|--------|
| `pnpm run lint` | ✅ 0 errors (4 pre-existing warnings) |
| `pnpm run typecheck` | ✅ Clean |
| `pnpm run build` | ✅ Clean |
| `pnpm --filter @workspace/api-server run test` | ✅ 87 files, 722 tests |
| `pnpm --filter @workspace/usmnt-tracker run test` | ✅ 12 files, 215 tests |
| `pnpm --filter @workspace/e2e run test` | ✅ 21 tests (incl. new upload spec) |

---

## CI Promotion Requirements

Promoting `admin-upload-verify.spec.ts` to CI requires three pre-conditions:

| Requirement | Detail |
|-------------|--------|
| **GCS credentials** | The CI runner needs access to the same Replit object storage bucket. The presigned-URL sidecar is a Replit-managed process; in a headless CI environment it must be replicated or mocked. Without it, `POST /admin/transparency/upload-url` returns 503. |
| **Admin session seed** | The test calls `POST /admin/transparency/verify` (rate-limited 5/15 min). A pre-seeded session token (inserted directly into `admin_sessions` in CI setup) avoids the rate-limiter and removes the need for a real login. |
| **`beforeAll` DB cleanup** | CI runs against a fresh DB, so the 2035-12 row will never exist before the test. The `afterAll` teardown handles the typical case; a `beforeAll` `DELETE` guard would make the test fully idempotent on re-runs in a shared CI DB. |

The `X-CI-Admin-Bypass` header approach (injecting a fake session without
touching the DB) was explicitly ruled out. Pre-seeding the session token is
the preferred path.

---

## Files Changed

| File | Change |
|------|--------|
| `artifacts/usmnt-tracker/index.html` | Extended `connect-src` with scoped GCS bucket URL |
| `artifacts/usmnt-tracker/vite.config.ts` | Reverted Origin-stripping proxy hook; proxy is now plain `changeOrigin: true` |
| `artifacts/api-server/src/app.ts` | `buildAllowedOrigins()` pushes `"__localhost__"` sentinel in non-production; CORS callback accepts any `http://localhost:*` origin when sentinel is present |
| `artifacts/api-server/src/routes/transparency.ts` | `POST /admin/transparency` create handler checks `err.code === "23505"` before returning 409 |
| `artifacts/api-server/src/lib/__tests__/transparencyDuplicateMonthCreate.test.ts` | New mocked unit test pinning the 23505 → 409 fix |
| `e2e/tests/admin-upload-verify.spec.ts` | New Playwright round-trip test with token capture and `afterAll` teardown |
| `.env.example` | Documents all env vars including `ALLOWED_ORIGINS` |
| `e2e/docs/upload-e2e-analysis.md` | CI promotion analysis |
