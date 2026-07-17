import app from "./app";
import { logger } from "./lib/logger";
import { startRssIngestionSchedule } from "./lib/rssIngest";
import { startApiFootballSyncSchedule } from "./lib/apiFootballSync";
import { startPlayerClubSyncSchedule } from "./lib/playerClubSync";
import { startPlayerStatsSyncSchedule } from "./lib/playerStatsSync";
import { startNationalTeamSyncSchedule } from "./lib/nationalTeamSync";
import { startUsmntStatsSyncSchedule, syncUsmntStats } from "./lib/usmntSync";
import { db, fixturesTable, fixturePlayersTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

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

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // One-time cleanup: remove speculative "International Friendly" placeholder
  // fixtures (USA vs Panama, USA vs Colombia) that were seeded during initial
  // development but are not real, publicly announced matches.  DELETE is
  // idempotent — zero rows affected once already cleaned up.
  try {
    const phantoms = await db
      .select({ id: fixturesTable.id })
      .from(fixturesTable)
      .where(
        and(
          eq(fixturesTable.homeTeam, "USA"),
          eq(fixturesTable.competition, "International Friendly"),
          eq(fixturesTable.status, "scheduled"),
          inArray(fixturesTable.awayTeam, ["Panama", "Colombia"]),
        ),
      );
    if (phantoms.length > 0) {
      const ids = phantoms.map((r) => r.id);
      await db.delete(fixturePlayersTable).where(inArray(fixturePlayersTable.fixtureId, ids));
      await db.delete(fixturesTable).where(inArray(fixturesTable.id, ids));
      logger.info({ removed: ids.length, fixtureIds: ids }, "Removed phantom seeded International Friendly fixtures");
    }
  } catch (cleanupErr) {
    logger.warn({ err: cleanupErr }, "Phantom fixture cleanup failed — will retry on next restart");
  }

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

  // Live-syncs real club season stats, match logs (last 5 finished matches
  // per club), and injuries from API-Football, replacing the old seed's
  // fabricated data entirely. Runs daily — see playerStatsSync.ts for the
  // call-volume/rate-limit reasoning. Skips itself if API_FOOTBALL_KEY isn't set.
  //
  // The USMNT sync is chained as an afterSync callback so it always runs after
  // all player IDs are resolved and club stats are committed — running them
  // concurrently starved the USMNT sync of rate-limit quota and left it unable
  // to complete before the next server restart.
  startPlayerStatsSyncSchedule(undefined, () => syncUsmntStats().then(() => {}));

  // Also keeps an independent hourly poll so a newly-finished USMNT match
  // shows up promptly — not just on the next daily club-sync cycle.
  startUsmntStatsSyncSchedule();

  // Syncs senior USMNT caps/goals from Wikidata daily. Separate from both
  // pipelines above since API-Football doesn't reliably cover international
  // career totals — see nationalTeamSync.ts for why Wikidata was chosen over
  // ESPN's site API. No API key needed.
  startNationalTeamSyncSchedule();
});
