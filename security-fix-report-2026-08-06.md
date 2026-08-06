# Security Fix Report — 2026-08-06

## Summary

Two focused security fixes applied to `artifacts/api-server/src/routes/transparency.ts`.
Typecheck and full test suite pass after both changes.

---

## Fix 1 — Brute-force protection on the admin login endpoint

### Problem

`POST /admin/transparency/verify` had no dedicated rate limiter. Only the global
300-requests-per-minute limiter from `app.ts` applied, allowing roughly 18,000
password guesses per hour from a single IP.

### Change

Added `adminVerifyLimiter` (5 requests per 15 minutes per IP) applied to the
verify route before `requireAdminPassword`, following the same pattern as the
`anonUserProvisionLimiter` in `routes/follows.ts`.

```diff
+import rateLimit from "express-rate-limit";

+/**
+ * Dedicated rate limiter for the admin password-verify endpoint.
+ * Tighter than the global limiter (300 req/min) because each request attempts
+ * a password comparison — a bot can otherwise try ~18,000 guesses per hour
+ * from a single IP. 5 requests per 15 minutes makes brute-force impractical
+ * while keeping the UX instant for legitimate operators.
+ */
+const adminVerifyLimiter = rateLimit({
+  windowMs: 15 * 60 * 1000, // 15 minutes
+  max: 5,
+  standardHeaders: true,
+  legacyHeaders: false,
+  message: { error: "Too many login attempts, please try again later." },
+});

-router.post("/admin/transparency/verify", requireAdminPassword, (_req, res): void => {
+router.post("/admin/transparency/verify", adminVerifyLimiter, requireAdminPassword, (_req, res): void => {
```

The rate limiter fires before the password comparison, so it cannot be bypassed
by sending incorrect credentials.

---

## Fix 2 — Authorisation on invoice downloads

### Problem

`GET /transparency/invoice/*objectPath` took whatever path the caller supplied,
prefixed it with the private storage directory, and returned a signed GCS
download URL with no check that the object was actually a transparency invoice.

**This was confirmed, not theoretical.** During an earlier verification task,
this request succeeded with no `Authorization` header:

```
curl -s -o /dev/null -w "%{http_code}" --max-redirs 0 \
  "http://localhost:8080/api/transparency/invoice/uploads/<some-uuid>"
→ HTTP 302, with a valid signed storage URL in the Location header
```

Any file in the private bucket was retrievable by anyone who knew (or guessed)
its internal path.

### Change

Before constructing `ObjectStorageService`, the route now runs a JSONB
containment query to confirm the requested path is stored as an invoice URL
in at least one `transparency_months` row. If no row matches, the handler
returns `404 Invoice not found` immediately and the signing service is never
reached. The same error message is returned whether the path is not an invoice
or simply does not exist — the difference is not leaked.

```diff
 router.get("/transparency/invoice/*objectPath", async (req: Request, res: Response): Promise<void> => {
-  const service = new ObjectStorageService();
   try {
     const raw = (req.params as Record<string, string | string[]>)["objectPath"] ?? "";
     const suffix = Array.isArray(raw) ? raw.join('/') : String(raw);
     const objectPath = `/objects/${suffix}`;

+    // Reject paths that are not registered as transparency invoices. Without
+    // this check any caller who knows (or guesses) an internal GCS path can
+    // obtain a valid signed download URL for arbitrary private objects.
+    // We return the same "Invoice not found" message whether the path is
+    // simply unknown or is a non-invoice object — do not leak the difference.
+    const rows = await db
+      .select({ id: transparencyMonthsTable.id })
+      .from(transparencyMonthsTable)
+      .where(sql`${transparencyMonthsTable.invoiceUrls} @> ${JSON.stringify([{ url: objectPath }])}::jsonb`)
+      .limit(1);
+
+    if (rows.length === 0) {
+      res.status(404).json({ error: "Invoice not found" });
+      return;
+    }
+
+    const service = new ObjectStorageService();
     const signedUrl = await service.getObjectEntityDownloadUrl(objectPath, /* ttlSec */ 300);
     res.redirect(302, signedUrl);
```

The endpoint remains intentionally public for paths that ARE valid invoices —
visitors can still verify transparency records without logging in.

---

## Tests

New file: `artifacts/api-server/src/lib/__tests__/transparencySecurityGuards.test.ts`

| Test | Assertion |
|---|---|
| 5 sequential requests to verify → all 200 | Rate limiter allows legitimate operators through |
| 6th request to verify → 429 | Rate limiter fires within the same 15-minute window |
| `GET /transparency/invoice/uploads/00000000-…` → 404 | Unregistered path rejected before signing |
| `getObjectEntityDownloadUrl` not called for unregistered path | Signing service is never reached |

### Results

```
pnpm run typecheck   →  exit 0  (4/4 packages clean)

pnpm --filter @workspace/api-server run test
  Test Files  83 passed (83)
       Tests  711 passed (711)
    Duration  50.60s
```

Net change: **+4 tests** (707 → 711). No existing tests modified.

---

## Files Changed

| File | Change |
|---|---|
| `artifacts/api-server/src/routes/transparency.ts` | Added `adminVerifyLimiter`; applied to verify route; added JSONB invoice-path check before signing |
| `artifacts/api-server/src/lib/__tests__/transparencySecurityGuards.test.ts` | New — rate-limit and invoice-path-auth regression guards |
