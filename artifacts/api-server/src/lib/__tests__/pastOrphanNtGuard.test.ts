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
    { label: "unbound senior NT sentinel at 2 days survives", isNationalTeam: true, afId: -920005, daysAgo: 2, survives: true },
    { label: "unbound senior NT sentinel at 10 days is purged", isNationalTeam: true, afId: -920008, daysAgo: 10, survives: false },
    { label: "otherwise identical club fixture at 2 days is purged", isNationalTeam: false, afId: -920006, daysAgo: 2, survives: false },
    { label: "positive-ID past NT fixture at 10 days survives", isNationalTeam: true, afId: 9920007, daysAgo: 10, survives: true },
    { label: "unbound senior NT sentinel at exactly 7 days survives", isNationalTeam: true, afId: -920009, daysAgo: 7, survives: true },
  ])("$label", async ({ isNationalTeam, afId, daysAgo, survives }) => {
    const rollback = new Error("intentional test rollback");
    try {
      await db.transaction(async (tx) => {
        holder.transaction = tx;
        const [fixture] = await tx.insert(fixturesTable).values({
          homeTeam: "__Past Orphan Guard__",
          awayTeam: "__Opponent__",
          competition: "International Friendly",
          kickoff: new Date(Date.parse("2026-01-15T00:00:00Z") - daysAgo * 86_400_000),
          venue: "Test Stadium",
          status: "scheduled",
          isNationalTeam,
          ntLevel: isNationalTeam ? "SENIOR" : null,
          apiFootballFixtureId: afId,
        }).returning();
        await purgeStaleOrphanedPastFixtures(Date.parse("2026-01-15T00:00:00Z"));
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
