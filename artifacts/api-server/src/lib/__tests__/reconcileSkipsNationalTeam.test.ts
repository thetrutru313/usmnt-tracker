/**
 * The hourly club-fixture reconciliation must leave national-team matches
 * alone. Called-up players are linked to them (club_id NULL), but they are
 * never in a club's fixture list, so they used to look "gone from the
 * provider" and were deleted once they kicked off: Haiti v USA, 14 Nov 2026,
 * disappeared mid-match this way.
 *
 * Runs in a rolled-back transaction with temp tables shadowing fixtures and
 * fixture_players, so no dev rows are touched. Dates are 2099.
 */
import { describe, expect, it, vi } from "vitest";
import { db, fixturesTable, fixturePlayersTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { reconcileClubFixtures } from "../fixtureReconciliation.js";

const sandbox = vi.hoisted(() => ({ transaction: null as unknown }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: new Proxy(actual.db, {
      get(target, property) {
        const source = (sandbox.transaction ?? target) as typeof actual.db;
        const value = Reflect.get(source, property);
        return typeof value === "function" ? value.bind(source) : value;
      },
    }),
  };
});

const PLAYER = 99;
const CLUB = 5;
const KICKOFF = new Date("2099-03-20T23:00:00Z");
const NOW = KICKOFF.getTime() + 60 * 60 * 1000; // an hour into the match

/** Runs one reconciliation with nothing in the club's fresh list; returns the fixture ids left. */
async function reconcileWith(rows: { id: number; isNationalTeam: boolean; clubId: number | null }[]) {
  const rollback = new Error("rollback isolated reconcile test");
  let left: number[] = [];
  let removed = -1;
  try {
    await db.transaction(async (tx) => {
      sandbox.transaction = tx;
      await tx.execute(sql`CREATE TEMP TABLE fixtures (LIKE public.fixtures INCLUDING ALL) ON COMMIT DROP`);
      await tx.execute(sql`CREATE TEMP TABLE fixture_players (LIKE public.fixture_players INCLUDING ALL) ON COMMIT DROP`);
      for (const row of rows) {
        await tx.insert(fixturesTable).values({
          id: row.id, apiFootballFixtureId: 9_000_000 + row.id, isNationalTeam: row.isNationalTeam,
          ntLevel: row.isNationalTeam ? "SENIOR" : null, competition: "__reconcile_nt_test__",
          status: "live", kickoff: KICKOFF, venue: "Test",
          homeTeam: row.isNationalTeam ? "Haiti" : "Club A", awayTeam: row.isNationalTeam ? "USA" : "Club B",
        });
        await tx.insert(fixturePlayersTable).values({ fixtureId: row.id, playerId: PLAYER, clubId: row.clubId });
      }
      const result = await reconcileClubFixtures({
        club: { id: CLUB, name: "Club A" },
        clubPlayerIds: [PLAYER],
        freshById: new Map(),
        removalsTrustworthy: true,
        now: NOW,
      });
      removed = result.fixturesRemoved;
      left = (await tx.select({ id: fixturesTable.id }).from(fixturesTable)).map((r) => r.id).sort();
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    sandbox.transaction = null;
  }
  return { left, removed };
}

describe("club fixture reconciliation and national-team matches", () => {
  it("1: a national-team match a club player is called up for is not deleted after kickoff", async () => {
    const { left, removed } = await reconcileWith([{ id: 1, isNationalTeam: true, clubId: null }]);
    expect(left).toEqual([1]);
    expect(removed).toBe(0);
  });

  it("2: a club match missing from the club's list after kickoff is still removed (existing behaviour)", async () => {
    const { left, removed } = await reconcileWith([{ id: 2, isNationalTeam: false, clubId: CLUB }]);
    expect(left).toEqual([]);
    expect(removed).toBe(1);
  });
});
