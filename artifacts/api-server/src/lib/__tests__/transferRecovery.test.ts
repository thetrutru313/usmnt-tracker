/**
 * End-to-end recovery guard: confirms that the purge → repair-pass loop
 * restores a blank fixture card within one sync cycle when a tracked player
 * transfers clubs.
 *
 * ## Background
 * When `purgeStaleTransferredPlayerLinks` runs at the start of a fixture
 * sweep it removes future fixture_players links whose club_id no longer
 * matches the player's current club. The per-club `runRepairPass` that
 * follows in the same sweep recreates links under the player's new club.
 * Together the two steps restore any blank fixture card within one cycle.
 *
 * The unit tests in purgeStaleFixtureLinks.test.ts verify only the delete
 * side. This file verifies the full loop:
 *
 *   purge (stale link gone)
 *     → runRepairPass (new link created for new club's fixture)
 *       → GET /fixtures?scope=upcoming returns the card with the player chip
 *
 * ## Scenario
 * 1. Player is at Club A; Club A has an upcoming scheduled fixture with a
 *    stale fixture_players link (fp.club_id = Club A).
 * 2. Player transfers to Club B (players.club_id updated to Club B).
 * 3. Club B has an upcoming scheduled fixture in the API-Football feed.
 * 4. purgeStaleTransferredPlayerLinks() removes the Club A link.
 * 5. runRepairPass(Club B) creates a new link for Club B's fixture.
 * 6. GET /fixtures?scope=upcoming returns Club B's fixture with the player
 *    present in featuredPlayers (card is restored).
 * 7. Club A's fixture no longer shows the player in featuredPlayers (card
 *    stays blank for the old club — correct behaviour).
 */

import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import {
  db,
  clubsTable,
  playersTable,
  fixturesTable,
  fixturePlayersTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { ListFixturesResponse } from "@workspace/api-zod";
import {
  purgeStaleTransferredPlayerLinks,
  runRepairPass,
} from "../apiFootballSync.js";
import type { AfFixture } from "../fixtureReconciliation.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Safe pretty-printer for Zod issues — keeps assertion messages readable. */
function fmtIssues(err: { issues: Array<{ path: unknown[]; message: string; code: string }> }): string {
  return err.issues.map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message} [${i.code}]`).join("\n");
}

/**
 * Builds a minimal AfFixture stub sufficient to drive the reserve-guard check
 * inside runRepairPass. The teamId arg identifies which side is "ours".
 */
function stubAfFixture(apiId: number, teamId: number, clubName: string): AfFixture {
  return {
    fixture: {
      id: apiId,
      date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      status: { short: "NS", elapsed: null },
      venue: { name: "Recovery Test Stadium" },
    },
    league: { name: "Recovery Test League" },
    teams: {
      home: { id: teamId, name: clubName, logo: null },
      away: { id: teamId + 1, name: "__RT Opponent__", logo: null },
    },
    goals: { home: null, away: null },
  };
}

// ─── cleanup ─────────────────────────────────────────────────────────────────

const insertedClubIds: number[] = [];
const insertedPlayerIds: number[] = [];
const insertedFixtureIds: number[] = [];

afterAll(async () => {
  if (insertedFixtureIds.length > 0) {
    await db
      .delete(fixturePlayersTable)
      .where(inArray(fixturePlayersTable.fixtureId, insertedFixtureIds));
    await db
      .delete(fixturesTable)
      .where(inArray(fixturesTable.id, insertedFixtureIds));
  }
  if (insertedPlayerIds.length > 0) {
    await db.delete(playersTable).where(inArray(playersTable.id, insertedPlayerIds));
  }
  if (insertedClubIds.length > 0) {
    await db.delete(clubsTable).where(inArray(clubsTable.id, insertedClubIds));
  }
});

// ─── suite ───────────────────────────────────────────────────────────────────

describe("Transfer recovery — purge + runRepairPass restores fixture card within one sync cycle", () => {
  it(
    "fixture card is visible on new club and hidden on old club after purge + repair pass",
    async () => {
      // ── 1. Insert Club A (old club) and Club B (new club) ──────────────────
      const [clubA] = await db
        .insert(clubsTable)
        .values({ name: "__RT Club A__", league: "RT League A", country: "USA" })
        .returning({ id: clubsTable.id });
      if (!clubA) throw new Error("Club A insert failed");
      insertedClubIds.push(clubA.id);

      const [clubB] = await db
        .insert(clubsTable)
        .values({ name: "__RT Club B__", league: "RT League B", country: "GER" })
        .returning({ id: clubsTable.id });
      if (!clubB) throw new Error("Club B insert failed");
      insertedClubIds.push(clubB.id);

      // ── 2. Insert the player — currently at Club B ─────────────────────────
      const [player] = await db
        .insert(playersTable)
        .values({
          name: "__RT Transfer Player__",
          slug: "__rt-transfer-player__",
          position: "MF",
          category: "current",
          clubId: clubB.id, // already transferred
          age: 24,
          nationalTeamCaps: 0,
          nationalTeamGoals: 0,
          bio: "",
          worldCupRoster: false,
        })
        .returning({ id: playersTable.id });
      if (!player) throw new Error("Player insert failed");
      insertedPlayerIds.push(player.id);

      // ── 3. Insert Club A's upcoming fixture (stale state) ──────────────────
      //    No apiFootballFixtureId — we won't drive this one through runRepairPass.
      const kickoffA = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      const [fixtureA] = await db
        .insert(fixturesTable)
        .values({
          isNationalTeam: false,
          competition: "RT League A",
          kickoff: kickoffA,
          venue: "Club A Stadium",
          homeTeam: "__RT Club A__",
          awayTeam: "__RT Opponent A__",
          status: "scheduled",
        })
        .returning({ id: fixturesTable.id });
      if (!fixtureA) throw new Error("Fixture A insert failed");
      insertedFixtureIds.push(fixtureA.id);

      // Stale link: player linked to Club A's fixture with club_id = Club A,
      // but player.club_id is already Club B → purge should remove this.
      await db
        .insert(fixturePlayersTable)
        .values({ fixtureId: fixtureA.id, playerId: player.id, clubId: clubA.id });

      // ── 4. Insert Club B's upcoming fixture in the API-Football feed ────────
      //    Needs a real apiFootballFixtureId so runRepairPass can match it.
      const FAKE_API_ID = 8_870_001; // large, collision-free with other test suites
      const FAKE_TEAM_ID = 887_001; // arbitrary; just needs to match freshById stub
      const kickoffB = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const [fixtureB] = await db
        .insert(fixturesTable)
        .values({
          isNationalTeam: false,
          competition: "RT League B",
          kickoff: kickoffB,
          venue: "Club B Stadium",
          homeTeam: "__RT Club B__",
          awayTeam: "__RT Opponent B__",
          status: "scheduled",
          apiFootballFixtureId: FAKE_API_ID,
        })
        .returning({ id: fixturesTable.id });
      if (!fixtureB) throw new Error("Fixture B insert failed");
      insertedFixtureIds.push(fixtureB.id);

      // ── 5. Purge: removes the stale Club A link ────────────────────────────
      // Scope the purge to only the players inserted by this test so the
      // function cannot accidentally delete live fixture_players rows while
      // the test suite runs against the development database.
      const { purged } = await purgeStaleTransferredPlayerLinks({ scopeToPlayerIds: insertedPlayerIds });
      expect(purged, "purge should have removed at least the Club A stale link").toBeGreaterThanOrEqual(1);

      // Stale link must be gone.
      const linksA = await db
        .select({ id: fixturePlayersTable.id })
        .from(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, fixtureA.id));
      expect(
        linksA,
        `Stale Club A link for player id=${player.id} was not removed by purge`,
      ).toHaveLength(0);

      // ── 6. Repair pass: creates the Club B link ────────────────────────────
      const freshById = new Map<number, AfFixture>([
        [FAKE_API_ID, stubAfFixture(FAKE_API_ID, FAKE_TEAM_ID, "__RT Club B__")],
      ]);
      await runRepairPass({
        club: { id: clubB.id, name: "__RT Club B__" },
        teamId: FAKE_TEAM_ID,
        freshById,
        clubPlayerIds: [player.id],
      });

      // New link must exist for Club B's fixture.
      const linksB = await db
        .select({ clubId: fixturePlayersTable.clubId })
        .from(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, fixtureB.id));
      expect(
        linksB,
        `runRepairPass did not create a fixture_players link for Club B's fixture id=${fixtureB.id}`,
      ).toHaveLength(1);
      expect(linksB[0]!.clubId).toBe(clubB.id);

      // ── 7a. Route: Club B's fixture appears with the player chip ───────────
      const resB = await request(app).get("/api/fixtures?scope=upcoming").expect(200);
      const parsedB = ListFixturesResponse.safeParse(resB.body);
      expect(
        parsedB.success,
        `/fixtures?scope=upcoming did not parse:\n${parsedB.success ? "" : fmtIssues(parsedB.error)}`,
      ).toBe(true);

      const foundB = parsedB.data!.find((f) => f.id === fixtureB.id);
      expect(
        foundB,
        `Club B fixture id=${fixtureB.id} is missing from /fixtures?scope=upcoming after repair pass — card is still blank`,
      ).toBeDefined();

      const featuredB = (foundB!.featuredPlayers ?? []).map((p: { id: number }) => p.id);
      expect(
        featuredB,
        `Player id=${player.id} was not restored to featuredPlayers on Club B fixture id=${fixtureB.id} after repair pass`,
      ).toContain(player.id);

      // ── 7b. Route: Club A's fixture does NOT show the player ───────────────
      const foundA = parsedB.data!.find((f) => f.id === fixtureA.id);
      // Club A's fixture may or may not appear (no player tags = no row in the
      // join; it depends on the query's WHERE clause). If it does appear, the
      // transferred player must not be in featuredPlayers.
      if (foundA) {
        const featuredA = (foundA.featuredPlayers ?? []).map((p: { id: number }) => p.id);
        expect(
          featuredA,
          `Player id=${player.id} still appears in featuredPlayers on Club A fixture id=${fixtureA.id} after purge — stale chip not removed`,
        ).not.toContain(player.id);
      }
    },
    60_000,
  );
});
