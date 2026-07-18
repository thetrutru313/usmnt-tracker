import { Router, type IRouter } from "express";
import { ListFixturesQueryParams, ListFixturesResponse, GetFixtureParams, GetFixtureResponse } from "@workspace/api-zod";
import { db, fixturesTable, fixturePlayersTable, playersTable, matchLogsTable, clubsTable } from "@workspace/db";
import { and, eq, gte, inArray, isNotNull, lt, lte, notIlike, or } from "drizzle-orm";
import { pickBestNtFixtureId } from "../lib/pickBestNtFixtureId.js";
import { attachFeaturedPlayers, computePoolTier, resolveAge } from "../lib/queries";
import { z } from "zod/v4";

const router: IRouter = Router();

router.get("/fixtures/:id", async (req, res): Promise<void> => {
  const parsed = GetFixtureParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { id } = parsed.data;

  // Fetch the fixture row
  const [fixture] = await db.select().from(fixturesTable).where(eq(fixturesTable.id, id));
  if (!fixture) {
    res.status(404).json({ error: "Fixture not found" });
    return;
  }

  // All tracked players linked to this fixture
  const linkedRows = await db
    .select({
      playerId: fixturePlayersTable.playerId,
    })
    .from(fixturePlayersTable)
    .where(eq(fixturePlayersTable.fixtureId, id));

  const playerIds = linkedRows.map((r) => r.playerId);

  type TrackedPlayer = {
    id: number; name: string; slug: string; position: string;
    photoUrl: string | null; clubName: string; clubLogoUrl: string | null;
    poolTier: "core" | "inMix" | "prospect";
    matchLog: { minutes: number; goals: number; assists: number; rating: number | null; conceded?: number | null } | null;
  };
  let trackedPlayers: TrackedPlayer[] = [];

  if (playerIds.length > 0) {
    // Load player details
    const players = await db
      .select({
        id: playersTable.id,
        name: playersTable.name,
        slug: playersTable.slug,
        position: playersTable.position,
        photoUrl: playersTable.photoUrl,
        worldCupRoster: playersTable.worldCupRoster,
        nationalTeamCaps: playersTable.nationalTeamCaps,
        age: playersTable.age,
        dateOfBirth: playersTable.dateOfBirth,
        clubName: clubsTable.name,
        clubLogoUrl: clubsTable.logoUrl,
      })
      .from(playersTable)
      .innerJoin(clubsTable, eq(playersTable.clubId, clubsTable.id))
      .where(inArray(playersTable.id, playerIds));

    // Load match logs for these players for this fixture (match by apiFootballFixtureId)
    let matchLogMap = new Map<number, { minutes: number; goals: number; assists: number; rating: number | null; conceded: number | null }>();

    if (fixture.apiFootballFixtureId != null) {
      const logs = await db
        .select({
          playerId: matchLogsTable.playerId,
          minutes: matchLogsTable.minutes,
          goals: matchLogsTable.goals,
          assists: matchLogsTable.assists,
          rating: matchLogsTable.rating,
          conceded: matchLogsTable.conceded,
        })
        .from(matchLogsTable)
        .where(
          and(
            inArray(matchLogsTable.playerId, playerIds),
            eq(matchLogsTable.apiFootballFixtureId, fixture.apiFootballFixtureId),
          ),
        );
      for (const log of logs) {
        matchLogMap.set(log.playerId, {
          minutes: log.minutes,
          goals: log.goals,
          assists: log.assists,
          rating: log.rating ?? null,
          conceded: log.conceded ?? null,
        });
      }
    } else if (fixture.isNationalTeam) {
      // Fallback for seeded national-team fixtures that were created without an
      // API-Football ID. Uses a two-step approach to stay safe when two NT
      // matches fall within the same ±7-day window (e.g. Jamaica Aug 24 /
      // T&T Aug 28):
      //
      //   Step 1 — infer the correct API-Football fixture ID via majority vote
      //            among this fixture's linked players' NT logs in the window.
      //            Nearest-date-to-kickoff breaks any tie.
      //   Step 2 — load match stats strictly by that resolved ID, not by the
      //            date window, so only one match's rows are ever returned.
      const kickoffMs = new Date(fixture.kickoff).getTime();
      const sevenBefore = new Date(kickoffMs - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const sevenAfter  = new Date(kickoffMs + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      // Step 1: candidate resolution — only linked players vote
      //
      // EXPLAIN ANALYZE note: this query produces a Seq Scan on match_logs
      // rather than an Index Scan. Postgres chooses this because:
      //   • match_logs has ~1 000–2 000 rows at current volume (verified Jul 2026)
      //   • The WHERE has no single high-selectivity leading column — the date
      //     column is stored as text (not DATE/TIMESTAMP) so a date-range index
      //     would not be useful here, and is_national_team is a boolean with low
      //     cardinality.
      //   • EXPLAIN ANALYZE shows actual execution time of ~0.2 ms — well within
      //     budget for an infrequent fallback path that only fires for seeded NT
      //     fixtures that were created before API-Football IDs were back-filled.
      //   • The match_logs_player_id_idx IS used by Step 2 (below), and
      //     match_logs_api_football_fixture_id_idx IS used by the primary path
      //     (fixture.apiFootballFixtureId != null).
      // If match_logs grows beyond ~50 000 rows, consider adding an index on
      // (is_national_team, date) or converting the date column to DATE type.
      const candidates = await db
        .select({
          apiFootballFixtureId: matchLogsTable.apiFootballFixtureId,
          date: matchLogsTable.date,
        })
        .from(matchLogsTable)
        .where(
          and(
            inArray(matchLogsTable.playerId, playerIds),
            eq(matchLogsTable.isNationalTeam, true),
            gte(matchLogsTable.date, sevenBefore),
            lte(matchLogsTable.date, sevenAfter),
            isNotNull(matchLogsTable.apiFootballFixtureId),
          ),
        ) as { apiFootballFixtureId: number; date: string }[];

      const bestId = pickBestNtFixtureId(candidates, kickoffMs);

      if (bestId != null) {
        // Step 2: load stats strictly by the resolved fixture ID
        const logs = await db
          .select({
            playerId: matchLogsTable.playerId,
            minutes: matchLogsTable.minutes,
            goals: matchLogsTable.goals,
            assists: matchLogsTable.assists,
            rating: matchLogsTable.rating,
            conceded: matchLogsTable.conceded,
          })
          .from(matchLogsTable)
          .where(
            and(
              inArray(matchLogsTable.playerId, playerIds),
              eq(matchLogsTable.apiFootballFixtureId, bestId),
            ),
          );
        for (const log of logs) {
          matchLogMap.set(log.playerId, {
            minutes: log.minutes,
            goals: log.goals,
            assists: log.assists,
            rating: log.rating ?? null,
            conceded: log.conceded ?? null,
          });
        }
      }
    }

    trackedPlayers = players.map((p) => {
      const age = resolveAge(p.dateOfBirth, p.age);
      const poolTier = computePoolTier({ worldCupRoster: p.worldCupRoster, nationalTeamCaps: p.nationalTeamCaps, age });
      const matchLog = matchLogMap.get(p.id) ?? null;
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        position: p.position,
        photoUrl: p.photoUrl ?? null,
        clubName: p.clubName,
        clubLogoUrl: p.clubLogoUrl ?? null,
        poolTier,
        matchLog,
      };
    });

    // Sort: players with match logs first (by minutes desc), pending players after
    trackedPlayers.sort((a, b) => {
      if (a.matchLog && !b.matchLog) return -1;
      if (!a.matchLog && b.matchLog) return 1;
      if (a.matchLog && b.matchLog) return b.matchLog.minutes - a.matchLog.minutes;
      return a.name.localeCompare(b.name);
    });
  }

  // Build the featuredPlayers list (same as listFixtures)
  const [withPlayers] = await attachFeaturedPlayers([fixture]);
  const response = { ...withPlayers, trackedPlayers };

  res.json(GetFixtureResponse.parse(response));
});

router.get("/fixtures", async (req, res): Promise<void> => {
  const parsed = ListFixturesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { scope, playerId } = parsed.data;

  // Exclude club friendlies; keep national-team fixtures regardless of competition name.
  const conditions = [or(eq(fixturesTable.isNationalTeam, true), notIlike(fixturesTable.competition, "%Friendlies%"))];

  if (scope === "today") {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    conditions.push(gte(fixturesTable.kickoff, startOfDay), lt(fixturesTable.kickoff, endOfDay));
  } else if (scope === "upcoming") {
    conditions.push(gte(fixturesTable.kickoff, new Date()));
  }

  if (playerId) {
    const rows = await db
      .select({ fixtureId: fixturePlayersTable.fixtureId })
      .from(fixturePlayersTable)
      .where(eq(fixturePlayersTable.playerId, playerId));
    const fixtureIds = rows.map((r) => r.fixtureId);
    if (fixtureIds.length === 0) {
      res.json(ListFixturesResponse.parse([]));
      return;
    }
    conditions.push(inArray(fixturesTable.id, fixtureIds));
  }

  const query = db.select().from(fixturesTable).orderBy(fixturesTable.kickoff);
  const rows = conditions.length ? await query.where(and(...conditions)) : await query;

  const withPlayers = await attachFeaturedPlayers(rows);
  res.json(ListFixturesResponse.parse(withPlayers));
});

export default router;
