import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  claim: vi.fn<(name: string, cooldown: number) => Promise<boolean>>(),
  parseURL: vi.fn(),
  select: vi.fn(),
}));
vi.mock("../syncGuard.js", () => ({ claimSyncRun: state.claim }));
vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("rss-parser", () => ({
  default: class { parseURL = state.parseURL; },
}));
vi.mock("@workspace/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/db")>(),
  db: { select: state.select },
}));

let provider: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubEnv("API_FOOTBALL_KEY", "mock-provider-credential");
  state.claim.mockResolvedValue(false);
  state.parseURL.mockResolvedValue({ items: [] });
  state.select.mockImplementation(() => ({
    from: () => Object.assign(Promise.resolve([]), {
      where: async () => [{
        id: 1, apiFootballFixtureId: 931001,
        homeScore: 0, awayScore: 0, elapsedMinute: 10,
      }],
    }),
  }));
  // Nothing in this file can reach a real provider, feed, or database.
  provider = vi.fn(async () => new Response(JSON.stringify({ response: [], errors: [] })));
  vi.stubGlobal("fetch", provider);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("scheduled sync claims — change verifying", () => {
  it.each([undefined, "1000"])("2: denied live poll skips provider; interval=%s", async intervalEnv => {
    vi.stubEnv("LIVE_POLL_INTERVAL_MS", intervalEnv);
    const interval = intervalEnv === undefined ? 5 * 60 * 1000 : Number(intervalEnv);
    const { startApiFootballSyncSchedule } = await import("../apiFootballSync.js");
    startApiFootballSyncSchedule();
    await vi.advanceTimersByTimeAsync(interval);
    expect(provider).not.toHaveBeenCalled();
    expect(state.claim).toHaveBeenCalledWith("livePoll", interval * 0.8);
    expect(state.claim).toHaveBeenCalledWith("fixtures", 50 * 60 * 1000);
    // A denial must release the existing local mutex so the next tick can run.
    state.claim.mockImplementation(async name => name === "livePoll");
    await vi.advanceTimersByTimeAsync(interval);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(String(provider.mock.calls[0]?.[0])).toContain("/fixtures?id=931001");
  });

  it("3: denied startup RSS claim skips all feeds; next allowed interval still imports", async () => {
    const { startRssIngestionSchedule } = await import("../rssIngest.js");
    startRssIngestionSchedule();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.parseURL).not.toHaveBeenCalled();
    expect(state.select).not.toHaveBeenCalled();
    expect(state.claim).toHaveBeenCalledWith("rssIngest", 12 * 60 * 1000);
    state.claim.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(state.parseURL).toHaveBeenCalledTimes(3);
  });

  it("3: denied recurring RSS claim skips feeds after an allowed startup import", async () => {
    state.claim.mockResolvedValue(true);
    const { startRssIngestionSchedule } = await import("../rssIngest.js");
    startRssIngestionSchedule();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.parseURL).toHaveBeenCalledTimes(3);
    state.parseURL.mockClear();
    state.claim.mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(state.parseURL).not.toHaveBeenCalled();
    expect(state.claim).toHaveBeenLastCalledWith("rssIngest", 12 * 60 * 1000);
  });
});
