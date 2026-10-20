import { expect, it, vi } from "vitest";
import { db, fixturesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { syncNationalTeamFixtures } from "../apiFootballSync.js";
import { logger } from "../logger.js";

const sandbox = vi.hoisted(() => ({ transaction: null as unknown }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: new Proxy(actual.db, {
    get(target, property) {
      const source = (sandbox.transaction ?? target) as typeof actual.db;
      const value = Reflect.get(source, property);
      return typeof value === "function" ? value.bind(source) : value;
    },
  }) };
});

it("sync updates schedule-only changes, logs old/new fields, and still fetches the prior season", async () => {
  const rollback = new Error("intentional NT schedule sync rollback");
  const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const path = new URL(String(url));
    let response: unknown[] = [];
    if (path.pathname === "/teams") {
      response = [{ team: { id: 2384, name: "USA", national: true, logo: null } }];
    } else if (path.pathname === "/fixtures" && path.searchParams.get("season") === String(new Date().getUTCFullYear() - 1)) {
      response = [{
        fixture: { id: 1644693, date: "2026-11-14T21:00:00Z",
          status: { short: "NS", elapsed: null }, venue: { name: "X", city: "Y" } },
        teams: { home: { id: 2386, name: "Haiti", logo: null }, away: { id: 2384, name: "USA", logo: null } },
        goals: { home: null, away: null }, league: { name: "CONCACAF Nations League" },
      }];
    }
    return new Response(JSON.stringify({ response, errors: [] }));
  });
  vi.stubGlobal("fetch", fetcher); // No provider calls: all fetches are intercepted.
  try {
    await db.transaction(async tx => {
      sandbox.transaction = tx;
      await tx.execute(sql`CREATE TEMP TABLE fixtures (LIKE public.fixtures INCLUDING ALL) ON COMMIT DROP`);
      await tx.execute(sql`CREATE TEMP TABLE fixture_players (LIKE public.fixture_players INCLUDING ALL) ON COMMIT DROP`);
      const [row] = await tx.insert(fixturesTable).values({
        apiFootballFixtureId: 1644693, homeTeam: "Haiti", awayTeam: "USA",
        isNationalTeam: true, ntLevel: "SENIOR", status: "scheduled",
        competition: "CONCACAF Nations League", kickoff: new Date("2026-11-15T00:00:00Z"),
        kickoffTimeTbd: true, venue: "TBD", city: null,
      }).returning();
      const result = await syncNationalTeamFixtures();
      expect(result).toMatchObject({ fixturesChecked: 1, fixturesUpdated: 1, idsBound: 0, failures: 0 });
      const [updated] = await tx.select().from(fixturesTable).where(eq(fixturesTable.id, row!.id));
      expect(updated).toMatchObject({
        kickoff: new Date("2026-11-14T21:00:00Z"), kickoffTimeTbd: false, venue: "X", city: "Y",
        status: "scheduled", homeScore: null, awayScore: null, apiFootballFixtureId: 1644693,
      });
      for (const [field, oldValue, newValue] of [
        ["kickoff", row!.kickoff, updated!.kickoff],
        ["kickoffTimeTbd", true, false], ["venue", "TBD", "X"], ["city", null, "Y"],
      ]) {
        expect(info).toHaveBeenCalledWith(
          { fixtureId: row!.id, afFixtureId: 1644693, field, oldValue, newValue },
          "NT fixture sync: schedule detail changed",
        );
      }
      expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("season")))
        .toEqual(expect.arrayContaining([String(new Date().getUTCFullYear()), String(new Date().getUTCFullYear() - 1)]));
      const again = await syncNationalTeamFixtures();
      expect(again.fixturesUpdated).toBe(0);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    sandbox.transaction = null;
    info.mockRestore();
    vi.unstubAllGlobals();
  }
}, 20000);
