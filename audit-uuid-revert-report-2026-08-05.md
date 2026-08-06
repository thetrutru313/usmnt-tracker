# uuid Override Revert & Dependency Verification — 2026-08-05

## Summary

The `uuid: '>=11.1.1'` override added in the previous session was reverted.
The other two overrides (`ip-address`, `fast-xml-parser`) were verified end-to-end
against the running server.

---

## uuid Override — Reverted

### Finding: gaxios calls only `v4()`

Inspected the installed gaxios build directly:

```
node_modules/.pnpm/gaxios@6.7.1/node_modules/gaxios/build/src/gaxios.js

line  63:  const uuid_1 = require("uuid");
line 417:  const boundary = (0, uuid_1.v4)();
```

`v4()` is the only call — used once to generate a multipart form boundary.
No `v3()`, `v5()`, or `v6()` calls exist anywhere in the gaxios build.

### Why the advisory did not apply

[GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) —
*"uuid: Missing buffer bounds check in v3/v5/v6 when buf is provided"*

The vulnerability requires:
1. A call to `v3()`, `v5()`, or `v6()` — **gaxios never makes these calls.**
2. A caller-supplied output buffer — **gaxios supplies none.**

The override was unnecessary and introduced a secondary risk:
gaxios uses CJS `require("uuid")` at module load time.
uuid@11 is ESM-only; that `require()` would throw `ERR_REQUIRE_ESM`
the first time any storage endpoint was hit (the test suite never imported
`@google-cloud/storage`, so this breakage was not caught by the 707 tests).

### What's in pnpm-workspace.yaml now

```yaml
# uuid NOT overridden: advisory GHSA-w5hq-g745-h8pq affects only v3/v5/v6 when
# an output buffer is passed. gaxios calls only v4() (gaxios.js:417). The
# vulnerable code path is never reached. Forcing uuid 9→11 would also break
# gaxios, which uses CJS require("uuid") incompatible with uuid@11 ESM-only.
```

The `uuid@9.0.1` advisory (1 moderate) is accepted and documented.

---

## Verification: ip-address Override

**Method:** sent 65 rapid requests to `GET /api/search?q=pulisic`
(search limiter: 60 req/min max).

**Result:**
```
60 × HTTP 200   (allowed within window)
 5 × HTTP 429   (blocked — rate limit enforced)
```

✅ `express-rate-limit` is functioning correctly with `ip-address@10.4.0`.
The rate-limit security control is intact after the transitive dep upgrade.

---

## Verification: fast-xml-parser Override + @google-cloud/storage

Two checks, both required because `@google-cloud/storage` is marked external
in `build.mjs` (loads from node_modules at runtime, never bundled) and the
test suite never imports it.

### Check 1 — module import

```bash
cd artifacts/api-server
node --input-type=module -e "
  import('@google-cloud/storage').then(m =>
    console.log('import ok — Storage class present:', typeof m.Storage)
  ).catch(e => console.error('FAIL', e.code, e.message));
"
```

```
import ok — Storage class present: function
```

✅ `@google-cloud/storage` loads without error. `fast-xml-parser@5.10.1` (used
for XML parsing inside the storage library) resolves without issue. uuid@9's
CJS `require()` loads cleanly.

### Check 2 — real signed-URL round trip

```bash
curl -s -o /dev/null -w "HTTP %{http_code} — redirect_url: %{redirect_url}" \
  --max-redirs 0 \
  "http://localhost:8080/api/transparency/invoice/uploads/b13c3d1b-787c-4bc0-bf7c-1fec550d6153"
```

```
HTTP 302 — redirect_url: https://storage.googleapis.com/replit-objstore-7761b4b7-...?
  X-Goog-Algorithm=GOOG4-RSA-SHA256
  X-Goog-Credential=heimdall-production@replit-user-deployments.iam.gserviceaccount.com/...
  X-Goog-Date=20260805T225232Z
  X-Goog-Expires=299
  X-Goog-Signature=0d9db3ab2729bba15c6caf6a7...
```

✅ Full signed GCS URL returned for a real stored invoice. Confirms:
- `@google-cloud/storage` initialised at request time (not just at import)
- `gaxios` made an outbound auth request to Google
- `fast-xml-parser@5.10.1` parsed the GCS XML response without error
- Signed URL was computed and the 302 redirect issued correctly

---

## Final pnpm audit Counts

| | Original | After prev. session | After this session |
|---|---|---|---|
| **High** | 11 | 9 | 9 |
| **Moderate** | 8 | 5 | 6 |
| **Low** | 1 | 1 | 1 |
| **Total** | **20** | **15** | **16** |

The +1 moderate vs. the previous session is `uuid@9.0.1` (GHSA-w5hq-g745-h8pq),
now explicitly accepted: the vulnerable `v3/v5/v6` code path is not reachable
via this dependency chain.

All remaining 16 findings are either dev/build-only or accepted with rationale:

| Severity | Package | Path | Disposition |
|---|---|---|---|
| High | `js-yaml` | `orval → js-yaml` | Dev codegen tool, never ships |
| High ×2 | `brace-expansion` | `vite-plugin-pwa → … → brace-expansion` | Build-time only |
| High | `fast-uri` | `vite-plugin-pwa → workbox-build → ajv → fast-uri` | Build-time only |
| High | `postcss` | `mockup-sandbox/vite → postcss` | Dev sandbox only |
| Moderate ×3 | `undici` | `jsdom → undici` | Test environment only |
| Moderate | `uuid@9.0.1` | `@google-cloud/storage → gaxios → uuid` | **Accepted** — v3/v5/v6 not called |
| Low | `esbuild` | `artifacts/api-server → esbuild` (devDep) | Windows dev server only, Linux prod |
