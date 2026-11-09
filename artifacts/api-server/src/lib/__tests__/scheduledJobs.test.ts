/**
 * Daily/weekly jobs run when due, driven by the cron tick instead of 24-hour
 * timers. Dev database: sync_metadata rows under throwaway job names
 * (removed in afterAll). The jobs here are stand-ins; no real sync runs.
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { db, syncMetadataTable } from "@workspace/db";
import { eq, like } from "drizzle-orm";
import { APP_JOBS, dailyAt, every, runDueJobs, type ScheduledJob } from "../scheduledJobs";

const RUN = `__jobtest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (iso: string) => new Date(iso);

function job(suffix: string, overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    name: `${RUN}-${suffix}`,
    isDue: (lastOk) => !lastOk,
    maxRunMs: HOUR,
    run: vi.fn(async () => {}),
    ...overrides,
  };
}

async function okRow(name: string) {
  const [row] = await db.select().from(syncMetadataTable).where(eq(syncMetadataTable.syncName, `${name}:ok`));
  return row ?? null;
}

afterAll(async () => {
  await db.delete(syncMetadataTable).where(like(syncMetadataTable.syncName, `${RUN}%`));
});

describe("schedules", () => {
  it("1: dailyAt(9) is due once per day, after 09:00 UTC", () => {
    const due = dailyAt(9);
    expect(due(null, at("2099-07-01T08:00:00Z"))).toBe(true);
    // Ran yesterday after 09:00: not due again until today's 09:00.
    expect(due(at("2099-06-30T10:00:00Z"), at("2099-07-01T08:59:00Z"))).toBe(false);
    expect(due(at("2099-06-30T10:00:00Z"), at("2099-07-01T09:01:00Z"))).toBe(true);
    // Ran today after 09:00: not due for the rest of the day.
    expect(due(at("2099-07-01T09:05:00Z"), at("2099-07-01T23:59:00Z"))).toBe(false);
    // Last ran before yesterday's boundary (missed days): due straight away.
    expect(due(at("2099-06-28T12:00:00Z"), at("2099-07-01T03:00:00Z"))).toBe(true);
  });

  it("2: every(7) is due a week (less an hour) after the last success", () => {
    const due = every(7);
    const last = at("2099-07-01T09:00:00Z");
    expect(due(last, new Date(last.getTime() + 6 * DAY))).toBe(false);
    expect(due(last, new Date(last.getTime() + 7 * DAY - 30 * 60 * 1000))).toBe(true);
    expect(due(null, last)).toBe(true);
  });

  it("3: keeps the old schedule names, so production's run history carries over", () => {
    expect(APP_JOBS.map((j) => j.name)).toEqual(
      expect.arrayContaining(["playerClub", "playerStats", "nationalTeamCaps", "eurUsdRate"]),
    );
  });
});

describe("runDueJobs", () => {
  it("4: starts a due job once and records its success, so it isn't due again", async () => {
    const j = job("ok");
    const first = await runDueJobs([j]);
    expect(first.started).toEqual([j.name]);
    await first.finished;
    expect(j.run).toHaveBeenCalledTimes(1);
    expect(await okRow(j.name)).not.toBeNull();

    const second = await runDueJobs([j]);
    await second.finished;
    expect(second.started).toEqual([]);
    expect(j.run).toHaveBeenCalledTimes(1);
  });

  it("5: a failed run isn't recorded as a success, and is retried only after its run window", async () => {
    const run = vi.fn(async () => { throw new Error("provider down"); });
    const slow = job("fail-slow", { run, maxRunMs: HOUR });
    await (await runDueJobs([slow])).finished;
    expect(await okRow(slow.name)).toBeNull();
    // Still inside the hour: the claim blocks a second start.
    expect((await runDueJobs([slow])).started).toEqual([]);

    const fast = job("fail-fast", { run, maxRunMs: 1 });
    await (await runDueJobs([fast])).finished;
    await new Promise((r) => setTimeout(r, 25));
    // Window passed and still no success: started again (the old 23-hour claim waited a day).
    const retry = await runDueJobs([fast]);
    await retry.finished;
    expect(retry.started).toEqual([fast.name]);
  });

  it("6: a job still running in this process isn't started twice, even past its window", async () => {
    let release!: () => void;
    const j = job("long", { maxRunMs: 1, run: vi.fn(() => new Promise<void>((r) => { release = r; })) });
    const first = await runDueJobs([j]);
    await new Promise((r) => setTimeout(r, 25));
    const second = await runDueJobs([j]);
    expect(first.started).toEqual([j.name]);
    expect(second.started).toEqual([]);
    release();
    await first.finished;
    expect(j.run).toHaveBeenCalledTimes(1);
  });

  it("7: skips a disabled job without claiming it", async () => {
    const j = job("off", { enabled: () => false });
    expect((await runDueJobs([j])).started).toEqual([]);
    expect(j.run).not.toHaveBeenCalled();
    const [claim] = await db.select().from(syncMetadataTable).where(eq(syncMetadataTable.syncName, j.name));
    expect(claim).toBeUndefined();
  });

  it("8: a job that isn't due isn't claimed or run", async () => {
    const j = job("notdue", { isDue: () => false });
    expect((await runDueJobs([j])).started).toEqual([]);
    expect(j.run).not.toHaveBeenCalled();
  });
});
