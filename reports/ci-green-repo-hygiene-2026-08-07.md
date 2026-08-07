# CI Green + Repo Hygiene — 2026-08-07

**Commit:** `784fdc6`  
**CI run:** [#1 on ci.yml](https://github.com/thetrutru313/usmnt-tracker/actions/runs/31221161907) — **all 21 steps green**  
**Prior run:** [#2 on codegen-drift.yml](https://github.com/thetrutru313/usmnt-tracker/actions/runs/31219416507) — failed (9 tests, 6 files)

---

## Tasks completed

| Task | What was done |
|---|---|
| A | Added `API_FOOTBALL_KEY: ci-placeholder-api-football-key` to the workflow `env:` block |
| B | Deleted the stale 3-failure NOTE from the `Test – API server` step |
| C | `git mv codegen-drift.yml → ci.yml` |
| D | Added `README.md` at the repo root |
| E | Added `LICENSE` (MIT) at the repo root |
| F | `git mv admin-login-diagnostic-2026-08-06.md → reports/` |
| G | Added CI carve-out sentence to the `drizzle-kit push` prohibition in `replit.md` |

---

## 1. Placeholder-key run — exact counts

```
API_FOOTBALL_KEY=ci-placeholder-api-football-key \
  pnpm --filter @workspace/api-server run test

 Test Files  89 passed (89)
       Tests  728 passed (728)
    Duration  47.08s
```

The bogus placeholder is not a valid API-Football credential. Every test that previously
threw `Error: API_FOOTBALL_KEY is not set` now reaches its `vi.stubGlobal("fetch", ...)`
stub and passes. No test made a real network call — a real key would be needed for that,
and the placeholder caused no 401/403 failures.

**Root cause of the original 9 failures:** `apiKey()` (line 33 of `apiFootballSync.ts`)
throws before `fetch` is ever called, because JavaScript evaluates function arguments
before invoking the callee. The stubs on `globalThis.fetch` were correct all along —
they were simply unreachable. One environment variable makes them reachable.

---

## 2. The three files named in the stale comment — all passed

| File | Result |
|---|---|
| `coleCampbellNoStatsGraceful.test.ts` | ✅ passed |
| `recoveryRoundTrip.test.ts` | ✅ passed |
| `rescoreCapOrderingIntegration.test.ts` | ✅ passed |

All three passed in CI run #2 (before this fix) and again locally with the placeholder
key. The stale comment that named them as failures was incorrect from the moment it was
written — it predated the seeding changes that made them pass.

---

## 3. Final workflow `env:` block — verbatim

```yaml
    env:
      DATABASE_URL: postgres://postgres:postgres@localhost:5432/usmnt_test
      # Non-secret CI values — replace with ${{ secrets.NAME }} if you need
      # the full integration surface (transparency invoice routes, rate-limit
      # tests) to run against real credentials.
      ADMIN_PASSWORD: ci-placeholder-admin-password
      # Placeholder value — never transmitted. It satisfies apiKey() so that
      # vi.stubGlobal("fetch", ...) stubs in the test files are reachable.
      # A real key would silently hit the live paid API on every push.
      API_FOOTBALL_KEY: ci-placeholder-api-football-key
      # Required by the Vite build step (prevents vite.config.ts from throwing)
      PORT: "5173"
      BASE_PATH: /
```

---

## 4. README.md written

```markdown
# USMNT Tracker

A tracker for US Men's National Team soccer players worldwide. The focus is fixture
aggregation and broadcast information — where each player is playing, which games are
streaming and on which services, and how to follow them across leagues and competitions.
Live score polling during matches is a secondary convenience, not the product.

Covers club fixtures, stats, injuries, transfers, and a prospect board for players
approaching national team eligibility.

## Stack

pnpm workspace monorepo · Node.js 24 · Express 5 API · React 19 + Vite 7 frontend ·
PostgreSQL 16 via Drizzle ORM · OpenAPI-driven client codegen via Orval · Deployed on Replit.

## Layout

| Directory                 | What's inside                                               |
|---|---|
| `artifacts/api-server`    | Express 5 REST API — routes, sync jobs, admin panel         |
| `artifacts/usmnt-tracker` | React 19 SPA — the public-facing frontend                   |
| `lib/db`                  | Drizzle schema (source of truth) and generated migration SQL |
| `lib/api-spec`            | OpenAPI 3 spec — the contract between API and frontend      |
| `lib/api-zod`             | Zod schemas generated from the spec                         |
| `lib/api-client-react`    | Typed React hooks generated from the spec via Orval         |
| `e2e`                     | Playwright end-to-end tests                                 |
| `scripts`                 | Seed scripts and one-off data operations                    |
| `reports`                 | Point-in-time records from past development sessions        |

## Getting started

    # pnpm is enforced — npm and yarn will refuse (preinstall guard in package.json)
    pnpm install

Running the full stack locally requires three processes. See replit.md for the complete
local setup guide and .env.example for all required environment variables.

    # In one terminal — API server (port 8080)
    pnpm --filter @workspace/api-server run dev

    # In another terminal — frontend dev server (proxies /api to port 8080)
    pnpm --filter @workspace/usmnt-tracker run dev

Other useful commands from the repo root:

    pnpm run lint        # ESLint across all packages
    pnpm run typecheck   # TypeScript across all packages
    pnpm run build       # typecheck + build all packages

## Documentation

| Document            | What it covers                                      |
|---|---|
| replit.md           | Architecture, local setup, deployment, gotchas      |
| lib/db/README.md    | Schema conventions, migration workflow, production  |
| threat_model.md     | Security architecture, rate limiters, CORS/CSP      |
| reports/README.md   | What the reports/ directory is and is not           |

## Status and licence

Personal project, actively developed. MIT licensed — see LICENSE.
```

---

## 5. Sentence added to `replit.md` (Task G)

The existing prohibition on `drizzle-kit push` now reads:

> **`drizzle-kit push` must never be used** against dev or production — it bypasses
> migration history. **The CI service container is the sole exception: it is created
> from scratch on each run and has no migration history to preserve.**

---

## 6. Inspection checklist — all pass

| Check | Result |
|---|---|
| `.github/workflows/ci.yml` exists | ✅ |
| `.github/workflows/codegen-drift.yml` does not exist | ✅ |
| `API_FOOTBALL_KEY: ci-placeholder-api-football-key` in env block | ✅ |
| `secrets.API_FOOTBALL_KEY` appears nowhere in the repo | ✅ |
| Stale 3-failure NOTE (lines 84-89) gone | ✅ |
| `README.md` exists at root | ✅ |
| `LICENSE` exists at root | ✅ |
| `git ls-files` shows `reports/admin-login-diagnostic-2026-08-06.md` | ✅ |
| Root copy of `admin-login-diagnostic-2026-08-06.md` absent | ✅ |
| Every command in README.md resolves to a real `package.json` script | ✅ |

---

## 7. CI run #1 on ci.yml — step-by-step

All 21 steps green. First fully green run.

| # | Step | Result |
|---|---|---|
| 3 | Checkout | ✅ |
| 8 | Install dependencies | ✅ |
| 9 | Codegen drift check | ✅ |
| 10 | Lint | ✅ |
| 11 | Typecheck | ✅ |
| 12 | Build | ✅ |
| 13 | Push database schema | ✅ |
| 14 | Test – API server (89 files / 728 tests) | ✅ |
| 15 | Test – USMNT Tracker (frontend) | ✅ |

---

## 8. Anything not anticipated by the prompt

**GitHub run numbering reset as expected.** The renamed `ci.yml` started at Run #1.
The first run on the new filename was immediately green — no warm-up failures.

**`secrets.API_FOOTBALL_KEY` is absent from the entire repo.** Confirmed by grep across
all `.yml`/`.yaml` files. The placeholder is a hardcoded literal string, not a secret
reference — consistent with the design intent (the value is intentionally bogus).

**Lint: 4 pre-existing warnings, 0 errors.** Same warnings as before this session
(`@typescript-eslint/no-explicit-any` in `follows.test.ts` and `PlayerProfile.tsx`).
Not introduced by this work.
