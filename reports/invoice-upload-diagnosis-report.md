# Invoice Upload Failure — Diagnosis Report

**Date:** 2026-08-07  
**Scope:** Read-only diagnosis of the transparency invoice upload failure in production  
**Status:** Root cause confirmed — no code changes made

---

## Executive Summary

Invoice uploads have been broken for every user since **2026-07-24**, when a
Content Security Policy (CSP) was added to `index.html`. The policy's
`connect-src 'self'` directive blocks the browser's direct PUT to Google Cloud
Storage. The server side is fully intact. The one existing production invoice
was uploaded during the ~8-day window before the CSP existed.

---

## Check 1 — CSP blocks the PUT

**File:** `artifacts/usmnt-tracker/index.html`, line 97

```html
connect-src 'self';
```

The comment in that file (lines 60–62) makes the intent explicit:

> *"All API calls go to `/api/*` on the same origin … No external fetch
> targets."*

**The upload flow is a two-step process:**

| Step | Call | Origin | CSP result |
|------|------|---------|------------|
| 1 | `apiFetch("/admin/transparency/upload-url")` — fetches a GCS presigned URL from our own server | Same-origin (`/api/*`) | ✅ Permitted |
| 2 | `fetch(signedGcsUrl, { method: "PUT", body: file })` — PUTs the file to GCS | `https://storage.googleapis.com` | ❌ **Blocked** |

`objectStorage.ts` (line 188) confirms the presigned URL prefix:

```typescript
if (!rawPath.startsWith('https://storage.googleapis.com/'))
```

`https://storage.googleapis.com` is not listed in `connect-src`.
**The browser never sends the file.**

> **Conclusion:** Upload has never worked from any deployed build that carried
> this CSP. The failure is invisible server-side — the server never receives a
> PUT that the browser never sent. The only observable evidence is a CSP
> violation in the browser console.

---

## Check 2 — Timeline: the CSP postdates the existing invoice

| Date (UTC) | Event |
|---|---|
| **2026-07-16 20:41** | Commit `3f4923d` — `POST /admin/transparency/upload-url` endpoint first introduced. `index.html` at that point was a bare 15-line skeleton with no CSP meta tag — just `<div id="root">` and a module script tag. |
| **2026-07-16 → 2026-07-24** | **~8-day open window.** Upload endpoint is live; `index.html` has no CSP. Browser PUT to GCS is unrestricted. The production invoice `d0836c1c` was uploaded during this window. |
| **2026-07-24 15:59** | Commit `b6c613a` — "Implement new API server logic and update tracker frontend interface." `index.html` is replaced wholesale with the current version, introducing the full CSP block including `connect-src 'self'`. Upload silently breaks from this point forward. |
| **2026-08-06 22:19:24** | Production log: `GET /api/transparency/invoice/uploads/d0836c1c-... → 302`. The invoice serves correctly (302 redirect to GCS), confirming it was uploaded before the CSP landed and has never been overwritten. |

> **Conclusion:** The CSP postdates the invoice by 8 days. There is one
> successfully uploaded invoice and it predates the policy that broke all
> subsequent uploads.

---

## Check 3 — Server side is intact

**Route and guard** (`artifacts/api-server/src/routes/transparency.ts`, line 304):

```typescript
router.post(
  "/admin/transparency/upload-url",
  requireAdminSession,
  async (req, res) => { ... }
);
```

- Uses `requireAdminSession` (from `../lib/adminAuth`) — the correct
  session-token guard, not the legacy `requireAdminPassword`.
- Checks `DEFAULT_OBJECT_STORAGE_BUCKET_ID` at startup; returns `503` if
  absent.

**Production secrets:**

| Secret | Status |
|--------|--------|
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | ✅ Present |
| `PRIVATE_OBJECT_DIR` | ✅ Present |

If a valid admin session token is presented and the CSP is not in play (e.g.
server-to-server curl), the route returns a `200` with a presigned GCS URL.
The server side requires no changes.

---

## Check 4 — Production log evidence

From the deployment session beginning **2026-08-06 22:18 UTC**:

```
req#32  POST /api/admin/transparency/upload-url → 401   22:19:37.230
req#39  POST /api/admin/transparency/upload-url → 401   22:20:01.112
```

**Both responses were 401, not 200.** These calls arrived during the admin
auth loop outage (Fix A bug — the session token was never propagated to React
root state, so requests carried the old stale token). `requireAdminSession`
correctly rejected them.

There are **no 200 responses** for `upload-url` anywhere in the production
log. Because auth failed before the server could issue a presigned URL, the
CSP block at the PUT stage never became observable in server-side logs.

---

## Complete Failure Chain

```
1. Admin logs in → POST /admin/verify → 200 ✅

2. Admin picks a file → browser calls POST /admin/transparency/upload-url
   ├── During the auth outage (pre-Fix A):   → 401 ❌  (auth loop bug, now fixed in dev)
   └── After auth fix ships to production:   → 200 ✅  (server side is fine)

3. Browser executes fetch(signedGcsUrl, { method: "PUT", body: file })
   └── connect-src 'self' blocks the request ❌  (primary failure, still present)

4. Upload silently fails; operator sees "Upload to GCS failed" error
```

---

## Fix Required

**Add `https://storage.googleapis.com` to `connect-src` in `index.html`.**

Before (line 97):
```
connect-src 'self';
```

After:
```
connect-src 'self' https://storage.googleapis.com;
```

This is the minimal change. Security considerations:

- The browser will only send `PUT` requests to GCS URLs it receives from our
  own server (which is same-origin, authenticated, and generates short-lived
  presigned URLs). There is no ambient permission to write arbitrary GCS data.
- The presigned URL is scoped to a single object path, a fixed HTTP method
  (`PUT`), and a short expiry window set in `objectStorage.ts`.
- Widening `connect-src` to `https://storage.googleapis.com` does not grant
  `script-src`, `img-src`, or any other fetch directive — it affects `fetch()`
  and `XMLHttpRequest` only.

**This fix awaits operator sign-off per 2026-08-07 session decision.
No code change has been made.**

---

## Files Referenced

| File | Role |
|------|------|
| `artifacts/usmnt-tracker/index.html` | CSP source — `connect-src 'self'` on line 97 |
| `artifacts/usmnt-tracker/src/pages/Admin.tsx` | Upload flow — `handleAddInvoiceFile` (lines 343–365) |
| `artifacts/usmnt-tracker/src/lib/adminSession.ts` | `apiFetch` wrapper used in step 1 |
| `artifacts/api-server/src/routes/transparency.ts` | `POST /admin/transparency/upload-url` route (line 304) |
| `artifacts/api-server/src/lib/objectStorage.ts` | GCS presigned URL generation; prefix confirmed line 188 |
| `artifacts/api-server/src/lib/adminAuth.ts` | `requireAdminSession` middleware |

---

*Report generated 2026-08-07. Read-only diagnosis — no files were modified.*
