# E2E Upload Round-Trip Test — Analysis & Permanent CI Readiness

> Generated 2026-08-07 after the CSP fix was applied and verified.

---

## What the test proves

`e2e/tests/admin-upload-verify.spec.ts` exercises the full upload flow end-to-end in a real Chromium browser:

1. **Upload-URL generation** — `POST /admin/transparency/upload-url` returns 200 and a signed GCS PUT URL.
2. **CSP-allowed PUT to GCS** — the browser fires a `PUT` directly to `storage.googleapis.com`; the network response is 200 and no `connect-src` violation appears in the console. This is the core assertion the CSP fix needed.
3. **Save** — `POST /admin/transparency` is attempted; 201 on first run, 409 on re-runs (idempotent by design).
4. **Download redirect** — `GET /api/transparency/invoice/uploads/<uuid>` issues an opaque 302 to a fresh signed GCS GET URL; the test accepts status `0` (Fetch API's opaque-redirect sentinel) as proof the redirect was issued correctly.

---

## Obstacles encountered and how each was resolved

| Problem | Root cause | Fix applied |
|---|---|---|
| `loginAdmin` returned immediately on rate-limited page | The login **form** itself shows `h1 "Admin Panel"` as a page heading — visible even without auth. The post-login landmark matched the login form, not the admin panel. | Changed the landmark to `h2 "Monthly Transparency"`, which is only rendered inside `AdminPanel` after authentication. |
| Rate-limiter (5 req / 15 min) exhausted during development | Multiple test runs in a short session consumed all 5 slots on `POST /admin/transparency/verify`. | Added `test.describe.configure({ retries: 0 })` so Playwright never retries and burns a second slot. |
| Save returned 500 instead of 409 on duplicate | The Drizzle/pg error for a unique-constraint violation doesn't always include "unique"/"duplicate" in `err.message`; the route's text-match fell through to 500. | Added a check for PG error code `"23505"` alongside the text-match in `transparency.ts`. |
| Download check returned 404 on re-runs | The test fetched the *new* upload's link, but on re-runs the save returns 409 so the new upload is never persisted; the download route only serves paths stored in a saved month's `invoiceUrls`. | Changed step 5 to fetch `GET /api/transparency` (public endpoint), find the persisted 2035-12 record, and check its stored invoice — guaranteed to exist on every run after the first. |
| Opaque-redirect returns status `0` | Fetch API with `redirect: "manual"` returns an `opaqueredirect` response (status `0`) when the server issues a 3xx. | Added `0` to the accepted set alongside `200` and `302`. |
| Vite proxy forwarded `Origin` header | Playwright's browser at `localhost:<port>` sets `Origin: http://localhost:<port>` on POST requests; Vite forwarded it unmodified; the API server's CORS allowlist rejected it, blocking login. | Added a `configure/proxyReq` hook to `vite.config.ts` that strips the `Origin` header from proxied requests (correct: the proxy is a server-to-server intermediary). |

---

## Files changed as part of the CSP fix + verification

| File | Change |
|---|---|
| `artifacts/usmnt-tracker/index.html` | `connect-src` extended from `'self'` to include the scoped GCS bucket path `https://storage.googleapis.com/replit-objstore-…/`; comment block rewritten to document rationale and removal path. |
| `artifacts/usmnt-tracker/vite.config.ts` | Added `configure/proxyReq` hook to strip the `Origin` header from Vite-proxied requests to the API server. |
| `artifacts/api-server/src/routes/transparency.ts` | Duplicate-detection check in the `POST /admin/transparency` create handler now also checks for PG error code `"23505"` so unique-constraint violations reliably return 409 rather than 500. |
| `e2e/tests/admin-upload-verify.spec.ts` | New test — full upload round-trip verification (see above). |

---

## What would need to change to make this fully robust in CI

The test works today but has three known fragilities before it can run unattended in CI.

### 1. Rate-limit on `POST /admin/transparency/verify`

The prod-grade limiter (5 req / 15 min, shared per IP) means CI can trigger a 429 if the job retries or multiple runs land in the same window. Options:

- **Bypass header** — add a trusted `X-CI-Admin-Bypass` header (verified against a shared secret) that the rate-limiter skips. Gate it behind `NODE_ENV !== "production"` or a separate `CI_ADMIN_BYPASS_SECRET` env var.
- **Test token** — pre-seed a long-lived admin session token in the test database; have `loginAdmin` inject it directly into localStorage instead of going through the verify endpoint. The verify endpoint exists to prevent brute-force, not to gate integration tests.
- **Rate-limit store** — switch from the default in-memory store to Redis, then a `beforeAll` hook can flush the test runner's IP slot count via a direct Redis call.

### 2. GCS credentials in CI

The test drives a real `PUT` to `storage.googleapis.com`. That requires `DEFAULT_OBJECT_STORAGE_BUCKET_ID` and the service-account credentials in the runner's environment. In the Replit dev environment these are present automatically; a standalone CI runner (GitHub Actions etc.) would need the same secrets injected, or the object-storage sidecar calls would need to be mocked at the Vite-proxy or API-server layer.

### 3. Signed-URL expiry + test isolation

The test checks the invoice from the *previously saved* month (2035-12). Signed GCS GET URLs expire (typically 15 min – 7 days depending on IAM binding mode). If the fixture was created much earlier and its signed URL has expired, the download redirect would still work (the API signs a fresh URL each time the download route is called), but the test would fail to find any invoice if the record was somehow deleted.

**Recommended fix — `beforeAll` cleanup and re-seed:**

```ts
test.beforeAll(async ({ request }) => {
  // Delete the test fixture row so the main test body always creates it fresh.
  const verifyRes = await request.post("/api/admin/transparency/verify", {
    data: { password: process.env.ADMIN_PASSWORD },
  });
  const { token } = await verifyRes.json();

  const months = await (await request.get("/api/transparency")).json();
  const existing = months.months.find(
    (m: { periodYear: number; periodMonth: number; id: number }) =>
      m.periodYear === 2035 && m.periodMonth === 12
  );
  if (existing) {
    await request.delete(`/api/admin/transparency/${existing.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
});
```

This makes the test fully self-contained: it always creates the 2035-12 record fresh, captures the save response (201), and the download check uses the invoice from *this run's* upload.

### 4. Shared database / bucket (minor)

The test writes a real row (2035-12) and a real object to the shared development database and bucket. Parallel runs or concurrent developers share the same unique constraint. The `beforeAll` approach above handles this automatically by serialising the create.

---

## Summary

The test as written is a solid single-developer verification tool and correctly proves the CSP fix end-to-end. Promoting it to a permanent CI gate requires three targeted changes:

1. A rate-limit bypass for the verify endpoint (bypass header or pre-seeded token).
2. GCS credentials available in the CI environment (via secrets injection).
3. A `beforeAll` cleanup + re-seed step so the test is fully self-contained and idempotent across concurrent runs.

None of these is a large amount of work, but each requires a deliberate decision about how credentials and test isolation are managed in the pipeline.
