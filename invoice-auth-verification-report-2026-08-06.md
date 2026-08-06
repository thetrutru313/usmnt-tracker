# Invoice Authorisation Verification Report — 2026-08-06

## Context

Follow-up to the security fix applied in the same session. The invoice
authorisation fix (JSONB containment check before signing) needed a
positive-case verification confirming that legitimate invoices still download,
and a matching positive-case test to guard against over-blocking regressions.

---

## Step 1 — What is actually stored in invoice_urls

Query run:

```sql
SELECT id, period_year, period_month, invoice_urls
FROM transparency_months
WHERE invoice_urls IS NOT NULL AND invoice_urls::text != '[]';
```

Verbatim output:

```
 id | period_year | period_month |                                       invoice_urls
----+-------------+--------------+------------------------------------------------------------------------------------------
  1 |        2026 |            7 | [{"url": "/objects/uploads/b13c3d1b-787c-4bc0-bf7c-1fec550d6153", "label": "API Costs"}]
(1 row)
```

**Finding:** One row, one invoice. The stored `url` value is exactly
`/objects/uploads/<uuid>` — the format produced by `normalizeObjectEntityPath`
when the GCS path falls inside `PRIVATE_OBJECT_DIR`. No legacy full-https URLs,
no raw bucket pathnames. The JSONB containment check targets this format
correctly.

---

## Step 2 — Known-good request re-run

```
curl -s -o /dev/null -w "%{http_code}\n" --max-redirs 0 \
  "http://localhost:8080/api/transparency/invoice/uploads/b13c3d1b-787c-4bc0-bf7c-1fec550d6153"
```

Result: **302** ✅

The fix is correctly scoped. Real invoices are not over-blocked.

---

## Step 3 — No fix required

The stored format matches the assumption made by the authorisation check.
All one invoice tested returns 302. No migration or format-widening needed.

---

## Step 4 — Positive-case test added

Added to `artifacts/api-server/src/lib/__tests__/transparencySecurityGuards.test.ts`.

### Approach

A sentinel `transparency_months` row (year=1900, month=1) is created in
`beforeAll` via `POST /api/admin/transparency` with a fake object path
(`/objects/uploads/ffffffff-ffff-ffff-ffff-ffffffffffff`). This decouples the
test from live production data — the real July 2026 invoice can be removed
without breaking the suite. The sentinel row is deleted in `afterAll`.

### New test

```
GET /api/transparency/invoice/uploads/ffffffff-ffff-ffff-ffff-ffffffffffff
```

Asserts:
- Response status is **302**
- `getObjectEntityDownloadUrl` was called **exactly once**
- It was called with the correct normalised path (`/objects/uploads/ffffffff-…`) and TTL (`300`)

### Full test matrix after this change

| Test | Path type | Expected status | Signing called? |
|---|---|---|---|
| Negative — 404 body | Not in invoice_urls | 404 | No |
| Negative — signing guard | Not in invoice_urls | 404 | No |
| **Positive — 302 + signing** | Present in invoice_urls | **302** | **Yes** |

---

## Verification

```
pnpm run typecheck   →  exit 0  (4/4 packages clean)

pnpm --filter @workspace/api-server run test
  Test Files  83 passed (83)
       Tests  712 passed (712)
    Duration  48.26s
```

Net change from yesterday's baseline: **+5 tests** (707 → 712). No existing
tests modified.

---

## Files changed this session

| File | Change |
|---|---|
| `artifacts/api-server/src/lib/__tests__/transparencySecurityGuards.test.ts` | Added positive-case test + sentinel row seed/teardown |
