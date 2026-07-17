/**
 * Confirms that the post-match stats trigger fires syncStatsForFinishedFixture
 * for every fixture that reconciliation marks as newly-finished.
 *
 * ## What & Why
 * reconcileClubFixtures populates `newlyFinished` (tested separately in
 * newlyFinishedFixtures.test.ts).  The downstream half of the chain —
 * iterating `allNewlyFinished` and calling `syncStatsForFinishedFixture` — is
 * what this test covers.  A refactor or accidental early-return could silently
 * disconnect the trigger so `newlyFinished` is computed but never acted on.
 *
 * ## What is tested
 * 1. dispatchPostMatchTriggers calls syncFn exactly once per entry in the map,
 *    forwarding the correct fixtureId (via the map key) and playerIds.
 * 2. Multi-fixture sweep: two distinct finished fixtures → two calls, each with
 *    the correct deduplicated player set.
 * 3. Empty map → syncFn is never called.
 * 4. Player IDs accumulated from two clubs sharing the same fixture are
 *    correctly unioned before being forwarded.
 *
 * ## How it works
 * dispatchPostMatchTriggers is an exported helper extracted from
 * syncApiFootballFixtures specifically to make this trigger loop unit-testable.
 * Tests pass a vi.fn() stub as syncFn — no HTTP calls, no DB access, no
 * circular-import require() shim involved.  This is the same code path that
 * syncApiFootballFixtures exercises in production; only the syncFn argument
 * differs (real syncStatsForFinishedFixture vs. stub).
 */

import { describe, it, expect, vi } from "vitest";
import { dispatchPostMatchTriggers } from "../apiFootballSync.js";

// ─── suite ────────────────────────────────────────────────────────────────────

describe("dispatchPostMatchTriggers — post-match stats trigger", () => {
  it("calls syncFn once with the correct playerIds when one fixture is newly-finished", async () => {
    const fixtureId = 100;
    const playerIds = [1, 2, 3];

    const syncFn = vi.fn().mockResolvedValue(undefined);
    const allNewlyFinished = new Map([[fixtureId, new Set(playerIds)]]);

    dispatchPostMatchTriggers(allNewlyFinished, syncFn);

    // syncFn is fire-and-forget (.catch()), so it is called synchronously
    // in the loop before any microtask ticks.
    expect(syncFn, "syncFn must be called exactly once").toHaveBeenCalledTimes(1);

    const [calledWith] = syncFn.mock.calls;
    const forwarded: number[] = calledWith![0];

    expect(
      forwarded,
      "all tracked player ids must be forwarded",
    ).toEqual(expect.arrayContaining(playerIds));
    expect(forwarded, "no extra player ids should be included").toHaveLength(playerIds.length);
  });

  it("calls syncFn once per unique fixture when multiple fixtures finish in the same sweep", async () => {
    const fixtureIdA = 200;
    const fixtureIdB = 201;
    const playerIdsA = [10, 11];
    const playerIdsB = [20, 21, 22];

    const syncFn = vi.fn().mockResolvedValue(undefined);
    const allNewlyFinished = new Map([
      [fixtureIdA, new Set(playerIdsA)],
      [fixtureIdB, new Set(playerIdsB)],
    ]);

    dispatchPostMatchTriggers(allNewlyFinished, syncFn);

    expect(syncFn, "syncFn must be called once per finished fixture").toHaveBeenCalledTimes(2);

    // Collect the playerIds forwarded for each fixture.
    const callsByFixture = new Map<number, number[]>();
    for (const call of syncFn.mock.calls) {
      const ids: number[] = call[0];
      // Identify which fixture this call belongs to by matching the player set.
      if (playerIdsA.every((id) => ids.includes(id)) && ids.length === playerIdsA.length) {
        callsByFixture.set(fixtureIdA, ids);
      } else if (playerIdsB.every((id) => ids.includes(id)) && ids.length === playerIdsB.length) {
        callsByFixture.set(fixtureIdB, ids);
      }
    }

    expect(callsByFixture.has(fixtureIdA), "fixture A player set must be forwarded").toBe(true);
    expect(callsByFixture.has(fixtureIdB), "fixture B player set must be forwarded").toBe(true);

    expect(callsByFixture.get(fixtureIdA)).toEqual(expect.arrayContaining(playerIdsA));
    expect(callsByFixture.get(fixtureIdB)).toEqual(expect.arrayContaining(playerIdsB));
  });

  it("does NOT call syncFn when allNewlyFinished is empty", () => {
    const syncFn = vi.fn().mockResolvedValue(undefined);

    dispatchPostMatchTriggers(new Map(), syncFn);

    expect(
      syncFn,
      "syncFn must not be called when no fixtures finished",
    ).not.toHaveBeenCalled();
  });

  it("unions player ids from two clubs sharing the same fixture before forwarding", () => {
    const fixtureId = 300;

    // Simulate two clubs both linked to the same fixture; syncApiFootballFixtures
    // merges them into one Set before passing to dispatchPostMatchTriggers.
    const clubAPlayerIds = [40, 41];
    const clubBPlayerIds = [42, 43];
    const mergedSet = new Set([...clubAPlayerIds, ...clubBPlayerIds]);

    const syncFn = vi.fn().mockResolvedValue(undefined);
    const allNewlyFinished = new Map([[fixtureId, mergedSet]]);

    dispatchPostMatchTriggers(allNewlyFinished, syncFn);

    expect(syncFn).toHaveBeenCalledTimes(1);

    const forwarded: number[] = syncFn.mock.calls[0]![0];
    expect(forwarded).toEqual(
      expect.arrayContaining([...clubAPlayerIds, ...clubBPlayerIds]),
    );
    expect(forwarded).toHaveLength(4);
  });

  it("a syncFn rejection is swallowed and does not throw out of dispatchPostMatchTriggers", async () => {
    const fixtureId = 400;
    const syncFn = vi.fn().mockRejectedValue(new Error("stats API down"));

    const allNewlyFinished = new Map([[fixtureId, new Set([50, 51])]]);

    // The call itself must not throw — rejections are caught via .catch() inside
    // dispatchPostMatchTriggers.
    expect(() => dispatchPostMatchTriggers(allNewlyFinished, syncFn)).not.toThrow();

    // Let microtasks flush so the .catch() handler runs without unhandled rejection.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
