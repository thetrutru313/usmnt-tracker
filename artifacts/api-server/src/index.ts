import app from "./app";
import { logger } from "./lib/logger";
import { startRssIngestionSchedule } from "./lib/rssIngest";
import { startApiFootballSyncSchedule } from "./lib/apiFootballSync";
import { startPlayerClubSyncSchedule } from "./lib/playerClubSync";
import { startPlayerStatsSyncSchedule } from "./lib/playerStatsSync";
import { startNationalTeamSyncSchedule } from "./lib/nationalTeamSync";
import { startUsmntStatsSyncSchedule, syncUsmntStats } from "./lib/usmntSync";
import { db, fixturesTable, fixturePlayersTable, matchLogsTable, playerStatsTable, injuriesTable, transfersTable, playersTable } from "@workspace/db";
import { and, eq, gte, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { pickBestNtFixtureId } from "./lib/pickBestNtFixtureId.js";
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
        const kickoffMs = new Date(fixture.kickoff).getTime();
        const sevenBefore = new Date(kickoffMs - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const sevenAfter  = new Date(kickoffMs + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        // Only consult players explicitly linked to this fixture — prevents
        // ambiguity when two NT matches fall in the same ±7-day window.
        const linked = await db
          .select({ playerId: fixturePlayersTable.playerId })
          .from(fixturePlayersTable)
          .where(eq(fixturePlayersTable.fixtureId, fixture.id));

        const linkedIds = linked.map((r) => r.playerId);
        if (linkedIds.length === 0) continue; // No tracked players for this fixture

        const candidates = await db
          .select({
            apiFootballFixtureId: matchLogsTable.apiFootballFixtureId,
            date: matchLogsTable.date,
          })
          .from(matchLogsTable)
          .where(
            and(
              inArray(matchLogsTable.playerId, linkedIds),
              eq(matchLogsTable.isNationalTeam, true),
              gte(matchLogsTable.date, sevenBefore),
              lte(matchLogsTable.date, sevenAfter),
              isNotNull(matchLogsTable.apiFootballFixtureId),
            ),
          ) as { apiFootballFixtureId: number; date: string }[];

        const bestId = pickBestNtFixtureId(candidates, kickoffMs);
        if (bestId == null) continue; // Future fixture — no logs yet

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

  // One-shot startup: remove Obed Vargas from all tables. He committed to the
  // Mexican national team and is no longer a USMNT prospect. Safe to re-run —
  // no-ops once the player row is gone.
  (async () => {
    try {
      const rows = await db
        .select({ id: playersTable.id })
        .from(playersTable)
        .where(eq(playersTable.slug, "obed-vargas"));
      if (rows.length === 0) return; // Already removed
      const playerId = rows[0]!.id;
      await db.delete(matchLogsTable).where(eq(matchLogsTable.playerId, playerId));
      await db.delete(playerStatsTable).where(eq(playerStatsTable.playerId, playerId));
      await db.delete(injuriesTable).where(eq(injuriesTable.playerId, playerId));
      await db.delete(transfersTable).where(eq(transfersTable.playerId, playerId));
      await db.delete(fixturePlayersTable).where(eq(fixturePlayersTable.playerId, playerId));
      await db.delete(playersTable).where(eq(playersTable.id, playerId));
      logger.info({ playerId }, "Startup: removed Obed Vargas (committed to Mexico)");
    } catch (err) {
      logger.warn({ err }, "Startup: Obed Vargas removal failed (non-fatal)");
    }
  })();

  // One-time startup: remove phantom CONCACAF Nations League fixtures (USA vs
  // Jamaica, USA vs Trinidad and Tobago) that were seeded as speculative entries.
  // They don't correspond to real, announced matches. Idempotent — no-ops once
  // the rows are gone. The syncNationalTeamFixtures() guard prevents recurrence.
  (async () => {
    try {
      const phantomRows = await db
        .select({ id: fixturesTable.id })
        .from(fixturesTable)
        .where(
          and(
            eq(fixturesTable.homeTeam, "USA"),
            eq(fixturesTable.competition, "CONCACAF Nations League"),
            eq(fixturesTable.status, "scheduled"),
            isNull(fixturesTable.apiFootballFixtureId),
            inArray(fixturesTable.awayTeam, ["Jamaica", "Trinidad and Tobago"]),
          ),
        );
      if (phantomRows.length === 0) return;
      const ids = phantomRows.map((r) => r.id);
      await db.delete(fixturePlayersTable).where(inArray(fixturePlayersTable.fixtureId, ids));
      await db.delete(fixturesTable).where(inArray(fixturesTable.id, ids));
      logger.info({ removedIds: ids }, "Startup: removed phantom CONCACAF Nations League fixtures (Jamaica / T&T)");
    } catch (err) {
      logger.warn({ err }, "Startup: phantom Nations League fixture cleanup failed (non-fatal)");
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
