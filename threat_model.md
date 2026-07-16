# Threat Model

## Project Overview

USMNT Tracker is a Node.js/Express 5 + TypeScript application that tracks US Men's National Team soccer players — news, fixtures, stats, injuries, transfers, and prospect rankings. The backend is a single Express API server with a PostgreSQL database (Drizzle ORM). The frontend is a React SPA. Data is a hybrid: seeded/fabricated for some entities, live for news (RSS) and club fixtures/stats (API-Football). The app is not currently deployed to production (isDeployed: false).

**Stack:** Node.js 24, TypeScript 5.9, Express 5, PostgreSQL + Drizzle ORM, Zod validation, esbuild, pnpm workspaces.

## Assets

- **Admin API token** — `SESSION_SECRET` environment variable used to gate `/admin/*` endpoints. Compromise allows an attacker to trigger expensive syncs, promote prospect candidates into the player pool, or backfill DOB data using API-Football quota.
- **API-Football key** — `API_FOOTBALL_KEY` env var. Compromise burns paid API quota and leaks the subscription key.
- **Database** — PostgreSQL accessed via `DATABASE_URL`. Contains all player, club, fixture, injury, transfer, and news data. Compromise allows arbitrary data read/write.
- **News content** — RSS-ingested headlines. Low sensitivity individually, but injection into the DB could surface misleading content.

## Trust Boundaries

- **Browser to API** — All public routes (`/api/players`, `/api/search`, `/api/news`, etc.) are open to the internet with no authentication. The client is untrusted.
- **Admin boundary** — `/api/admin/*` routes require `Authorization: Bearer <SESSION_SECRET>`. This is the only privileged boundary. Enforced server-side.
- **API to PostgreSQL** — All queries go through Drizzle ORM with parameterized statements. Direct DB access is not exposed to users.
- **API to API-Football** — Server-to-server calls using the `API_FOOTBALL_KEY` secret. No user input directly controls URLs except the admin endpoints.
- **API to RSS feeds** — Server fetches hardcoded RSS URLs; no user-controlled URL is fetched server-side.

## Scan Anchors

- **Production entry point:** `artifacts/api-server/src/index.ts` → `app.ts` → `routes/index.ts`
- **Highest-risk code:** `artifacts/api-server/src/routes/admin.ts` (privileged operations), `artifacts/api-server/src/lib/rssIngest.ts` (external HTTP fetch + DB write), `artifacts/api-server/src/app.ts` (CORS/middleware config)
- **Public surfaces:** All `/api/*` routes except `/api/admin/*`
- **Admin surface:** `/api/admin/*` — gated by `SESSION_SECRET` bearer token
- **Dev-only:** `artifacts/mockup-sandbox/` — Replit design canvas, not production-reachable

## Threat Categories

### Spoofing

Admin routes are protected by a bearer token (`SESSION_SECRET`). The comparison uses JavaScript string equality (`!==`) rather than constant-time comparison, making it theoretically susceptible to timing attacks. In practice, the risk is limited because HTTP response-time jitter dwarfs string-comparison timing on short secrets; however, a constant-time comparison is the correct pattern.

### Tampering

All database writes are through Drizzle ORM with parameterized queries — no raw SQL string concatenation detected. The search `ilike` query parameterizes the user-supplied string. No client-side-only price or authorization enforcement found (the app has no e-commerce or payment flow).

### Information Disclosure

The admin `/promote` endpoint returns raw database error messages in a `detail` field when a conflict occurs (e.g., duplicate slug or API ID). Since this endpoint is behind auth, impact is bounded to the token holder. CORS is configured with `cors()` and no options, allowing any origin — credentialed cross-origin requests from any domain are possible if session cookies were ever introduced.

### Denial of Service

No rate limiting is applied to any endpoint. The `/api/search` endpoint performs two `ilike` (pattern-matching) database queries on every request with no query length cap. An attacker can send arbitrarily long queries or high request volumes to stress the database. Admin trigger endpoints (sync operations) are gated by token, limiting amplification.

### Elevation of Privilege

No injection vulnerabilities detected (all DB queries parameterized). No path traversal vectors found. Admin routes correctly apply the `requireAdminToken` middleware before handler logic via `router.use("/admin", requireAdminToken)`.
