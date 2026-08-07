# Threat Model

**Last verified:** August 7, 2026

## Project Overview

USMNT Tracker is a Node.js/Express 5 + TypeScript application that tracks US Men's National Team soccer players — news, fixtures, stats, injuries, transfers, and prospect rankings. The backend is a single Express API server with a PostgreSQL database (Drizzle ORM). The frontend is a React SPA served as a static artifact. Data is a hybrid: seeded for some entities, live for news (RSS), club fixtures/stats and player-club assignments (API-Football).

**Deployed:** Autoscale on Replit at `https://usmnt-tracker.replit.app`  
**Stack:** Node.js 24, TypeScript 5.9, Express 5, PostgreSQL + Drizzle ORM, Zod validation, esbuild, pnpm workspaces.

---

## Assets

- **ADMIN_PASSWORD** — The credential accepted once at `POST /api/admin/transparency/verify`. A successful login issues a UUID session token; only its SHA-256 hash is stored in `admin_sessions`. Compromise of this variable allows an attacker to trigger expensive syncs, promote prospect candidates into the player pool, or burn API-Football quota.
- **Admin session tokens** — Short-lived UUID tokens (SHA-256-hashed, stored in `admin_sessions`, expirable and individually revocable) issued after a successful ADMIN_PASSWORD login. `requireAdminSession` looks up the hash on every protected request. Compromise of a live token has the same blast radius as ADMIN_PASSWORD, but tokens expire and can be revoked without a password change.
- **API_FOOTBALL_KEY** — Paid API-Football subscription key (`API_FOOTBALL_KEY` env var). Compromise burns paid quota and leaks the subscription key.
- **Database** — PostgreSQL accessed via `DATABASE_URL`. Contains all player, club, fixture, injury, transfer, transparency, and news data. Compromise allows arbitrary data read/write.
- **Invoice uploads** — Private GCS objects in the transparency bucket. Public by design (transparency invoices are intentionally readable), but access is gated through a path-validation allowlist before a signed URL is issued — see Information Disclosure below.
- **Anonymous user tokens** — Per-device follow tokens, stored SHA-256-hashed in `anon_users`. Compromise lets an attacker spoof another device's follow list. Recovery tokens are also stored hashed, never in plaintext.

---

## Trust Boundaries

- **Browser to API** — All public routes (`/api/players`, `/api/search`, `/api/news`, `/api/fixtures`, `/api/transparency`, etc.) are open to the internet with no authentication. The client is untrusted. CORS is enforced by an explicit origin allowlist — not a wildcard.
- **Admin boundary** — `/api/admin/*` routes require `Authorization: Bearer <session-token>`. Enforced at the router level by `requireAdminSession` in `lib/adminAuth.ts`. The login endpoint (`POST /api/admin/transparency/verify`) is the only place that accepts ADMIN_PASSWORD.
- **Invoice download** — `GET /api/transparency/invoice/*` is public (invoices are intentionally visible to anyone). The requested object path is validated against `transparency_months.invoice_urls` before a signed download URL is issued. An unvalidated version would allow any caller to obtain a signed URL for any private bucket object by guessing its GCS path.
- **API to PostgreSQL** — All queries go through Drizzle ORM with parameterized statements. No raw SQL string concatenation.
- **API to API-Football / RSS** — Server-to-server calls using `API_FOOTBALL_KEY`. No user-supplied input directly controls the outbound URLs except on admin-gated trigger endpoints.
- **Browser to GCS (invoice upload)** — Browsers PUT directly to a pre-signed GCS URL. The API server generates and validates the presigned URL; browsers never see a GCS credential.

---

## Scan Anchors

- **Production entry point:** `artifacts/api-server/src/index.ts` → `app.ts` → `routes/index.ts`
- **Highest-risk code:**
  - `artifacts/api-server/src/routes/transparency.ts` — admin login, session management, invoice path validation, presigned URL generation
  - `artifacts/api-server/src/lib/adminAuth.ts` — `requireAdminSession` middleware, session token lookup
  - `artifacts/api-server/src/app.ts` — CORS allowlist, rate limiters, Helmet/CSP configuration
  - `artifacts/api-server/src/lib/rssIngest.ts` — external HTTP fetch + DB write
- **Public surfaces:** All `/api/*` routes except `/api/admin/*`
- **Admin surface:** `/api/admin/*` — gated by `requireAdminSession` (session token via `Authorization: Bearer`)
- **Dev-only:** `artifacts/mockup-sandbox/` — Replit design canvas, not production-reachable

---

## Threat Categories

### Spoofing

Admin authentication uses server-side sessions, not a raw bearer secret:

1. `POST /api/admin/transparency/verify` accepts `Authorization: Bearer <ADMIN_PASSWORD>`. The password is compared using **`timingSafeEqual`** (constant-time, from Node's `node:crypto`) to resist timing side-channel attacks. On success, a UUID token is generated via `generateToken()`, its SHA-256 hash stored in `admin_sessions` with an expiry, and the plaintext returned once to the caller.
2. All subsequent admin requests present the UUID token as `Authorization: Bearer <token>`. `requireAdminSession` hashes it and queries `admin_sessions`, rejecting any row that is expired or has a non-null `revokedAt`.
3. Sessions can be individually revoked without a password change. `POST /api/admin/logout` revokes the calling session.

The login endpoint is additionally rate-limited to **5 requests per 15 minutes per IP**, making brute-force impractical.

Anonymous user tokens and follow-recovery tokens are stored SHA-256-hashed in the database, never in plaintext.

### Tampering

All database writes use Drizzle ORM with parameterized queries — no raw SQL string concatenation detected in production paths. The search `ilike` query parameterizes the user-supplied string; query length is also capped at 100 characters at the route level. No client-side-only price or authorization enforcement found (the app has no payment flow).

### Information Disclosure

**CORS:** Origin allowlist built dynamically in `app.ts` from:
- `ALLOWED_ORIGINS` env var (comma-separated exact origins)
- `REPLIT_DEV_DOMAIN` (Replit workspace dev domain, auto-injected)
- `REPLIT_DOMAINS` (Replit deployment domains, auto-injected)
- Any `http://localhost:*` origin when `NODE_ENV !== "production"` (dev only — localhost is unreachable from the internet)

No wildcard (`*`) is used. Requests with no `Origin` header (server-to-server) are allowed unconditionally.

**CSP:** The API server emits a maximally restrictive policy (`default-src 'none'; frame-ancestors 'none'; form-action 'self'`) via Helmet — correct for a JSON-only API that is never rendered in a browser. The frontend HTML carries a separate `<meta http-equiv="Content-Security-Policy">` tag with:
```
connect-src 'self' https://storage.googleapis.com/<bucket-id>/
```
This exception is scoped to this project's GCS bucket only, because invoice uploads PUT directly from the browser to GCS via a presigned URL. **If uploads are ever proxied through the API server, this `connect-src` exception becomes removable** — the PUT would originate from the server, and the frontend's GCS URL knowledge disappears entirely.

**Invoice download path validation:** `GET /api/transparency/invoice/*` checks the requested path against the `invoice_urls` JSONB column on `transparency_months` before issuing a signed download URL (via `JSONB @>` containment). Before this check existed, an unauthenticated caller who knew or could guess any internal GCS object path could obtain a valid signed URL for it — a signed-URL bypass over the entire private bucket. The current code returns 404 for any path not registered as a transparency invoice.

**Other headers:** HSTS (max-age 2 years, `includeSubDomains`, `preload`) in production. `X-Frame-Options: DENY`. `Referrer-Policy: strict-origin-when-cross-origin` (internal API paths not leaked to external CDNs). `X-Content-Type-Options: nosniff`. `Cross-Origin-Resource-Policy: cross-origin` (intentional — the API is consumed cross-origin by the frontend SPA).

### Denial of Service

Four rate limiters are in place, all using real client IPs via `trust proxy: 1`:

| Limiter | Route | Limit |
|---|---|---|
| Global | All routes | 300 requests / minute / IP |
| Search | `GET /api/search` | 60 requests / minute / IP |
| Anonymous user provisioning | `POST /api/follows/users` | 5 requests / 15 minutes / IP |
| Admin login | `POST /api/admin/transparency/verify` | 5 requests / 15 minutes / IP |

Search queries are also capped at 100 characters (validated in the route handler before the DB query runs). Admin sync trigger endpoints are gated by `requireAdminSession`, limiting amplification from unauthenticated callers.

### Elevation of Privilege

No injection vulnerabilities detected (all DB queries parameterized). No path traversal vectors found. `requireAdminSession` is applied at the router level (`router.use("/admin", requireAdminSession)`) in `routes/admin.ts`, and individually on protected routes in `routes/transparency.ts` and `routes/storage.ts` — handlers cannot be registered before the middleware at the route level.
