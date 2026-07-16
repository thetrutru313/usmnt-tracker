/**
 * Fixture reconciliation logic — isolated from the API-Football fetch
 * machinery so it can be imported and driven directly by tests without
 * pulling in the throttle/rate-limit/fetch infrastructure.
 *
 * apiFootballSync.ts calls reconcileClubFixtures from here; tests import it
 * directly with controlled inputs.
 */

import { db, fixturesTable, fixturePlayersTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── API-Football fixture shape ───────────────────────────────────────────────

export interface AfFixture {
  fixture: {
    id: number;
    date: string; // ISO 8601 with offset
    status: { short: string }; // e.g. NS (not started), FT (finished), PST (postponed)
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

  const trackedRows = await db
    .select({
      id: fixturesTable.id,
      apiFootballFixtureId: fixturesTable.apiFootballFixtureId,
      homeTeam: fixturesTable.homeTeam,
      awayTeam: fixturesTable.awayTeam,
      kickoff: fixturesTable.kickoff,
    })
    .from(fixturesTable)
    .innerJoin(fixturePlayersTable, eq(fixturePlayersTable.fixtureId, fixturesTable.id))
    .where(and(inArray(fixturePlayersTable.playerId, clubPlayerIds), eq(fixturesTable.status, "scheduled")));

  const trackedFixtures = new Map(trackedRows.map((row) => [row.id, row]));
  for (const tracked of trackedFixtures.values()) {
    if (tracked.apiFootballFixtureId === null) continue;
    const fresh = freshById.get(tracked.apiFootballFixtureId);
    if (fresh) {
      const freshStatus = mapStatus(fresh.fixture.status.short);
      if (freshStatus !== "scheduled") {
        await db
          .update(fixturesTable)
          .set({ status: freshStatus, homeScore: fresh.goals.home, awayScore: fresh.goals.away })
          .where(eq(fixturesTable.id, tracked.id));
        logger.info(
          {
            fixtureId: tracked.id,
            apiFootballFixtureId: tracked.apiFootballFixtureId,
            homeTeam: tracked.homeTeam,
            awayTeam: tracked.awayTeam,
            newStatus: freshStatus,
          },
          "Reconciled fixture that was stuck as 'scheduled' to the provider's current status",
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
