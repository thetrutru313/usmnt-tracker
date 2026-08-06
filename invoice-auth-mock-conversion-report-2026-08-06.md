# Invoice Auth Test Mock Conversion Report — 2026-08-06

## Question answered

The previous `transparencySecurityGuards.test.ts` wrote to a real database.
It had no `vi.mock("@workspace/db")` call. It required both `DATABASE_URL`
(to connect) and `ADMIN_PASSWORD` (to seed the sentinel row via
`POST /api/admin/transparency`). It did not match the pattern used by the
other test files in that directory.

---

## Sentinel row check

```sql
SELECT id, period_year, period_month, invoice_urls
FROM transparency_months WHERE period_year = 1900;
```

```
 id | period_year | period_month | invoice_urls
----+-------------+--------------+--------------
(0 rows)
```

No leaked data — the `afterAll` cleanup had run successfully.

---

## What changed

`transparencySecurityGuards.test.ts` was deleted and replaced with two files
with the correct isolation boundary:

---

### `transparencyVerifyRateLimit.test.ts`

**What it tests:** Express middleware ordering — the rate limiter fires before
`requireAdminPassword` and returns 429 on the 6th request within a 15-minute
window.

**Why it imports `app`:** Rate-limit state lives on the shared Express app
instance. The only way to test the middleware stack is via supertest against
the real app.

**Database requirement:** Requires `DATABASE_URL`. The verify route itself
makes no DB calls, but `app → routes/index.ts → queries.ts → @workspace/db`
throws at import time if `DATABASE_URL` is unset. This is the same category
as the other 30+ integration tests in the directory.

**Mocks:** None. No DB mock needed because the verify endpoint never touches
the DB.

---

### `transparencyInvoicePathGuard.test.ts`

**What it tests:** The route's authorisation logic — whether a path absent
from `invoice_urls` returns 404 without reaching the signing service, and
whether a path present in `invoice_urls` returns 302 and calls
`getObjectEntityDownloadUrl` with the correct arguments.

**Why it does NOT import `app`:** The full app transitively loads `queries.ts`,
which accesses table columns (e.g. `playersTable.id`) at module-load time.
Mocking `@workspace/db` with only `{ db, transparencyMonthsTable }` would
leave those accesses as `undefined.id` — a crash. Mounting only the
transparency router avoids loading any module outside the route under test.

**Database requirement:** None. `@workspace/db` is fully mocked. `DATABASE_URL`
is not read.

**Mocks:**
- `@workspace/db` → `{ db: mockDb, transparencyMonthsTable: tTransparency }`
  where `mockDb.select()` returns a chainable stub whose terminal `.limit()`
  defaults to `[]` (negative case) and can be overridden per-test with
  `mockResolvedValueOnce`.
- `../objectStorage.js` → `ObjectStorageService` is a class (not an arrow
  function) so it survives `new` calls; `getObjectEntityDownloadUrl` is a
  `vi.fn()` whose call count is asserted in each test.

**No sentinel row.** No `beforeAll` seeding, no `afterAll` cleanup, no
unique-constraint collision risk on re-run.

---

## Test matrix

| File | Test | Expected | Verified |
|---|---|---|---|
| `transparencyVerifyRateLimit` | Requests 1–5 | 200 | ✅ |
| `transparencyVerifyRateLimit` | Request 6 | 429 | ✅ |
| `transparencyInvoicePathGuard` | Unregistered path → status | 404 | ✅ |
| `transparencyInvoicePathGuard` | Unregistered path → signing | not called | ✅ |
| `transparencyInvoicePathGuard` | Registered path → status | 302 | ✅ |
| `transparencyInvoicePathGuard` | Registered path → signing args | called once, correct path + TTL | ✅ |

---

## Verification — normal run

```
pnpm run typecheck   →  exit 0  (4/4 packages clean)

pnpm --filter @workspace/api-server run test
  Test Files  84 passed (84)
       Tests  712 passed (712)
    Duration  49.67s
```

---

## Verification — DATABASE_URL and ADMIN_PASSWORD unset

`transparencyInvoicePathGuard.test.ts` — **passes** (fully mocked, no DB needed)

`transparencyVerifyRateLimit.test.ts` — **fails** (imports `app`, which
transitively imports `@workspace/db`, which throws without `DATABASE_URL`)

This is not a regression. The following pre-existing transparency integration
tests fail under the same condition for the same reason:

- `transparencyInvoiceDeletion.test.ts`
- `transparencyInvoiceLabelEdit.test.ts`
- `transparencyInvoiceValidation.test.ts`

**For CI:** Two tiers exist in the suite.

| Tier | Requirement | Example files |
|---|---|---|
| Unit / mocked | No Postgres needed | `transparencyInvoicePathGuard`, `rescoreSkipsManualOverride`, `anonUserCleanup`, … |
| Integration | `DATABASE_URL` required | `transparencyVerifyRateLimit`, `transparencyInvoiceValidation`, `chiplessFixtureFilter`, … |

`transparencyVerifyRateLimit` is in the integration tier. Any CI environment
that runs only the mocked tier can skip it; a full suite run requires Postgres.

---

## Files changed

| File | Change |
|---|---|
| `artifacts/api-server/src/lib/__tests__/transparencySecurityGuards.test.ts` | Deleted |
| `artifacts/api-server/src/lib/__tests__/transparencyVerifyRateLimit.test.ts` | New — rate-limit guard, integration tier |
| `artifacts/api-server/src/lib/__tests__/transparencyInvoicePathGuard.test.ts` | New — path-auth guard, mocked, no DB needed |
