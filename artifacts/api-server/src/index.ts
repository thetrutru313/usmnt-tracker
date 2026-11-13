import app from "./app";
import { logger } from "./lib/logger";
import { startRssIngestionSchedule } from "./lib/rssIngest";
import { startApiFootballSyncSchedule } from "./lib/apiFootballSync";
import { startAnonUserCleanupSchedule } from "./lib/anonUserCleanup";
import { startUsmntStatsSyncSchedule, promoteNtSentinelIds } from "./lib/usmntSync";
import { checkAndApplyWeightDrift } from "./lib/playerDiscovery";
import { startScheduledJobs } from "./lib/scheduledJobs";
import { refreshLeagueBroadcasts, seedLeagueBroadcastDefaults, startLeagueBroadcastRefresh } from "./lib/broadcasts";
import { seedLeagueStrengthDefaults } from "./lib/qualityScore";
import { installUnhandledRejectionLogger, runNonFatal } from "./lib/startupGuards";
import { db } from "@workspace/db";
import { seedSeniorSentinelFixtures, seedYouthNtBootstrapFixtures } from "./lib/ntFixtureSeeds";
import { applyDataMigrations } from "./lib/dataMigrations";

// Log stray promise rejections instead of letting one stop the server.
installUnhandledRejectionLogger();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ── Critical startup seeds ────────────────────────────────────────────────────
// These database corrections MUST complete before the server starts accepting
// requests. Running them after `app.listen()` would allow `/api/schedule` and
// `/api/dashboard` to return stale data (e.g. wrong date windows or missing
// fixture rows) during the first few seconds of each deployment/restart.
//
// Non-critical background tasks (NT fixture ID backfill, youth fixture seed,
// etc.) are launched as fire-and-forget blocks inside the listen callback; only
// the friendly fixture seeding requires this ordering guarantee.
// Record data changes before canonical fixture corrections, but never block startup on failure.
await runNonFatal("applyDataMigrations", () => applyDataMigrations(db));
// Run critical seeds synchronously before the server begins accepting requests.
await seedSeniorSentinelFixtures(db);

// Seed league_strength defaults (insert-if-missing — never overwrites a
// hand-tuned coefficient). Cheap and idempotent; safe to run every boot.
// Non-fatal: the defaults are already in every existing database, so a
// failure here (e.g. a dropped connection) must not stop the server.
await runNonFatal("seedLeagueStrengthDefaults", seedLeagueStrengthDefaults);

// League TV / streaming table: seeded once when empty, then loaded so the
// fixture syncs use the admin page's values. Non-fatal: the built-in defaults
// stay in use if either step fails.
await runNonFatal("seedLeagueBroadcastDefaults", seedLeagueBroadcastDefaults);
await runNonFatal("refreshLeagueBroadcasts", refreshLeagueBroadcasts);

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // One-shot startup: re-score all candidates if eligibility weights have changed
  // since the last server start. Uses stored signals — no API calls required.
  // Runs before any sync schedules so the candidate queue is consistent from
  // the first moment the server is live.
  void runNonFatal("checkAndApplyWeightDrift", checkAndApplyWeightDrift);

  // Block D — NT fixture ID backfill (belt-and-braces startup call).
  // The primary path is now promoteNtSentinelIds() running hourly inside
  // startUsmntStatsSyncSchedule(). Running both is harmless — the function is
  // idempotent — and ensures promotion still happens promptly after a deploy
  // rather than waiting up to an hour for the first scheduled tick.
  //
  // Keep until the new November sentinels -2005 and -2006 have positive
  // api_football_fixture_id values. The played Sept/Oct friendlies no longer
  // determine when this backfill can be retired. When both legs bind,
  // promoteNtSentinelIds() can also be removed from the schedule in
  // startUsmntStatsSyncSchedule().
  void runNonFatal("promoteNtSentinelIds", promoteNtSentinelIds);

  void seedYouthNtBootstrapFixtures(db);

  // Free/RSS half of the hybrid live-data pipeline: pulls real USMNT-relevant
  // headlines from public RSS feeds on a recurring schedule. Fixtures/stats
  // still rely on seeded data pending a paid provider decision (see replit.md).
  startRssIngestionSchedule();

  // Paid half of the hybrid pipeline: syncs upcoming club fixtures from
  // API-Football (hourly). Skips itself if API_FOOTBALL_KEY isn't set.
  // National-team fixtures stay seeded/curated.
  startApiFootballSyncSchedule();

  // Also keeps an independent hourly poll so a newly-finished USMNT match
  // shows up promptly — not just on the next daily club-sync cycle.
  startUsmntStatsSyncSchedule();

  // Removes orphaned anon_user rows (no follows, older than 90 days) once per
  // day. Runs immediately on server boot, then every 24 hours — mirrors what
  // POST /admin/cleanup-anon-users does but without requiring a manual trigger.
  startAnonUserCleanupSchedule();

  // Daily club, stats and caps syncs and the weekly candidate rescore. Run
  // when due (see scheduledJobs.ts) by the 5-minute cron tick and by a
  // 30-minute check here, instead of 24-hour timers that rarely fire on
  // Autoscale. Daily jobs run after 09:00 UTC; a run that dies is retried
  // after its run window rather than the next day. The daily stats job keeps
  // the old chain: club stats → USMNT stats → commitment sweep.
  startScheduledJobs();

  // Picks up league TV / streaming edits made on another instance.
  startLeagueBroadcastRefresh();
});
