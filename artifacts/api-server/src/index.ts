import app from "./app";
import { logger } from "./lib/logger";
import { startRssIngestionSchedule } from "./lib/rssIngest";
import { startApiFootballSyncSchedule } from "./lib/apiFootballSync";
import { startPlayerClubSyncSchedule } from "./lib/playerClubSync";
// Sportmonks club-fixtures sync (./lib/sportmonksSync.ts) is implemented but
// intentionally not started — the user upgraded API-Football instead, which
// is now live. See replit.md and .agents/memory/usmnt-tracker.md.

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Free/RSS half of the hybrid live-data pipeline: pulls real USMNT-relevant
  // headlines from public RSS feeds on a recurring schedule. Fixtures/stats
  // still rely on seeded data pending a paid provider decision (see replit.md).
  startRssIngestionSchedule();

  // Paid half of the hybrid pipeline: syncs upcoming club fixtures from
  // API-Football (hourly). Skips itself if API_FOOTBALL_KEY isn't set.
  // National-team fixtures stay seeded/curated.
  startApiFootballSyncSchedule();

  // Keeps each player's club assignment current by checking API-Football's
  // transfer history daily, instead of relying on one-off manual audits.
  // Skips itself if API_FOOTBALL_KEY isn't set.
  startPlayerClubSyncSchedule();
});
