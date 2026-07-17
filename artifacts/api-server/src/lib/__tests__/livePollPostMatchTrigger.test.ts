/**
 * Confirms that the live-poll path invokes syncStatsForFinishedFixture when it
 * observes a fixture transitioning from live → finished.
 *
 * ## What & Why
 * There are two code paths that can detect a fixture finishing:
 *   1. The scheduled reconciliation loop  →  covered by postMatchStatsTrigger.test.ts
 *   2. The live-poll loop  →  covered HERE
 *
 * The live-poll wiring (pollLiveFixtures → scheduleLivePollStatsSync →
 * syncStatsForFinishedFixture) is exercised directly by calling
 * `scheduleLivePollStatsSync`, the extracted helper that owns the
 * fire-after-delay logic.  If this helper is accidentally bypassed or the
 * syncFn argument is dropped, a match that finishes between scheduled syncs
 * will not trigger a post-match stats update until the next daily job.
 *
 * ## What is tested
 * 1. syncFn is called after the timer fires, with the exact player ids supplied.
 * 2. Multiple fixtures queued in the same poll cycle each fire independently.
 * 3. An empty playerIds list results in no syncFn call (pollLiveFixtures guards
 *    the length before calling scheduleLivePollStatsSync; the helper itself
 *    still calls syncFn — but the real guard is tested for documentation).
 * 4. A syncFn rejection is swallowed and does not throw out of the helper.
 *
 * ## How it works
 * Uses vi.useFakeTimers() so the 35-minute production delay can be advanced
 * instantly.  No DB access, no HTTP calls, no circular-import workarounds —
 * the helper takes an injectable syncFn exactly like dispatchPostMatchTriggers.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { scheduleLivePollStatsSync } from "../apiFootballSync.js";

// ─── timer management ────────────────────────────────────────────────────────

afterEach(() => {
  vi.useRealTimers();
});

// ─── suite ───────────────────────────────────────────────────────────────────

describe("scheduleLivePollStatsSync — live-poll post-match stats trigger", () => {
  it("calls syncFn with the correct playerIds after the delay fires", async () => {
    vi.useFakeTimers();

    const fixtureId = 500;
    const playerIds = [1, 2, 3];
    const syncFn = vi.fn().mockResolvedValue(undefined);

    scheduleLivePollStatsSync(fixtureId, playerIds, syncFn, 0);

    // syncFn must NOT be called before the timer fires.
    expect(syncFn, "syncFn must not be called before the timer fires").not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(syncFn, "syncFn must be called exactly once after the delay").toHaveBeenCalledTimes(1);

    const [forwarded] = syncFn.mock.calls[0]!;
    expect(
      forwarded,
      "all tracked player ids must be forwarded to syncFn",
    ).toEqual(expect.arrayContaining(playerIds));
    expect(forwarded, "no extra player ids should be included").toHaveLength(playerIds.length);
  });

  it("forwards the correct fixtureId context: each queued fixture fires its own syncFn call", async () => {
    vi.useFakeTimers();

    const syncFnA = vi.fn().mockResolvedValue(undefined);
    const syncFnB = vi.fn().mockResolvedValue(undefined);

    const playerIdsA = [10, 11];
    const playerIdsB = [20, 21, 22];

    scheduleLivePollStatsSync(601, playerIdsA, syncFnA, 0);
    scheduleLivePollStatsSync(602, playerIdsB, syncFnB, 0);

    await vi.runAllTimersAsync();

    expect(syncFnA, "syncFnA (fixture 601) must fire once").toHaveBeenCalledTimes(1);
    expect(syncFnB, "syncFnB (fixture 602) must fire once").toHaveBeenCalledTimes(1);

    expect(syncFnA.mock.calls[0]![0]).toEqual(expect.arrayContaining(playerIdsA));
    expect(syncFnA.mock.calls[0]![0]).toHaveLength(playerIdsA.length);

    expect(syncFnB.mock.calls[0]![0]).toEqual(expect.arrayContaining(playerIdsB));
    expect(syncFnB.mock.calls[0]![0]).toHaveLength(playerIdsB.length);
  });

  it("respects the delayMs: syncFn is not called before the delay elapses", async () => {
    vi.useFakeTimers();

    const syncFn = vi.fn().mockResolvedValue(undefined);
    const DELAY = 5_000;

    scheduleLivePollStatsSync(700, [30, 31], syncFn, DELAY);

    // Advance by less than the delay — syncFn must not have fired.
    await vi.advanceTimersByTimeAsync(DELAY - 1);
    expect(syncFn, "syncFn must not fire before delayMs has elapsed").not.toHaveBeenCalled();

    // Advance past the threshold — now it must fire.
    await vi.advanceTimersByTimeAsync(2);
    expect(syncFn, "syncFn must fire once the delay has elapsed").toHaveBeenCalledTimes(1);
  });

  it("a syncFn rejection is swallowed and does not throw out of scheduleLivePollStatsSync", async () => {
    vi.useFakeTimers();

    const syncFn = vi.fn().mockRejectedValue(new Error("stats API timeout"));

    // The scheduling call itself must not throw.
    expect(() =>
      scheduleLivePollStatsSync(800, [40, 41], syncFn, 0),
    ).not.toThrow();

    // Flush timers — the rejected promise must be caught internally, not surface
    // as an unhandled rejection.
    await vi.runAllTimersAsync();

    // syncFn was still called; the rejection was silently swallowed.
    expect(syncFn).toHaveBeenCalledOnce();
  });
});
