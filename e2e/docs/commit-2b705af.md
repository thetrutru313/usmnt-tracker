# Commit Record — 2b705af

```
commit 2b705af
branch  main
date    2026-08-07
```

## Message

```
fix: unblock admin invoice upload, harden duplicate-month handling

Invoice upload had been broken since 2026-07-24, when commit b6c613a
replaced index.html and introduced a CSP with connect-src 'self'. The
upload flow PUTs directly from the browser to Google Cloud Storage, which
that policy blocks. Server side was never at fault. The single existing
production invoice predates the CSP by 8 days.

- Extend connect-src to the scoped GCS bucket path, not the whole origin,
  so an XSS cannot exfiltrate to an attacker-controlled bucket
- Rewrite the CSP comment block, which claimed "no external fetch targets"
- Permit http://localhost:* origins in non-production so dev exercises CORS
  rather than bypassing it
- Revert the Vite proxy Origin-stripping workaround, which had disabled
  CORS in dev entirely
- Return 409 rather than 500 on duplicate transparency month: Drizzle's
  error message does not reliably contain "unique", so check PG code 23505
- Add mocked unit test pinning 23505 -> 409, message-match -> 409,
  other -> 500
- Add Playwright e2e covering the full upload round trip, with teardown
  that deletes the fixture month so it cannot appear on the public page
- Add .env.example documenting all environment variables

Not promoted to CI: the e2e test needs GCS credentials and a pre-seeded
admin session in the runner. A rate-limit bypass header was considered and
rejected — a second auth path into admin is a worse trade than a slow test.
```

## Diff stat

```
10 files changed, 865 insertions(+), 11 deletions(-)
```

| File | Status | +/− |
|------|--------|-----|
| `.agents/agent_assets_metadata.toml` | modified | +14 |
| `.env.example` | **new** | +56 |
| `artifacts/api-server/src/app.ts` | modified | +25 / −3 |
| `artifacts/api-server/src/lib/__tests__/transparencyDuplicateMonthCreate.test.ts` | **new** | +162 |
| `artifacts/api-server/src/routes/transparency.ts` | modified | +4 / −1 |
| `artifacts/usmnt-tracker/index.html` | modified | +33 / −2 |
| `artifacts/usmnt-tracker/vite.config.ts` | modified | +3 / −2 |
| `e2e/docs/csp-cors-upload-fix-report.md` | **new** | +200 |
| `e2e/docs/upload-e2e-analysis.md` | **new** | +101 |
| `e2e/tests/admin-upload-verify.spec.ts` | **new** | +270 |

## Squash note

Four Replit auto-commits (`1572adf`, `51ea4fa`, `4fe1850`, `acc98ea`) were
soft-reset and re-committed as this single entry. The prior commit `b872b9e`
(diagnosis report, analysis only) was left intact as its own history entry.

## Verification at commit time

| Check | Result |
|-------|--------|
| `pnpm run lint` | ✅ 0 errors |
| `pnpm run typecheck` | ✅ clean |
| `pnpm run build` | ✅ clean |
| `pnpm --filter @workspace/api-server run test` | ✅ 87 files · 722 tests |
| `pnpm --filter @workspace/usmnt-tracker run test` | ✅ 12 files · 215 tests |
| `pnpm --filter @workspace/e2e run test` | ✅ 21 tests (incl. new upload spec) |
| `git ls-files backups/` | ✅ empty |
