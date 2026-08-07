# USMNT Tracker

A tracker for US Men's National Team soccer players worldwide. The focus is fixture aggregation and broadcast information — where each player is playing, which games are streaming and on which services, and how to follow them across leagues and competitions. Live score polling during matches is a secondary convenience, not the product.

Covers club fixtures, stats, injuries, transfers, and a prospect board for players approaching national team eligibility.

## Stack

pnpm workspace monorepo · Node.js 24 · Express 5 API · React 19 + Vite 7 frontend · PostgreSQL 16 via Drizzle ORM · OpenAPI-driven client codegen via Orval · Deployed on Replit.

## Layout

| Directory | What's inside |
|---|---|
| `artifacts/api-server` | Express 5 REST API — routes, sync jobs, admin panel |
| `artifacts/usmnt-tracker` | React 19 SPA — the public-facing frontend |
| `lib/db` | Drizzle schema (source of truth) and generated migration SQL |
| `lib/api-spec` | OpenAPI 3 spec — the contract between API and frontend |
| `lib/api-zod` | Zod schemas generated from the spec |
| `lib/api-client-react` | Typed React hooks generated from the spec via Orval |
| `e2e` | Playwright end-to-end tests |
| `scripts` | Seed scripts and one-off data operations |
| `reports` | Point-in-time records from past development sessions |

## Getting started

```sh
# pnpm is enforced — npm and yarn will refuse (preinstall guard in package.json)
pnpm install
```

Running the full stack locally requires three processes. See [`replit.md`](replit.md) for the complete local setup guide and [``.env.example``](.env.example) for all required environment variables.

```sh
# In one terminal — API server (port 8080)
pnpm --filter @workspace/api-server run dev

# In another terminal — frontend dev server (proxies /api to port 8080)
pnpm --filter @workspace/usmnt-tracker run dev
```

Other useful commands from the repo root:

```sh
pnpm run lint        # ESLint across all packages
pnpm run typecheck   # TypeScript across all packages
pnpm run build       # typecheck + build all packages
```

## Documentation

| Document | What it covers |
|---|---|
| [`replit.md`](replit.md) | Architecture, local setup, deployment, known gotchas |
| [`lib/db/README.md`](lib/db/README.md) | Schema conventions, migration workflow, production situation |
| [`threat_model.md`](threat_model.md) | Security architecture, rate limiters, CORS/CSP |
| [`reports/README.md`](reports/README.md) | What the `reports/` directory is and is not |

## Status and licence

Personal project, actively developed. MIT licensed — see [`LICENSE`](LICENSE).
