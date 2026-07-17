/**
 * Fixture reconciliation logic — isolated from the API-Football fetch
 * machinery so it can be imported and driven directly by tests without
 * pulling in the throttle/rate-limit/fetch infrastructure.
 *
 * apiFootballSync.ts calls reconcileClubFixtures from here; tests import it
 * directly with controlled inputs.
 */

import { db, fixturesTable, fixturePlayersTable } from "@workspace/db";
import { eq, and, inArray, lt } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── API-Football fixture shape ───────────────────────────────────────────────

export interface AfFixture {
  fixture: {
    id: number;
    date: string; // ISO 8601 with offset
    status: { short: string; elapsed: number | null }; // e.g. NS (not started), FT (finished), PST (postponed)
    venue: { name: string | null };
  };
  league: { name: string };
  teams: {
    home: { id: number; name: string; logo: string | null };
    away: { id: number; name: string; logo: string | null };
  };
  goals: { home: number | null; away: number | null };
}

// ─── Status mapping ───────────────────────────────────────────────────────────

export const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);
const POSTPONED_STATUSES = new Set(["PST", "CANC", "ABD"]);

export function mapStatus(short: string): string {
  if (FINISHED_STATUSES.has(short)) return "finished";
  if (POSTPONED_STATUSES.has(short)) return "postponed";
  if (short === "1H" || short === "2H" || short === "HT" || short === "ET" || short === "LIVE") return "live";
  return "scheduled";
}

// ─── Reconciliation ───────────────────────────────────────────────────────────

export interface ReconcileClubFixturesInput {
  club: { id: number; name: string };
  /** DB ids of every player currently tracked at this club. */
  clubPlayerIds: number[];
  /** Fresh fixture list keyed by API-Football fixture id. An empty map means
   *  the provider returned zero fixtures — valid for off-season clubs. */
  freshById: Map<number, AfFixture>;
  /** True only when every season-fetch attempt for this club succeeded. When
   *  false, a "missing" fixture may just be absent because of a fetch error,
   *  so removals are skipped to avoid false positives. */
  removalsTrustworthy: boolean;
  /** `Date.now()` snapshot captured before the reconciliation loop starts. */
  now: number;
}

/**
 * Reconciles the fixtures already tracked in the DB for a single club's
 * players against a fresh provider pull.
 *
 * - Fixtures present in `freshById` whose status has changed are updated.
 * - Fixtures absent from `freshById` whose kickoff has **passed** are deleted
 *   (fixture row + fixture_players link) when `removalsTrustworthy` is true.
 * - Fixtures absent whose kickoff is still in the future are only warned about;
 *   they will be removed on a later run once their kickoff has passed.
 */
export async function reconcileClubFixtures(
  input: ReconcileClubFixturesInput,
): Promise<{ fixturesReconciled: number; fixturesRemoved: number }> {
  const { club, clubPlayerIds, freshById, removalsTrustworthy, now } = input;
  let fixturesReconciled = 0;
  let fixturesRemoved = 0;

  if (clubPlayerIds.length === 0) return { fixturesReconciled, fixturesRemoved };

  // Include "live" alongside "scheduled" so matches that went live during a
  // previous sync cycle are still checked and updated to "finished" (with the
  // correct final score) once they end. Without this, a fixture updated to
  // "live, 0-0" would be invisible to all future reconciliation runs and stay
  // stuck forever.
  const trackedRows = await db
    .select({
      id: fixturesTable.id,
      apiFootballFixtureId: fixturesTable.apiFootballFixtureId,
      homeTeam: fixturesTable.homeTeam,
      awayTeam: fixturesTable.awayTeam,
      kickoff: fixturesTable.kickoff,
      status: fixturesTable.status,
      homeScore: fixturesTable.homeScore,
      awayScore: fixturesTable.awayScore,
    })
    .from(fixturesTable)
    .innerJoin(fixturePlayersTable, eq(fixturePlayersTable.fixtureId, fixturesTable.id))
    .where(and(inArray(fixturePlayersTable.playerId, clubPlayerIds), inArray(fixturesTable.status, ["scheduled", "live"])));

  const trackedFixtures = new Map(trackedRows.map((row) => [row.id, row]));
  for (const tracked of trackedFixtures.values()) {
    if (tracked.apiFootballFixtureId === null) continue;
    const fresh = freshById.get(tracked.apiFootballFixtureId);
    if (fresh) {
      const freshStatus = mapStatus(fresh.fixture.status.short);
      const freshElapsed = freshStatus === "live" ? (fresh.fixture.status.elapsed ?? null) : null;

      // Skip no-op writes: if the fixture is still live with the same score,
      // nothing meaningful has changed and there is no reason to hit the DB.
      if (
        freshStatus === "live" &&
        tracked.status === "live" &&
        tracked.homeScore === fresh.goals.home &&
        tracked.awayScore === fresh.goals.away
      ) {
        continue;
      }

      if (freshStatus !== "scheduled") {
        await db
          .update(fixturesTable)
          .set({ status: freshStatus, homeScore: fresh.goals.home, awayScore: fresh.goals.away, elapsedMinute: freshElapsed })
          .where(eq(fixturesTable.id, tracked.id));
        logger.info(
          {
            fixtureId: tracked.id,
            apiFootballFixtureId: tracked.apiFootballFixtureId,
            homeTeam: tracked.homeTeam,
            awayTeam: tracked.awayTeam,
            previousStatus: tracked.status,
            newStatus: freshStatus,
          },
          "Reconciled tracked fixture to provider's current status",
        );
        fixturesReconciled++;
      }
    } else if (!removalsTrustworthy) {
      // A season fetch failed this run, so we can't tell whether this
      // fixture is genuinely gone or just missing because of that
      // failure. Leave it alone — a future run with a clean fetch will
      // resolve it correctly.
      continue;
    } else if (tracked.kickoff.getTime() >= now) {
      // Missing from a fully-successful fetch, but still in the future —
      // too risky to delete on a single "not found" signal (could be a
      // provider hiccup or a fixture rescheduled outside the season window
      // we queried). Flag it for review; if genuinely gone it will also be
      // missing once its kickoff has passed, and will be removed then.
      logger.warn(
        {
          fixtureId: tracked.id,
          apiFootballFixtureId: tracked.apiFootballFixtureId,
          homeTeam: tracked.homeTeam,
          awayTeam: tracked.awayTeam,
          kickoff: tracked.kickoff,
          club: club.name,
        },
        "Tracked upcoming fixture is missing from API-Football's fresh pull — flagging for review, not removing",
      );
    } else {
      // Kickoff has already passed and a fully-successful fetch no longer
      // lists this fixture — e.g. a bracket match already decided
      // elsewhere. Safe to remove rather than leaving a phantom on the
      // Dashboard/Fixtures pages that will never happen.
      await db.delete(fixturePlayersTable).where(eq(fixturePlayersTable.fixtureId, tracked.id));
      await db.delete(fixturesTable).where(eq(fixturesTable.id, tracked.id));
      logger.warn(
        {
          fixtureId: tracked.id,
          apiFootballFixtureId: tracked.apiFootballFixtureId,
          homeTeam: tracked.homeTeam,
          awayTeam: tracked.awayTeam,
          kickoff: tracked.kickoff,
          club: club.name,
        },
        "Removed stale past-kickoff fixture no longer confirmed by API-Football",
      );
      fixturesRemoved++;
    }
  }

  return { fixturesReconciled, fixturesRemoved };
}

// ─── Stale postponed fixture purge ───────────────────────────────────────────

const POSTPONED_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Deletes postponed fixtures whose original kickoff was more than 24 hours ago.
 *
 * Rationale: API-Football marks both weather delays and true reschedules as
 * `PST`. A same-day weather delay resolves within hours, so we give a 24-hour
 * grace window before treating a postponed fixture as stale. After that window,
 * the game has either already happened under a new kickoff time (and a fresh
 * fixture entry with a new ID will have been created by the provider) or been
 * cancelled — either way the original record is clutter that should not show
 * in the upcoming section.
 *
 * fixture_players rows are deleted first to satisfy the foreign-key constraint,
 * then the parent fixture rows are removed.
 */
export async function purgeStalePostponedFixtures(
  now: number = Date.now(),
): Promise<{ purged: number }> {
  const cutoff = new Date(now - POSTPONED_TTL_MS);

  const stale = await db
    .select({ id: fixturesTable.id })
    .from(fixturesTable)
    .where(and(eq(fixturesTable.status, "postponed"), lt(fixturesTable.kickoff, cutoff)));

  if (stale.length === 0) return { purged: 0 };

  const staleIds = stale.map((f) => f.id);

  await db.delete(fixturePlayersTable).where(inArray(fixturePlayersTable.fixtureId, staleIds));
  await db.delete(fixturesTable).where(inArray(fixturesTable.id, staleIds));

  logger.info(
    { purged: stale.length, cutoffIso: cutoff.toISOString() },
    "Purged stale postponed fixtures older than 24 hours",
  );

  return { purged: stale.length };
}
