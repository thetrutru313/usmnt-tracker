import app from "./app";
import { logger } from "./lib/logger";
import { startRssIngestionSchedule } from "./lib/rssIngest";
import { startApiFootballSyncSchedule } from "./lib/apiFootballSync";
import { startPlayerClubSyncSchedule } from "./lib/playerClubSync";
import { startPlayerStatsSyncSchedule } from "./lib/playerStatsSync";
import { startNationalTeamSyncSchedule } from "./lib/nationalTeamSync";
import { startAnonUserCleanupSchedule } from "./lib/anonUserCleanup";
import { startUsmntStatsSyncSchedule, syncUsmntStats, promoteNtSentinelIds } from "./lib/usmntSync";
import { rescoreAllCandidates, checkAndApplyWeightDrift } from "./lib/playerDiscovery";
import { runCommitmentSweep } from "./lib/commitmentTracker";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
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
async function runCriticalStartupSeeds(): Promise<void> {
  // KEEP: Active duty — the Sept/Oct 2026 matches have not been played yet.
  // Sentinel IDs (−2001 to −2004) are the live fixture rows until API-Football
  // match logs arrive and the NT fixture ID backfill (Block D, inside the listen
  // callback) promotes them to real IDs.
  // Removable when: all 4 sentinels have been replaced by positive
  // api_football_fixture_id values and the NT sync takes over management.
  //
  // AUTOSCALE NOTE: sentinel seeding runs only at server startup. A schedule
  // change announced between restarts won't be reflected until the next boot.
  // This logic belongs in the sync schedule — moving it is a separate change.
  //
  // Seed the 4 announced Sept/Oct 2026 USMNT friendlies. Idempotency is keyed
  // on (home_team, away_team, competition, is_national_team, kickoff ±2 days) —
  // NOT on api_football_fixture_id — so the seed is safe across the full
  // fixture lifecycle (see friendlySeedLifecycle.test.ts for the contract).
  //
  // Kickoffs converted from EDT (UTC-4) — the offset in Sept/Oct 2026:
  //   Sept 26 USA vs Peru  : 4:30 PM ET = 20:30 UTC same day
  //   Sept 29 USA vs Chile : 8:00 PM ET = 00:00 UTC next day (Sept 30)
  //   Oct  3  USA vs Mexico: 10:00 PM ET = 02:00 UTC next day (Oct 4)
  //   Oct  6  USA vs Canada: 8:00 PM ET  = 00:00 UTC next day (Oct 7)
  try {
    type MatchDef = {
      sentinelId: number;
      homeTeam: string;
      awayTeam: string;
      homeLogoUrl: string;
      awayLogoUrl: string;
      kickoffUtc: string;
      venue: string;
      city: string;
      windowStart: string;
      windowEnd: string;
    };
    // Logo URLs from the API-Football CDN: media.api-sports.io/football/teams/{id}.png
    // USA=2384, Peru=30, Chile=2383, Mexico=16, Canada=5529
    const matches: MatchDef[] = [
      {
        sentinelId: -2001, homeTeam: "USA", awayTeam: "Peru",
        homeLogoUrl: "https://media.api-sports.io/football/teams/2384.png",
        awayLogoUrl: "https://media.api-sports.io/football/teams/30.png",
        kickoffUtc: "2026-09-26 20:30:00+00", venue: "Inter&Co Stadium", city: "Orlando, FL",
        windowStart: "2026-09-24 00:00:00+00", windowEnd: "2026-09-28 23:59:59+00",
      },
      {
        sentinelId: -2002, homeTeam: "USA", awayTeam: "Chile",
        homeLogoUrl: "https://media.api-sports.io/football/teams/2384.png",
        awayLogoUrl: "https://media.api-sports.io/football/teams/2383.png",
        kickoffUtc: "2026-09-30 00:00:00+00", venue: "Energizer Park", city: "St. Louis, MO",
        windowStart: "2026-09-28 00:00:00+00", windowEnd: "2026-10-01 23:59:59+00",
      },
      {
        sentinelId: -2003, homeTeam: "USA", awayTeam: "Mexico",
        homeLogoUrl: "https://media.api-sports.io/football/teams/2384.png",
        awayLogoUrl: "https://media.api-sports.io/football/teams/16.png",
        kickoffUtc: "2026-10-04 02:00:00+00", venue: "State Farm Stadium", city: "Glendale, AZ",
        windowStart: "2026-10-02 00:00:00+00", windowEnd: "2026-10-06 23:59:59+00",
      },
      {
        sentinelId: -2004, homeTeam: "USA", awayTeam: "Canada",
        homeLogoUrl: "https://media.api-sports.io/football/teams/2384.png",
        awayLogoUrl: "https://media.api-sports.io/football/teams/5529.png",
        kickoffUtc: "2026-10-07 00:00:00+00", venue: "Allianz Field", city: "St. Paul, MN",
        windowStart: "2026-10-05 00:00:00+00", windowEnd: "2026-10-09 23:59:59+00",
      },
    ];

    let totalInserted = 0;
    let totalCorrected = 0;
    let totalDeduped = 0;

    for (const m of matches) {
      // Insert if no row with matching match identity already exists.
      const insertResult = await db.execute(sql`
        INSERT INTO fixtures (
          api_football_fixture_id, home_team, away_team,
          competition, kickoff, venue, city, is_national_team, status,
          home_logo_url, away_logo_url
        )
        SELECT ${m.sentinelId}, ${m.homeTeam}, ${m.awayTeam},
               'International Friendly', ${m.kickoffUtc}::timestamptz,
               ${m.venue}, ${m.city}, true, 'scheduled',
               ${m.homeLogoUrl}, ${m.awayLogoUrl}
        WHERE NOT EXISTS (
          SELECT 1 FROM fixtures
          WHERE home_team       = ${m.homeTeam}
            AND away_team       = ${m.awayTeam}
            AND is_national_team = true
            AND competition      = 'International Friendly'
            AND kickoff BETWEEN ${m.windowStart}::timestamptz
                            AND ${m.windowEnd}::timestamptz
        )
      `);
      totalInserted += (insertResult as unknown as { rowCount?: number }).rowCount ?? 0;

      // Correct field values on any remaining sentinel row (no-op if already bound to a real ID).
      // Also backfills logo URLs when null — this handles rows that were inserted before
      // logo URLs were added to the seed (e.g. existing production rows on first deploy).
      const correctResult = await db.execute(sql`
        UPDATE fixtures
        SET kickoff        = ${m.kickoffUtc}::timestamptz,
            venue          = ${m.venue},
            city           = ${m.city},
            home_logo_url  = ${m.homeLogoUrl},
            away_logo_url  = ${m.awayLogoUrl}
        WHERE api_football_fixture_id = ${m.sentinelId}
          AND (
            kickoff        IS DISTINCT FROM ${m.kickoffUtc}::timestamptz
            OR venue       IS DISTINCT FROM ${m.venue}
            OR city        IS DISTINCT FROM ${m.city}
            OR home_logo_url IS DISTINCT FROM ${m.homeLogoUrl}
            OR away_logo_url IS DISTINCT FROM ${m.awayLogoUrl}
          )
      `);
      totalCorrected += (correctResult as unknown as { rowCount?: number }).rowCount ?? 0;

      // Dedup: if a real (positive) bound row exists for this match alongside
      // the sentinel, delete the sentinel. Handles environments where an earlier
      // ON CONFLICT–based seed left a duplicate when the sync bound the real ID.
      const dedupResult = await db.execute(sql`
        DELETE FROM fixtures
        WHERE api_football_fixture_id = ${m.sentinelId}
          AND EXISTS (
            SELECT 1 FROM fixtures f2
            WHERE f2.home_team       = ${m.homeTeam}
              AND f2.away_team       = ${m.awayTeam}
              AND f2.is_national_team = true
              AND f2.competition      = 'International Friendly'
              AND f2.api_football_fixture_id > 0
              AND f2.kickoff BETWEEN ${m.windowStart}::timestamptz
                             AND ${m.windowEnd}::timestamptz
          )
      `);
      totalDeduped += (dedupResult as unknown as { rowCount?: number }).rowCount ?? 0;
    }

    if (totalInserted > 0) logger.info({ totalInserted }, "Startup: seeded Sept/Oct 2026 USMNT friendly fixtures");
    if (totalCorrected > 0) logger.info({ totalCorrected }, "Startup: corrected Sept/Oct 2026 USMNT friendly fixture fields");
    if (totalDeduped > 0) logger.info({ totalDeduped }, "Startup: removed duplicate Sept/Oct 2026 USMNT friendly sentinel rows");

    // Enforce the seed list as the authoritative set: delete any national-team
    // fixture (NULL or negative api_football_fixture_id) whose (home_team, away_team)
    // pair is NOT in the current canonical list.
    // Must delete fixture_players children first — FK constraint blocks parent DELETE.
    const canonicalPairs = matches.map(m => `('${m.homeTeam}','${m.awayTeam}')`).join(",");
    const retiredRows = await db.execute(sql`
      SELECT id FROM fixtures
      WHERE is_national_team = true
        AND (api_football_fixture_id IS NULL OR api_football_fixture_id < 0)
        AND (home_team, away_team) NOT IN (${sql.raw(canonicalPairs)})`);
    const retiredIds = (retiredRows as unknown as { rows?: { id: number }[] }).rows?.map(r => r.id) ?? [];
    if (retiredIds.length > 0) {
      await db.execute(sql`
        DELETE FROM fixture_players
        WHERE fixture_id = ANY(${sql.raw(`ARRAY[${retiredIds.join(",")}]::int[]`)})`);
      await db.execute(sql`
        DELETE FROM fixtures
        WHERE id = ANY(${sql.raw(`ARRAY[${retiredIds.join(",")}]::int[]`)})`);
      logger.info({ retiredCount: retiredIds.length, retiredIds }, "Startup: purged retired national-team sentinel fixtures (and their fixture_players links)");
    }
  } catch (err) {
    logger.warn({ err }, "Startup: Sept/Oct 2026 friendly fixture seed failed (non-fatal)");
  }
}

// Run critical seeds synchronously before the server begins accepting requests.
await runCriticalStartupSeeds();

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
  (async () => {
    await checkAndApplyWeightDrift();
  })();

  // Block D — NT fixture ID backfill (belt-and-braces startup call).
  // The primary path is now promoteNtSentinelIds() running hourly inside
  // startUsmntStatsSyncSchedule(). Running both is harmless — the function is
  // idempotent — and ensures promotion still happens promptly after a deploy
  // rather than waiting up to an hour for the first scheduled tick.
  //
  // Removable when: all sentinel rows seeded above have positive
  // api_football_fixture_id values (i.e. all 4 Sept/Oct friendlies have been
  // played and their match logs synced). When that point arrives,
  // promoteNtSentinelIds() can also be removed from the schedule in
  // startUsmntStatsSyncSchedule().
  (async () => {
    await promoteNtSentinelIds();
  })();

  // KEEP (pending): insert the 6 US U20 / US U17 youth NT fixtures if not
  // already present. syncYouthNtFixtures() will eventually own these rows, but
  // a freshly rebuilt database has a bootstrap gap until the first sync run.
  // Removable when: a standalone scripts/src/seedYouthNtFixtures.ts exists
  // (ON CONFLICT DO NOTHING, no TRUNCATE) and is documented in lib/db/README.md
  // as the bootstrap step for a fresh environment after drizzle-kit migrate.
  // Dev and production are separate Postgres instances; ON CONFLICT DO NOTHING
  // makes repeated startups a no-op.
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
  // Chain: club-stats → USMNT stats → commitment sweep.
  // The commitment check must run after fresh stat data is committed so it
  // evaluates the latest competition history (not stale data from a prior run).
  startPlayerStatsSyncSchedule(undefined, async () => {
    await syncUsmntStats();
    await runCommitmentSweep().catch((err) =>
      logger.error({ err }, "Commitment sweep (chained after daily stats sync) failed"),
    );
  });

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
