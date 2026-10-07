import { describe, expect, it, vi } from "vitest";
import { db, fixturesTable, fixturePlayersTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { runNationalTeamRepairPass } from "../apiFootballSync";

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

async function checkRepair(level: string) {
  const rollback = new Error("rollback isolated repair test");
  let links: typeof fixturePlayersTable.$inferSelect[] = [];
  try {
    await db.transaction(async (tx) => {
      sandbox.transaction = tx;
      await tx.execute(sql`CREATE TEMP TABLE fixtures (LIKE public.fixtures INCLUDING ALL) ON COMMIT DROP`);
      await tx.execute(sql`CREATE TEMP TABLE fixture_players (LIKE public.fixture_players INCLUDING ALL) ON COMMIT DROP`);
      await tx.insert(fixturesTable).values([
        { id: 1, isNationalTeam: true, ntLevel: "SENIOR", competition: "__level_test__", status: "finished", kickoff: new Date("2026-10-01"), venue: "Test", homeTeam: "USA", awayTeam: "Canada" },
        { id: 2, isNationalTeam: true, ntLevel: level, competition: "__level_test__", status: "scheduled", kickoff: new Date("2026-11-01"), venue: "Test", homeTeam: "USA", awayTeam: "Canada" },
      ]);
      await tx.insert(fixturePlayersTable).values({ fixtureId: 1, playerId: 99, clubId: null });
      await runNationalTeamRepairPass();
      links = await tx.select().from(fixturePlayersTable);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    sandbox.transaction = null;
  }
  return links.filter((link) => link.fixtureId === 2);
}

describe("national-team repair age-level isolation", () => {
  it("9: a finished SENIOR link is not copied to an upcoming U20 fixture", async () => {
    expect(await checkRepair("U20")).toHaveLength(0);
  });
  it("10: a finished SENIOR link still copies to an upcoming SENIOR fixture", async () => {
    expect(await checkRepair("SENIOR")).toEqual([
      expect.objectContaining({ fixtureId: 2, playerId: 99, clubId: null }),
    ]);
  });
});
