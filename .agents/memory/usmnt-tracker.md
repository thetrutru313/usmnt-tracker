---
name: USMNT Tracker data model
description: Conventions used for the USMNT Tracker artifact (players/clubs/fixtures/news/injuries/transfers) — useful for future work on this or similar seeded sports-data apps in this monorepo.
---

The USMNT Tracker artifact (`artifacts/usmnt-tracker` + shared `@workspace/api-server`/`@workspace/db`) uses realistic **seeded** data rather than live feeds/scraping/AI summarization — those were explicitly deferred (admin panel, notifications, live RSS ingestion, call-up predictor are natural follow-ups, not yet built).

Drizzle timestamp columns (default mode, not `{ mode: "string" }`) require JS `Date` objects on insert, not ISO strings — passing a string throws `value.toISOString is not a function` deep in drizzle's query builder. Only `date` columns declared with `{ mode: "string" }` accept plain date strings.

**Why:** easy to mix up since some schema fields (e.g. `contractUntil`, `debutDate`, `startDate`) intentionally use string-mode `date` columns while others (`kickoff`, `publishedAt`, `announcedAt`) are full `timestamp` columns — inconsistent value types across a single seed script silently type-check (drizzle doesn't statically enforce it well) but fail at runtime.

**How to apply:** when writing seed/insert scripts, check the column definition's `mode` before deciding whether to pass a `Date` object or an ISO date string. Also make seed scripts idempotent — `TRUNCATE ... RESTART IDENTITY CASCADE` at the top — since seeding a monorepo db can fail partway through (e.g. from the above pitfall) and a rerun otherwise hits unique-constraint errors on the already-inserted rows.
