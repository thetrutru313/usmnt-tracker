import app from "./app";
import { logger } from "./lib/logger";
import { startRssIngestionSchedule } from "./lib/rssIngest";
import { startApiFootballSyncSchedule } from "./lib/apiFootballSync";
import { startPlayerClubSyncSchedule } from "./lib/playerClubSync";
import { startPlayerStatsSyncSchedule } from "./lib/playerStatsSync";
import { startNationalTeamSyncSchedule } from "./lib/nationalTeamSync";
import { startAnonUserCleanupSchedule } from "./lib/anonUserCleanup";
import { startUsmntStatsSyncSchedule, syncUsmntStats } from "./lib/usmntSync";
import { rescoreAllCandidates } from "./lib/playerDiscovery";
import { db, fixturesTable, fixturePlayersTable, matchLogsTable, playerStatsTable, injuriesTable, transfersTable, playersTable } from "@workspace/db";
import { and, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
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

  // One-time startup: flag US men's national team fixtures (youth and senior)
  // as is_national_team = true. These rows arrive via the club fixture sync
  // with is_national_team = false because the upsert path hardcodes false;
  // that path is now fixed, but existing rows need a one-time correction.
  // Idempotent — no-ops once all rows are already flagged.
  (async () => {
    try {
      const result = await db.execute(sql`
        UPDATE fixtures
        SET is_national_team = true
        WHERE is_national_team = false
          AND (
            home_team = 'USA'
            OR home_team ~ '^(USA|United States) U[0-9]+'
            OR away_team = 'USA'
            OR away_team ~ '^(USA|United States) U[0-9]+'
          )
      `);
      const rowCount = (result as unknown as { rowCount?: number }).rowCount ?? 0;
      if (rowCount > 0) {
        logger.info({ rowCount }, "Startup: flagged US men's national team fixtures as is_national_team=true");
      }
    } catch (err) {
      logger.warn({ err }, "Startup: US national team fixture flag backfill failed (non-fatal)");
    }
  })();

  // One-time startup: backfill Fox One streaming info on existing CONCACAF U20
  // fixtures. New fixtures will get the value from BROADCAST_BY_LEAGUE during
  // sync; this covers the rows already in the DB. Idempotent.
  (async () => {
    try {
      const result = await db.execute(sql`
        UPDATE fixtures
        SET streaming_service = 'Fox One', tv_network = 'FOX Sports'
        WHERE competition = 'CONCACAF U20'
          AND (streaming_service IS NULL OR streaming_service != 'Fox One')
      `);
      const rowCount = (result as unknown as { rowCount?: number }).rowCount ?? 0;
      if (rowCount > 0) {
        logger.info({ rowCount }, "Startup: backfilled Fox One streaming info on CONCACAF U20 fixtures");
      }
    } catch (err) {
      logger.warn({ err }, "Startup: CONCACAF U20 streaming backfill failed (non-fatal)");
    }
  })();

  // One-time startup: backfill FIFA+ streaming info on existing U17 World Cup
  // fixtures. New fixtures will get the value from BROADCAST_BY_LEAGUE during
  // sync; this covers rows already in the DB. Idempotent.
  (async () => {
    try {
      const result = await db.execute(sql`
        UPDATE fixtures
        SET streaming_service = 'FIFA+'
        WHERE competition = 'World Cup - U17'
          AND (streaming_service IS NULL OR streaming_service != 'FIFA+')
      `);
      const rowCount = (result as unknown as { rowCount?: number }).rowCount ?? 0;
      if (rowCount > 0) {
        logger.info({ rowCount }, "Startup: backfilled FIFA+ streaming info on U17 World Cup fixtures");
      }
    } catch (err) {
      logger.warn({ err }, "Startup: U17 World Cup streaming backfill failed (non-fatal)");
    }
  })();

  // Startup seed: insert the 6 US U20 / US U17 fixtures if they are not already
  // present in this environment's database.  Dev and production use separate
  // Postgres instances; fixtures added to dev after the last production publish
  // won't exist in production until this block runs.  Idempotent — the
  // ON CONFLICT DO NOTHING clause makes repeated startups a no-op.
  (async () => {
    try {
      const result = await db.execute(sql`
        INSERT INTO fixtures (
          api_football_fixture_id,
          home_team, away_team,
          home_logo_url, away_logo_url,
          competition, kickoff, venue,
          tv_network, streaming_service,
          is_national_team, status
        ) VALUES
          -- CONCACAF U20 group stage (United States U20)
          (1544720, 'United States U20', 'Haiti U20',
           'https://media.api-sports.io/football/teams/10306.png',
           'https://media.api-sports.io/football/teams/11003.png',
           'CONCACAF U20', '2026-07-26 02:00:00+00', 'Estadio Universitario BUAP',
           'FOX Sports', 'Fox One', true, 'scheduled'),

          (1544726, 'El Salvador U20', 'United States U20',
           'https://media.api-sports.io/football/teams/10998.png',
           'https://media.api-sports.io/football/teams/10306.png',
           'CONCACAF U20', '2026-07-29 02:00:00+00', 'Estadio Universitario BUAP',
           'FOX Sports', 'Fox One', true, 'scheduled'),

          (1544732, 'United States U20', 'Cuba U20',
           'https://media.api-sports.io/football/teams/10306.png',
           'https://media.api-sports.io/football/teams/10994.png',
           'CONCACAF U20', '2026-08-01 02:00:00+00', 'Estadio Universitario BUAP',
           'FOX Sports', 'Fox One', true, 'scheduled'),

          -- FIFA U-17 World Cup group stage (United States U17)
          (1546162, 'United States U17', 'Montenegro U17',
           'https://media.api-sports.io/football/teams/12522.png',
           'https://media.api-sports.io/football/teams/17966.png',
           'World Cup - U17', '2026-11-19 15:00:00+00', 'TBD',
           null, 'FIFA+', true, 'scheduled'),

          (1546181, 'United States U17', 'Chile U17',
           'https://media.api-sports.io/football/teams/12522.png',
           'https://media.api-sports.io/football/teams/12505.png',
           'World Cup - U17', '2026-11-22 15:00:00+00', 'TBD',
           null, 'FIFA+', true, 'scheduled'),

          (1546185, 'Algeria U17', 'United States U17',
           'https://media.api-sports.io/football/teams/21295.png',
           'https://media.api-sports.io/football/teams/12522.png',
           'World Cup - U17', '2026-11-25 15:00:00+00', 'TBD',
           null, 'FIFA+', true, 'scheduled')

        ON CONFLICT (api_football_fixture_id) DO NOTHING
      `);
      const rowCount = (result as unknown as { rowCount?: number }).rowCount ?? 0;
      if (rowCount > 0) {
        logger.info({ rowCount }, "Startup: seeded US U20/U17 youth national team fixtures");
      }
    } catch (err) {
      logger.warn({ err }, "Startup: US U20/U17 fixture seed failed (non-fatal)");
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

  // Removes orphaned anon_user rows (no follows, older than 90 days) once per
  // day. Runs immediately on server boot, then every 24 hours — mirrors what
  // POST /admin/cleanup-anon-users does but without requiring a manual trigger.
  startAnonUserCleanupSchedule();

  // Weekly eligibility rescore — re-evaluates all non-dismissed candidates
  // with the current signal registry weights and writes updated scores and
  // signal rows back to the DB.  Chained after the discovery run by scheduling
  // it on the same 7-day cadence but offset by a few seconds so the previous
  // discovery pass has time to settle.  Never touches the `players` table.
  if (process.env["API_FOOTBALL_KEY"]) {
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    setInterval(() => {
      rescoreAllCandidates().catch((err) =>
        logger.error({ err }, "Scheduled eligibility rescore failed"),
      );
    }, SEVEN_DAYS_MS);
  }
});
