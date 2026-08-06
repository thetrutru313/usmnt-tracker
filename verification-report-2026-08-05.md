# Verification Report — Aug 5 2026

## Environment Note

The plan-mode shell mounts the workspace **read-only** (exit 254 on any write). Every command that needs to write — `node_modules`, `.tsbuildinfo`, `vite-temp`, `dist/` — fails with:

```
Workspace files are read-only in this shell: <path>
```

This is a shell-environment constraint, not a code error. Where the shell was blocked I fall back to the most recent workflow run or the compiled artefact timestamps.

---

## Steps 1–5

### Step 1 — `pnpm install --frozen-lockfile`

**Blocked (exit 254).** First error line:

```
Workspace files are read-only in this shell:
/home/runner/workspace/_tmp_137_a3036bc5f36be608097c8134137a1591
```

Cannot confirm whether the lockfile is in sync from this shell. No evidence of drift either — pnpm never reached the check phase.

---

### Step 2 — `pnpm run typecheck`

**Blocked (exit 254).** First error line:

```
Workspace files are read-only in this shell:
/home/runner/workspace/lib/db/dist/schema/fixtures.d.ts.map
```

`tsc --build` writes incremental declaration maps. Tried `tsc --noEmit` directly and `tsc -p tsconfig.json --noEmit` per-artifact — both still try to update `.tsbuildinfo` and fail identically. Cannot confirm pass/fail from plan mode.

Circumstantial evidence: `lib/db/dist/index.d.ts.map` was last written **Aug 4 01:35**, `artifacts/api-server/dist/index.mjs` was last written **Aug 5 20:23** — both suggesting the most recent build succeeded.

---

### Step 3 — `pnpm run build`

**Blocked (exit 254)** — build script runs typecheck first, same failure. First error line identical to step 2.

---

### Step 4 — `pnpm --filter @workspace/api-server run test`

**Blocked (exit 254) from plan-mode shell.** First error line:

```
Workspace files are read-only in this shell:
/home/runner/workspace/artifacts/api-server/node_modules/.vite-temp/
  vitest.config.ts.timestamp-1785968496527-aa2cb51c8cbf2.mjs
```

**Confirmed result from the `api-server-test` workflow run at 20:37:18 today** (51 minutes before this report, just before plan mode was activated):

```
 Test Files  82 passed (82)
      Tests  707 passed (707)
   Start at  20:37:18
   Duration  51.66s
```

---

### Step 5 — `pnpm --filter @workspace/usmnt-tracker run test`

**Blocked (exit 254) from plan-mode shell.** Same vite-temp write failure.

The `usmnt-tracker` package has a `test` script (`vitest run --config vitest.config.ts`) and **11 test files**:

```
src/lib/livePolling.test.ts
src/test/adminSession.test.ts
src/test/FixtureCard.test.tsx
src/test/livePolling.test.ts
src/test/useLiveElapsedMinute.test.tsx
src/test/dateLabels.test.ts
src/test/Fixtures.test.tsx
src/test/Recover.test.tsx
src/test/PlayerProfile.test.tsx
src/test/PlayerCard.test.tsx
src/test/MyPlayersContext.test.tsx
```

There is **no configured workflow** for this test suite and no cached output in `/tmp/logs`. **Last run result is unknown** — pass/fail count cannot be reported.

---

## Answers to A–E

### A — Did all five commands succeed?

**No.** All five fail in the plan-mode shell due to the read-only workspace constraint, not due to code problems. The only confirmed real test result is step 4: **707/707 passed** at 20:37 today. Steps 1–3 and 5 cannot be confirmed either way from this environment.

---

### B — Test counts

| Step | Test files | Tests ran | Passed | Source |
|------|-----------|-----------|--------|--------|
| 4 — api-server | 82 | 707 | 707 | Workflow log 20:37:18 today |
| 5 — usmnt-tracker | 11 (found on disk) | unknown | unknown | No workflow; plan-mode shell blocked |

---

### C — `pnpm --filter db run push-force`

**Yes, it resolves.** Running `pnpm --filter db run push-force --help` (exit 0) matched `@workspace/db` and printed the drizzle-kit push help text. The package name is `@workspace/db` in `lib/db/package.json` and the filter `db` is sufficient to match it. A real `pnpm --filter db run push-force` **would execute a schema push** against that package.

---

### D — Server restarts and sync cadence

**Deployment logs:** The Replit deployment log wrapper captures infrastructure messages but the pino JSON logs (where "Server listening" and "Sync skipped — ran recently" appear) are not written to `/tmp/logs`. No deployment log files were present in `/tmp/logs` at query time (they appear to expire within the session). **7-day restart count cannot be determined from available logs.**

**sync_metadata (production, 5 rows, read-only SELECT):**

| sync_name | last_run_at (UTC) | Age at query time (~23:45 UTC) |
|-----------|------------------|--------------------------------|
| `fixtures` | 2026-08-05 21:43:09 | ~2h ago |
| `usmntStats` | 2026-08-05 21:43:07 | ~2h ago |
| `playerClub` | 2026-08-04 21:59:12 | ~26h ago |
| `nationalTeamCaps` | 2026-08-04 21:59:12 | ~26h ago |
| `playerStats` | 2026-08-04 21:59:12 | ~26h ago |

All five syncs have run. `fixtures` and `usmntStats` ran ~2 hours ago; the remaining three ran ~26 hours ago.

---

### E — `pnpm audit`

**20 vulnerabilities: 11 high · 8 moderate · 1 low**

Full breakdown by package:

| Package | Severity | Count | Dependency path |
|---------|----------|-------|-----------------|
| `js-yaml` | high | 1 | `lib/api-spec > orval > js-yaml` |
| `fast-uri` | high | 2 | `usmnt-tracker > vite-plugin-pwa > workbox-build > ajv > fast-uri` |
| `fast-xml-parser` | high | 1 | `api-server > @google-cloud/storage > fast-xml-parser` |
| `postcss` | high | 1 | `mockup-sandbox > vite > postcss` |
| `brace-expansion` | high | 4 | `usmnt-tracker > vite-plugin-pwa > workbox-build > ...` |
| `undici` | high | 1 | `usmnt-tracker > jsdom > undici` (info disclosure) |
| `ip-address` | high | 1 | `api-server > express-rate-limit > ip-address` |
| `uuid` | moderate | 1 | `api-server > @google-cloud/storage > uuid` |
| `postcss` | moderate | 1 | `mockup-sandbox > vite > postcss` |
| `undici` | moderate | 4 | `usmnt-tracker > jsdom > undici` |
| `ip-address` | moderate | 2 | `api-server > express-rate-limit > ip-address` |
| `esbuild` | low | 1 | `api-server > esbuild` |

**Are any in packages we import directly?**

Only one: **`esbuild`** is a direct `devDependency` of `artifacts/api-server` and is itself the vulnerable package (Windows-only dev server arbitrary file read, low severity). All other vulnerable packages are transitive — the directly-imported ancestors that pull them in are:

- `@google-cloud/storage` (api-server) → `fast-xml-parser` (high), `uuid` (moderate)
- `express-rate-limit` (api-server) → `ip-address` (1 high, 2 moderate)
- `vite-plugin-pwa` (usmnt-tracker) → `fast-uri` (2 high), `brace-expansion` (4 high)
- `jsdom` (usmnt-tracker, dev) → `undici` (1 high, 4 moderate)
- `vite` (mockup-sandbox) → `postcss` (1 high, 1 moderate)
- `orval` (lib/api-spec) → `js-yaml` (1 high)

---

*No code or configuration was changed during this verification pass.*
