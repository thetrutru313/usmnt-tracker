---
name: lib/db composite build staleness after schema edits
description: Cross-package typecheck/tests silently use stale column types after editing lib/db/src/schema/*.ts, because api-server consumes lib/db/dist/*.d.ts, not live source.
---

After editing a Drizzle schema file in `lib/db/src/schema/`, api-server's typecheck (and anything that imports `@workspace/db`) keeps seeing the *old* shape until `lib/db` is rebuilt.

**Why:** `lib/db` is a TS project-reference composite build; api-server's `tsconfig.json` references consume `lib/db/dist/*.d.ts`, not the source `.ts` files. Editing schema.ts alone does not trigger a rebuild.

**How to apply:** after any `lib/db/src/schema/**` edit, run `pnpm --filter @workspace/db run build` (or `tsc -b --force` inside `lib/db`) before trusting `pnpm --filter @workspace/api-server run typecheck`. Also remember: a generated Drizzle migration only edits the migration journal/SQL files — it does not touch the dev DB. Run `npx drizzle-kit migrate --config ./drizzle.config.ts` (from `lib/db`) afterward, or integration tests that insert/select the new columns will fail with `column "..." does not exist` even though typecheck passes.
