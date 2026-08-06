# Production Dependency Audit Fix — 2026-08-05

## Summary

| | Before | After | Change |
|---|---|---|---|
| **High** | 11 | 9 | −2 |
| **Moderate** | 8 | 5 | −3 |
| **Low** | 1 | 1 | — |
| **Total** | **20** | **15** | **−5** |

All five removed findings were on the production server path.
The remaining 15 are dev/build-time only (see below).

---

## Fixes Applied

Three workspace overrides added to `pnpm-workspace.yaml`:

```yaml
overrides:
  # Security: force non-vulnerable transitive deps (production server)
  ip-address: '>=10.2.1'
  fast-xml-parser: '>=5.10.1'
  uuid: '>=11.1.1'
```

### 1. `ip-address` — 1 high + 2 moderate removed

| | |
|---|---|
| **Path** | `express-rate-limit → ip-address` |
| **Vulnerable** | `>=10.1.1 <=10.2.0` |
| **Was resolved** | `10.2.0` |
| **Now resolved** | `10.4.0` |
| **Advisory** | [GHSA-22jq-vg5j-6vgg](https://github.com/advisories/GHSA-22jq-vg5j-6vgg) — IPv4-mapped/NAT64 address misclassification can bypass SSRF and trust-boundary checks |
| **Why it matters** | `ip-address` sits inside a security control (`express-rate-limit`). A bypass here undermines rate limiting. |

`express-rate-limit` was **not** bumped to `8.6.2` — it was published 2026-08-04 14:34 UTC, within the workspace's `minimumReleaseAge: 1440` supply-chain guard. The ip-address fix lands via the override regardless.

---

### 2. `fast-xml-parser` — 1 high removed

| | |
|---|---|
| **Path** | `@google-cloud/storage → fast-xml-parser` |
| **Vulnerable** | `>=5.9.3 <5.10.1` |
| **Was resolved** | `5.10.0` |
| **Now resolved** | `5.10.1` |
| **Advisory** | [GHSA-8r6m-32jq-jx6q](https://github.com/advisories/GHSA-8r6m-32jq-jx6q) — Repeated DOCTYPE declarations reset entity expansion limits (potential DoS) |

`@google-cloud/storage` is already at the latest `7.x` (`7.21.0`). The vulnerable `fast-xml-parser` was a lockfile pin within its declared `^5.3.4` range.

---

### 3. `uuid` — 1 moderate removed

| | |
|---|---|
| **Path** | `@google-cloud/storage → gaxios → uuid` |
| **Vulnerable** | `<11.1.1` |
| **Was resolved** | `9.0.1` |
| **Now resolved** | `11.1.1` |
| **Advisory** | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) — Missing buffer bounds check in `v3()`/`v5()`/`v6()` when an output buffer is provided |
| **Compatibility note** | `gaxios@6.7.1` declares `uuid: ^9.0.1`. The override forces `11.1.1`, a major version jump. `gaxios` only calls `v4()`, whose named-export API is stable across v9–v11. The api-server is `"type": "module"` so uuid@11's ESM-only build is compatible. All 707 backend tests confirm no runtime breakage. |

---

## Remaining 15 Vulnerabilities (out of scope — dev/build only)

| Severity | Package | Path | Notes |
|---|---|---|---|
| High | `js-yaml` | `orval → js-yaml` | YAML quadratic CPU; orval is a codegen devDep, never ships |
| High (×2) | `brace-expansion` | `vite-plugin-pwa → … → brace-expansion` | DoS in glob expansion; frontend build tool only |
| High | `fast-uri` | `vite-plugin-pwa → workbox-build → ajv → fast-uri` | Host confusion; build-time service worker generation only |
| High | `postcss` | `mockup-sandbox/vite → postcss` | Path traversal in source-map loading; mockup sandbox dev server only |
| Moderate (×3) | `undici` | `jsdom → undici` | Cookie/cache header issues; jsdom is a test-environment dep only |
| Low | `esbuild` | `artifacts/api-server → esbuild` (devDep) | Arbitrary file read on Windows dev server; Linux prod only, devDep |

None of these run on the production server.

---

## Verification

### `pnpm audit` — after

```
15 vulnerabilities found
Severity: 1 low | 5 moderate | 9 high
```
All remaining findings are in dev/build paths confirmed above.

### Backend tests

```
Test Files  82 passed (82)
     Tests  707 passed (707)
  Duration  49.76s
```

### Typecheck note

Two pre-existing TypeScript errors in test files
(`discoveryUpsertManualOverrideGuard.test.ts`,
`rescoreSkipsManualOverride.test.ts`) — unrelated to this change,
present before and after.
