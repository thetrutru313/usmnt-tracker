import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("../logger", () => ({ logger: { error: state.error, warn: vi.fn(), info: vi.fn() } }));

import { installUnhandledRejectionLogger, runNonFatal } from "../startupGuards";

describe("runNonFatal", () => {
  beforeEach(() => state.error.mockClear());

  it("1: a failing startup task is logged and startup carries on", async () => {
    const boom = new Error("Connection terminated unexpectedly");
    await expect(runNonFatal("seedLeagueStrengthDefaults", () => Promise.reject(boom))).resolves.toBeUndefined();
    expect(state.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: boom, task: "seedLeagueStrengthDefaults" }),
      expect.any(String),
    );
  });

  it("2: a task that succeeds returns its result and logs nothing", async () => {
    await expect(runNonFatal("ok", async () => 42)).resolves.toBe(42);
    expect(state.error).not.toHaveBeenCalled();
  });
});

describe("installUnhandledRejectionLogger", () => {
  let before: number;
  beforeEach(() => {
    state.error.mockClear();
    before = process.listenerCount("unhandledRejection");
  });
  afterEach(() => {
    process.removeListener("unhandledRejection", installUnhandledRejectionLogger());
  });

  it("3: logs an unhandled rejection instead of crashing", () => {
    const handler = installUnhandledRejectionLogger();
    const reason = new Error("background sync failed");
    handler(reason);
    expect(state.error).toHaveBeenCalledWith(expect.objectContaining({ err: reason }), expect.any(String));
  });

  it("4: installing twice adds only one listener", () => {
    const first = installUnhandledRejectionLogger();
    const second = installUnhandledRejectionLogger();
    expect(second).toBe(first);
    expect(process.listenerCount("unhandledRejection")).toBeLessThanOrEqual(before + 1);
    expect(process.listeners("unhandledRejection").filter((l) => l === first)).toHaveLength(1);
  });
});
