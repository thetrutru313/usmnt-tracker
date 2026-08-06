# Six Independent Fixes — Results
_Generated: 2026-08-06_

---

## Fix 1 — `require()` inside an ES module

**File:** `artifacts/api-server/src/lib/apiFootballSync.ts`

Found **three** `require()` calls in the file, not one:

| Line | Target | Action |
|---|---|---|
| 1516, 2198 | `./playerStatsSync` | **Left as-is** — `playerStatsSync.ts` imports from `apiFootballSync.ts` (line 4), creating a genuine bidirectional cycle. The lazy `require()` is the intentional cycle-breaker and must stay. |
| 2222 | `./syncGuard` | **Converted** — `syncGuard.ts` imports only from `@workspace/db` and `./logger`; no cycle exists. Safe to replace. |

**Changes made:**
- Added `import { claimSyncRun } from "./syncGuard.js";` to the top-level static imports
- Removed the inline `// eslint-disable-next-line @typescript-eslint/no-require-imports` comment and the `require("./syncGuard")` call at the original call site (line 2222)

---

## Fix 2 — Unbounded list endpoints

**Files:** `lib/api-spec/openapi.yaml`, `lib/api-zod/` (generated), `lib/api-client-react/` (generated), `artifacts/api-server/src/routes/news.ts`, `routes/injuries.ts`, `routes/transfers.ts`

**OpenAPI spec changes (`openapi.yaml`):**

| Endpoint | Change |
|---|---|
| `GET /news` | Added `default: 50` and `maximum: 200` to the existing `limit` parameter |
| `GET /injuries` | Added new `limit` parameter with `default: 50` and `maximum: 200` |
| `GET /transfers` | Added new `limit` parameter with `default: 50` and `maximum: 200` |

Ran `pnpm --filter @workspace/api-spec run codegen` — regenerated output updated all three Zod schemas:
- `ListNewsQueryParams.limit` → `zod.coerce.number().max(200).default(50)`
- `ListInjuriesQueryParams.limit` → `zod.coerce.number().max(200).default(50)`
- `ListTransfersQueryParams.limit` → `zod.coerce.number().max(200).default(50)`

**Route changes:**

- `routes/news.ts` — removed `if (limit)` guard; `limit` always carries a value (default 50) so the conditional was dead code
- `routes/injuries.ts` — added `limit` to destructure; applied `.limit(limit)` to the base query before the optional `status` filter
- `routes/transfers.ts` — same pattern as injuries

---

## Fix 3 — Missing database indexes

**Files:** `lib/db/src/schema/stats.ts`, `injuries.ts`, `fixtures.ts`, `players.ts`, `news.ts`

Added indexes following the existing style in `fixture_players` (`index("name").on(table.column)`):

| Schema file | New index name | Column |
|---|---|---|
| `stats.ts` | `player_stats_player_id_idx` | `player_id` |
| `injuries.ts` | `injuries_player_id_idx` | `player_id` |
| `fixtures.ts` | `fixtures_kickoff_idx` | `kickoff` |
| `players.ts` | `players_club_id_idx` | `club_id` |
| `news.ts` | `news_article_players_article_id_idx` | `article_id` |
| `news.ts` | `news_article_players_player_id_idx` | `player_id` |

Three schema files (`injuries.ts`, `players.ts`, `news.ts`) also needed `index` added to their `drizzle-orm/pg-core` import.

**Migration generated (not applied):**

```
lib/db/drizzle/0006_lazy_timeslip.sql
lib/db/drizzle/meta/0006_snapshot.json
```

Drizzle confirmed 21 tables with all new indexes reflected. Schema deployment is left to a separate prompt as instructed.

---

## Fix 4 — Insecure RSS feed URL

**File:** `artifacts/api-server/src/lib/rssIngest.ts` line 12

```diff
-  { url: "http://feeds.bbci.co.uk/sport/football/rss.xml", source: "BBC Sport" },
+  { url: "https://feeds.bbci.co.uk/sport/football/rss.xml", source: "BBC Sport" },
```

BBC Sport's RSS feed has served over HTTPS for years; the `rss-parser` library follows the redirect but enforcing HTTPS at the source eliminates the plaintext hop entirely.

---

## Fix 5 — Silently skipped WebKit tests

**File:** `e2e/playwright.config.ts`

Replaced the silent spread `...(webkitExecutable ? [...] : [])` with an IIFE that emits a `console.warn` when no binary is found:

```ts
...(() => {
  if (webkitExecutable) {
    return [{ name: "webkit", use: { ...devices["Desktop Safari"], ... } }];
  }
  console.warn(
    "[playwright.config] WebKit binary not found — " +
      "star-toggle-private-mode.spec.ts will NOT run in this environment. " +
      "Set PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH to a headless WebKit binary to activate.",
  );
  return [];
})(),
```

The warning names the spec explicitly so it is visible in CI output rather than silently absent from the project list.

---

## Fix 7 — Frontend build outside a Replit service

**Files:** `artifacts/usmnt-tracker/vite.config.ts`, `artifacts/mockup-sandbox/vite.config.ts`

Both configs previously threw at config-load time if `PORT` or `BASE_PATH` were unset, which broke `pnpm run build` from any plain shell. Replaced the throws with logged fallbacks:

| Config | PORT default | BASE_PATH default |
|---|---|---|
| `usmnt-tracker/vite.config.ts` | `5173` | `/` |
| `mockup-sandbox/vite.config.ts` | `8081` | `/__mockup` |

When the env var is present it is used and logged. When absent the default is used and logged. The Replit workflow continues to inject its own values via `artifact.toml` — no behaviour change in the service context.

Confirmed: `pnpm run build` now succeeds from a shell with no env vars set.

---

## Fix 6 — Unused dependencies and phantom workspace path

All three confirmed unused via repo-wide `grep` before removal:

| Item | Location | Verified by |
|---|---|---|
| `@replit/connectors-sdk` | root `package.json` | Zero matches in `artifacts/` `lib/` `scripts/` source |
| `cookie-parser` + `@types/cookie-parser` | `artifacts/api-server/package.json` | Zero matches in `artifacts/api-server/src/` |
| `lib/integrations/*` glob | `pnpm-workspace.yaml` | `ls lib/integrations` → "No such file or directory" |

Ran `pnpm install --no-frozen-lockfile` to drop the four removed packages from the lockfile (`-4` packages reported).

---

## Verification

| Check | Result |
|---|---|
| `pnpm run typecheck` | ✅ all 4 packages (api-server, usmnt-tracker, mockup-sandbox, scripts) — clean |
| `pnpm run build` | ✅ usmnt-tracker built; PWA precache 46 entries (1 286 KiB) |
| `pnpm --filter @workspace/api-server run test` | ✅ 84 test files, 712 / 712 tests passed |
| `bash scripts/check-codegen-drift.sh` | ✅ "Generated files are in sync with the spec" |
