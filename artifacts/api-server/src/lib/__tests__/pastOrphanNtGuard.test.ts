import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, fixturesTable } from "@workspace/db";
import { purgeStaleOrphanedPastFixtures } from "../fixtureReconciliation.js";

// Run the real purge against an isolated transaction, then roll it back.
// Its broad orphan query must never permanently delete development data.
const holder = vi.hoisted(() => ({ transaction: null as unknown }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: new Proxy(actual.db, {
      get(target, property) {
        const source = (holder.transaction ?? target) as typeof actual.db;
        const value = Reflect.get(source, property);
        return typeof value === "function" ? value.bind(source) : value;
      },
    }),
  };
});

describe("past orphan purge — national-team protection", () => {
  it.each([
    { label: "unbound senior NT sentinel survives", isNationalTeam: true, afId: -920005, survives: true },
    { label: "otherwise identical club fixture is purged", isNationalTeam: false, afId: -920006, survives: false },
    { label: "positive-ID past NT fixture survives", isNationalTeam: true, afId: 9920007, survives: true },
  ])("$label", async ({ isNationalTeam, afId, survives }) => {
    const rollback = new Error("intentional test rollback");
    try {
      await db.transaction(async (tx) => {
        holder.transaction = tx;
        const [fixture] = await tx.insert(fixturesTable).values({
          homeTeam: "__Past Orphan Guard__",
          awayTeam: "__Opponent__",
          competition: "International Friendly",
          kickoff: new Date("2026-01-01T00:00:00Z"),
          venue: "Test Stadium",
          status: "scheduled",
          isNationalTeam,
          ntLevel: isNationalTeam ? "SENIOR" : null,
          apiFootballFixtureId: afId,
        }).returning();
        await purgeStaleOrphanedPastFixtures(Date.parse("2026-01-02T00:00:00Z"));
        const remaining = await tx.select().from(fixturesTable).where(eq(fixturesTable.id, fixture!.id));
        expect(remaining).toHaveLength(survives ? 1 : 0);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      holder.transaction = null;
    }
  });
});
