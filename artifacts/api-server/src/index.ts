import app from "./app";
import { logger } from "./lib/logger";
import { startRssIngestionSchedule } from "./lib/rssIngest";
import { startApiFootballSyncSchedule } from "./lib/apiFootballSync";
import { startPlayerClubSyncSchedule } from "./lib/playerClubSync";
import { startPlayerStatsSyncSchedule } from "./lib/playerStatsSync";
import { startNationalTeamSyncSchedule } from "./lib/nationalTeamSync";
import { startUsmntStatsSyncSchedule, syncUsmntStats } from "./lib/usmntSync";
import { db, fixturesTable, fixturePlayersTable, matchLogsTable } from "@workspace/db";
import { and, eq, gte, inArray, isNotNull, isNull, lte } from "drizzle-orm";
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

  // One-shot startup: backfill api_football_fixture_id on seeded national-team
  // fixtures that were created without one. Finds the correct ID from existing
  // national-team match logs within a ±7-day window of the fixture kickoff —
  // seeded dates can differ from API-Football's recorded date by a day or two.
  // Runs silently on every restart; no-ops when fixtures already have an ID.
  (async () => {
    try {
      const ntFixturesWithoutId = await db
        .select()
        .from(fixturesTable)
        .where(and(eq(fixturesTable.isNationalTeam, true), isNull(fixturesTable.apiFootballFixtureId)));

      for (const fixture of ntFixturesWithoutId) {
        const kickoffDate = new Date(fixture.kickoff);
        const sevenBefore = new Date(kickoffDate.getTime() - 7 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);
        const sevenAfter = new Date(kickoffDate.getTime() + 7 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);

        const logs = await db
          .select({ apiFootballFixtureId: matchLogsTable.apiFootballFixtureId })
          .from(matchLogsTable)
          .where(
            and(
              eq(matchLogsTable.isNationalTeam, true),
              gte(matchLogsTable.date, sevenBefore),
              lte(matchLogsTable.date, sevenAfter),
            ),
          );

        // Tally fixture IDs from the logs — should all agree for one match
        const counts = new Map<number, number>();
        for (const l of logs) {
          if (l.apiFootballFixtureId != null) {
            counts.set(l.apiFootballFixtureId, (counts.get(l.apiFootballFixtureId) ?? 0) + 1);
          }
        }
        if (counts.size === 0) continue; // Future fixture — no logs yet

        const bestId = [...counts.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
        await db
          .update(fixturesTable)
          .set({ apiFootballFixtureId: bestId })
          .where(eq(fixturesTable.id, fixture.id));
        logger.info(
          { fixtureId: fixture.id, apiFootballFixtureId: bestId },
          "Startup: backfilled api_football_fixture_id for seeded national-team fixture",
        );
      }
    } catch (err) {
      logger.warn({ err }, "Startup: NT fixture ID backfill failed (non-fatal)");
    }
  })();

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
