import app from "./app";
import { logger } from "./lib/logger";
import { startRssIngestionSchedule } from "./lib/rssIngest";
import { startSportmonksSyncSchedule } from "./lib/sportmonksSync";

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
  // Sportmonks (hourly). Skips itself if SPORTMONKS_API_TOKEN isn't set.
  // National-team fixtures stay seeded/curated.
  startSportmonksSyncSchedule();
});
