import app from "./app";
import { logger } from "./lib/logger";
import { startRssIngestionSchedule } from "./lib/rssIngest";
import { startApiFootballSyncSchedule } from "./lib/apiFootballSync";
// Sportmonks club-fixtures sync (./lib/sportmonksSync.ts) is implemented but
// intentionally not started — the user switched to API-Football instead.
// See replit.md and .agents/memory/usmnt-tracker.md.

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

  // API-Football sync (./lib/apiFootballSync.ts) is implemented but not
  // started: the free-plan key only covers 2022-2024 seasons (no current
  // fixtures) and the account was flagged/suspended mid-test. See replit.md.
});
