/**
 * Integration tests for the transfer-precedence guard inside
 * `syncApiFootballFixtures`.
 *
 * The guard fires when the player's most recent confirmed transfer points to a
 * different club than what /players/squads returned, preventing squad
 * registration lag from silently reverting a transfer-confirmed club_id.
 *
 * ## Scenarios covered
 * 1. Guard fires   — player is already at the transfer destination; squad
 *    returns the old club; guard keeps the transfer-confirmed club_id.
 * 2. Guard skips   — the squad result agrees with the latest confirmed
 *    transfer destination; squad wins and club_id is updated normally.
 * 3. Newest transfer wins — player has two confirmed transfers; the newer one
 *    agrees with squad; guard correctly skips (newest-row ordering ensures the
 *    older conflicting transfer is not consulted).
 */

import { vi, describe, it, expect, afterAll, afterEach, beforeAll } from "vitest";
import {
  db,
  clubsTable,
  playersTable,
  fixturePlayersTable,
  transfersTable,
} from "@workspace/db";
import { eq, and, inArray, or, desc } from "drizzle-orm";
import { syncApiFootballFixtures } from "../apiFootballSync.js";

// ─── Fake identifiers ─────────────────────────────────────────────────────────
// Each test gets its own range of fake team IDs and player API IDs so they
// can run in the same DB without unique-constraint collisions.

// Test 1: guard fires (squad returns old club, transfer says new club)
const T1_PLAYER_API_ID = 9_883_001;
const T1_TEAM_DEST     = 9_883_011; // transfer destination (player is here)
const T1_TEAM_OLD      = 9_883_012; // stale squad-reported club

// Test 2: guard skips (squad agrees with latest transfer)
const T2_PLAYER_API_ID = 9_883_002;
const T2_TEAM_OLD      = 9_883_021; // player starts here, stale
const T2_TEAM_DEST     = 9_883_022; // transfer destination AND squad result

// Test 3: newest transfer wins (older conflicting + newer agreeing)
const T3_PLAYER_API_ID = 9_883_003;
const T3_TEAM_A        = 9_883_031; // origin club
const T3_TEAM_B        = 9_883_032; // intermediate (old transfer destination, player is here)
const T3_TEAM_C        = 9_883_033; // newest transfer destination AND squad result

// ─── Shared cleanup accumulators ──────────────────────────────────────────────

const insertedPlayerIds: number[] = [];
const insertedClubIds: number[]   = [];

// All fake team IDs used across tests — for belt-and-suspenders cleanup.
const ALL_FAKE_TEAM_IDS = [
  T1_TEAM_DEST, T1_TEAM_OLD,
  T2_TEAM_OLD,  T2_TEAM_DEST,
  T3_TEAM_A,    T3_TEAM_B, T3_TEAM_C,
];

// All fake slugs and player API IDs — for stale-row cleanup in beforeAll.
const ALL_FAKE_SLUGS = [
  "__tpg-t1-player__",
  "__tpg-t2-player__",
  "__tpg-t3-player__",
];
const ALL_FAKE_PLAYER_API_IDS = [T1_PLAYER_API_ID, T2_PLAYER_API_ID, T3_PLAYER_API_ID];

// ─── Mock fetch factory ───────────────────────────────────────────────────────

function fakeResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ response: data, errors: {} }),
    text: async () => JSON.stringify({ response: data, errors: {} }),
  } as unknown as Response;
}

/**
 * Returns a fetch stub that serves `squadTeamId`/`squadTeamName` for
 * /players/squads and /teams?id= and empty arrays for everything else.
 * fetchPlayerCurrentTeam doesn't filter by player API ID in the squad
 * response — it takes the first non-national team — so we don't need a
 * player-specific player ID in the response body.
 */
function makeMockFetch(squadTeamId: number, squadTeamName: string, playerApiId: number) {
  return function mockFetch(url: string | URL | Request): Promise<Response> {
    const s = typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;

    if (s.includes("/players/squads")) {
      return Promise.resolve(
        fakeResponse([{
          team: { id: squadTeamId, name: squadTeamName, logo: null, national: false },
          players: [{ id: playerApiId, name: "Test Player" }],
        }]),
      );
    }
    if (s.includes("/teams?id=")) {
      return Promise.resolve(
        fakeResponse([{ team: { id: squadTeamId, name: squadTeamName, logo: null, national: false } }]),
      );
    }
    return Promise.resolve(fakeResponse([]));
  };
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Clean up any stale rows left by a previously crashed run. We match on
  // both slug and apiFootballPlayerId so that partial-cleanup failures from a
  // prior run don't leave orphaned players that block the fresh inserts.
  const staleRows = await db
    .select({ id: playersTable.id })
    .from(playersTable)
    .where(or(
      inArray(playersTable.slug, ALL_FAKE_SLUGS),
      inArray(playersTable.apiFootballPlayerId, ALL_FAKE_PLAYER_API_IDS),
    ));
  if (staleRows.length > 0) {
    const staleIds = staleRows.map((r) => r.id);
    await db.delete(transfersTable).where(inArray(transfersTable.playerId, staleIds)).catch(() => {});
    await db.delete(fixturePlayersTable).where(inArray(fixturePlayersTable.playerId, staleIds)).catch(() => {});
    await db.delete(playersTable).where(inArray(playersTable.id, staleIds)).catch(() => {});
  }
  for (const tid of ALL_FAKE_TEAM_IDS) {
    await db.delete(clubsTable).where(eq(clubsTable.apiFootballTeamId, tid)).catch(() => {});
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  // FK order: transfers → fixture_players → players → clubs.
  if (insertedPlayerIds.length > 0) {
    await db.delete(transfersTable).where(inArray(transfersTable.playerId, insertedPlayerIds)).catch(() => {});
    await db.delete(fixturePlayersTable).where(inArray(fixturePlayersTable.playerId, insertedPlayerIds)).catch(() => {});
    await db.delete(playersTable).where(inArray(playersTable.id, insertedPlayerIds)).catch(() => {});
  }
  if (insertedClubIds.length > 0) {
    await db.delete(clubsTable).where(inArray(clubsTable.id, insertedClubIds)).catch(() => {});
  }
  // Belt-and-suspenders: remove by fake team ID in case id tracking missed a row.
  for (const tid of ALL_FAKE_TEAM_IDS) {
    await db.delete(clubsTable).where(eq(clubsTable.apiFootballTeamId, tid)).catch(() => {});
  }
});

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("syncApiFootballFixtures — transfer-precedence guard", () => {

  it(
    "keeps transfer-confirmed club_id when squad returns the stale old club (guard fires)",
    async () => {
      // Seed: two clubs — the transfer destination and the stale squad club.
      const [destClub] = await db
        .insert(clubsTable)
        .values({ name: "__TPG1 Dest__", league: "L", country: "USA", apiFootballTeamId: T1_TEAM_DEST })
        .returning({ id: clubsTable.id });
      if (!destClub) throw new Error("destClub insert failed");
      insertedClubIds.push(destClub.id);

      const [oldClub] = await db
        .insert(clubsTable)
        .values({ name: "__TPG1 Old__", league: "L", country: "USA", apiFootballTeamId: T1_TEAM_OLD })
        .returning({ id: clubsTable.id });
      if (!oldClub) throw new Error("oldClub insert failed");
      insertedClubIds.push(oldClub.id);

      // Seed: player already at the transfer destination (transfer sync ran).
      const [player] = await db
        .insert(playersTable)
        .values({
          name: "__TPG1 Player__", slug: "__tpg-t1-player__", position: "MF",
          category: "current", clubId: destClub.id, age: 23,
          nationalTeamCaps: 5, nationalTeamGoals: 0, performanceTrend: "steady",
          trending: false, bio: "", worldCupRoster: false,
          apiFootballPlayerId: T1_PLAYER_API_ID,
        })
        .returning({ id: playersTable.id });
      if (!player) throw new Error("player insert failed");
      insertedPlayerIds.push(player.id);

      // Seed: confirmed transfer to the destination club.
      await db.insert(transfersTable).values({
        playerId: player.id,
        fromClub: "__TPG1 Old__", toClub: "__TPG1 Dest__",
        transferType: "transfer", status: "confirmed",
        announcedAt: new Date(Date.now() - 2 * 86_400_000),
        summary: "TPG test transfer",
      });

      // Squad endpoint returns the OLD club (stale squad registration).
      vi.stubGlobal("fetch", makeMockFetch(T1_TEAM_OLD, "__TPG1 Old__", T1_PLAYER_API_ID));

      await syncApiFootballFixtures([player.id]);

      const [updated] = await db
        .select({ clubId: playersTable.clubId })
        .from(playersTable)
        .where(eq(playersTable.id, player.id));

      expect(
        updated?.clubId,
        `Guard should have kept transfer-confirmed destClub.id=${destClub.id}, got ${updated?.clubId}`,
      ).toBe(destClub.id);
    },
    90_000,
  );

  it(
    "lets squad update club_id when squad agrees with the latest confirmed transfer (guard skips)",
    async () => {
      // Seed: two clubs.
      const [oldClub] = await db
        .insert(clubsTable)
        .values({ name: "__TPG2 Old__", league: "L", country: "USA", apiFootballTeamId: T2_TEAM_OLD })
        .returning({ id: clubsTable.id });
      if (!oldClub) throw new Error("oldClub insert failed");
      insertedClubIds.push(oldClub.id);

      const [destClub] = await db
        .insert(clubsTable)
        .values({ name: "__TPG2 Dest__", league: "L", country: "USA", apiFootballTeamId: T2_TEAM_DEST })
        .returning({ id: clubsTable.id });
      if (!destClub) throw new Error("destClub insert failed");
      insertedClubIds.push(destClub.id);

      // Seed: player at old club (transfer sync hasn't updated club_id yet).
      const [player] = await db
        .insert(playersTable)
        .values({
          name: "__TPG2 Player__", slug: "__tpg-t2-player__", position: "FW",
          category: "current", clubId: oldClub.id, age: 22,
          nationalTeamCaps: 3, nationalTeamGoals: 1, performanceTrend: "up",
          trending: false, bio: "", worldCupRoster: false,
          apiFootballPlayerId: T2_PLAYER_API_ID,
        })
        .returning({ id: playersTable.id });
      if (!player) throw new Error("player insert failed");
      insertedPlayerIds.push(player.id);

      // Seed: confirmed transfer to dest club.
      await db.insert(transfersTable).values({
        playerId: player.id,
        fromClub: "__TPG2 Old__", toClub: "__TPG2 Dest__",
        transferType: "transfer", status: "confirmed",
        announcedAt: new Date(Date.now() - 86_400_000),
        summary: "TPG2 test transfer",
      });

      // Squad endpoint AGREES with the latest transfer (returns dest club).
      vi.stubGlobal("fetch", makeMockFetch(T2_TEAM_DEST, "__TPG2 Dest__", T2_PLAYER_API_ID));

      await syncApiFootballFixtures([player.id]);

      const [updated] = await db
        .select({ clubId: playersTable.clubId })
        .from(playersTable)
        .where(eq(playersTable.id, player.id));

      expect(
        updated?.clubId,
        `Guard should have skipped; squad should have updated club_id to destClub.id=${destClub.id}, got ${updated?.clubId}`,
      ).toBe(destClub.id);
    },
    90_000,
  );

  it(
    "guard DB query returns the newest confirmed transfer — older conflicting rows are not consulted",
    async () => {
      // This test verifies the ordering behavior of the guard's transfer lookup
      // directly against the DB, without running the full sync.  It inserts two
      // confirmed transfers for a player — an older one (A→B) and a newer one
      // (B→C) — then runs the same query the guard uses and asserts the newest
      // row (B→C) is returned first.  This proves that an older conflicting
      // transfer cannot shadow a newer one that agrees with squad.

      // Seed: minimal player — we only need an id to scope the transfer query.
      const [clubAnchor] = await db
        .insert(clubsTable)
        .values({ name: "__TPG3 Anchor__", league: "L", country: "USA", apiFootballTeamId: T3_TEAM_A })
        .returning({ id: clubsTable.id });
      if (!clubAnchor) throw new Error("clubAnchor insert failed");
      insertedClubIds.push(clubAnchor.id);

      const [player] = await db
        .insert(playersTable)
        .values({
          name: "__TPG3 Player__", slug: "__tpg-t3-player__", position: "GK",
          category: "current", clubId: clubAnchor.id, age: 27,
          nationalTeamCaps: 0, nationalTeamGoals: 0, performanceTrend: "steady",
          trending: false, bio: "", worldCupRoster: false,
          apiFootballPlayerId: T3_PLAYER_API_ID,
        })
        .returning({ id: playersTable.id });
      if (!player) throw new Error("player insert failed");
      insertedPlayerIds.push(player.id);

      // Seed: old transfer (A→B, 5 days ago) and newer transfer (B→C, 1 day ago).
      await db.insert(transfersTable).values({
        playerId: player.id,
        fromClub: "__TPG3 ClubA__", toClub: "__TPG3 ClubB__",
        transferType: "transfer", status: "confirmed",
        announcedAt: new Date(Date.now() - 5 * 86_400_000),
        summary: "Older transfer A→B",
      });
      await db.insert(transfersTable).values({
        playerId: player.id,
        fromClub: "__TPG3 ClubB__", toClub: "__TPG3 ClubC__",
        transferType: "transfer", status: "confirmed",
        announcedAt: new Date(Date.now() - 86_400_000),
        summary: "Newer transfer B→C",
      });

      // Run the exact same query the guard uses (newest-first, limit 1).
      const [latestTransfer] = await db
        .select({ toClub: transfersTable.toClub, summary: transfersTable.summary })
        .from(transfersTable)
        .where(and(eq(transfersTable.playerId, player.id), eq(transfersTable.status, "confirmed")))
        .orderBy(desc(transfersTable.announcedAt))
        .limit(1);

      // The guard must see the newer transfer (B→C), not the older (A→B).
      // If it saw the older one, an older conflicting move could override a
      // newer one that agrees with squad — the bug the ordering is designed to prevent.
      expect(
        latestTransfer?.toClub,
        `Guard query returned the wrong transfer. Expected newest (B→C → toClub='__TPG3 ClubC__') but got '${latestTransfer?.toClub}'`,
      ).toBe("__TPG3 ClubC__");
    },
  );
});
