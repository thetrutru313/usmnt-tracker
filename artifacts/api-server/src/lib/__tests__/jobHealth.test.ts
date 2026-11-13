/**
 * Job outcomes and job health (review R2, and "a partial failure counts as
 * success").
 *
 * Change-verifying (fail before batch 2):
 * 1. A run that returns normally but mostly failed isn't a success: it's
 *    recorded as partial and retried once after its run window.
 * 2. A second partial run in a row counts as done (no retry every window),
 *    and the next period's first partial run gets its own retry.
 * 3. Each run's outcome is recorded (ok / failed with the error).
 * 4. jobsHealth: stale and partial jobs are unhealthy; disabled ones aren't.
 * 5. GET /api/healthz/jobs answers 503 when unhealthy, without error text.
 * 6. playerClub and playerStats judge their results.
 *
 * Dev database, throwaway job names; sync_metadata and server_config rows
 * are removed in afterAll. No real sync runs.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, serverConfigTable, syncMetadataTable } from "@workspace/db";
import { eq, like } from "drizzle-orm";
import { APP_JOBS, mostlyFailed, readLastRun, runDueJobs, type ScheduledJob } from "../scheduledJobs";
import { jobsHealth, STALE_AFTER_MS } from "../jobHealth";
import app from "../../app.js";

const RUN = `__jobhealth-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const HOUR = 60 * 60 * 1000;

function job(suffix: string, overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    name: `${RUN}-${suffix}`,
    isDue: (lastOk) => !lastOk,
    maxRunMs: 1,
    run: vi.fn(async () => ({ done: 10, failed: 0 })),
    problem: mostlyFailed("done", "failed"),
    ...overrides,
  };
}

async function okRow(name: string) {
  const [row] = await db.select().from(syncMetadataTable).where(eq(syncMetadataTable.syncName, `${name}:ok`));
  return row ?? null;
}

async function runOnce(j: ScheduledJob) {
  const result = await runDueJobs([j]);
  await result.finished;
  // Let the 1 ms claim window pass before the next attempt.
  await new Promise((r) => setTimeout(r, 25));
  return result.started;
}

afterAll(async () => {
  await db.delete(syncMetadataTable).where(like(syncMetadataTable.syncName, `${RUN}%`));
  await db.delete(serverConfigTable).where(like(serverConfigTable.key, `job.${RUN}%`));
});

describe("mostlyFailed", () => {
  it("is partial only when more units failed than succeeded", () => {
    const check = mostlyFailed("clubsProcessed", "failures");
    expect(check({ clubsProcessed: 40, failures: 3 })).toBeNull();
    expect(check({ clubsProcessed: 10, failures: 10 })).toBeNull();
    expect(check({ clubsProcessed: 4, failures: 50 })).toBe("50 failures vs 4 clubsProcessed");
    expect(check(undefined)).toBeNull();
  });
});

describe("run outcomes", () => {
  it("1: a mostly-failed run isn't a success, and is retried after its run window", async () => {
    const run = vi.fn(async () => ({ done: 2, failed: 30 }));
    const j = job("partial", { run });
    expect(await runOnce(j)).toEqual([j.name]);
    expect(await okRow(j.name)).toBeNull();
    expect(await readLastRun(j.name)).toMatchObject({ outcome: "partial", problem: "30 failed vs 2 done" });
    expect(await runOnce(j)).toEqual([j.name]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("2: a second partial run in a row counts as done; the next period gets its own retry", async () => {
    // Due when there's no success since the current period started.
    let periodStart = 0;
    const run = vi.fn(async () => ({ done: 0, failed: 9 }));
    const j = job("partial-twice", { run, isDue: (lastOk) => !lastOk || lastOk.getTime() < periodStart });
    await runOnce(j);
    await runOnce(j);
    const counted = await okRow(j.name);
    expect(counted).not.toBeNull();
    expect(await readLastRun(j.name)).toMatchObject({ outcome: "partial", counted: true });
    expect(await runOnce(j)).toEqual([]);

    // Next period (database clock, so app/database clock skew can't matter).
    periodStart = counted!.lastRunAt.getTime() + 1;
    expect(await runOnce(j)).toEqual([j.name]);
    const next = await readLastRun(j.name);
    expect(next).toMatchObject({ outcome: "partial" });
    expect(next?.counted).toBeUndefined();
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("3: records ok runs, and failed runs with their error", async () => {
    const ok = job("ok");
    await runOnce(ok);
    expect(await okRow(ok.name)).not.toBeNull();
    expect(await readLastRun(ok.name)).toMatchObject({ outcome: "ok" });

    const bad = job("throws", { run: vi.fn(async () => { throw new Error("provider down"); }) });
    await runOnce(bad);
    expect(await okRow(bad.name)).toBeNull();
    expect(await readLastRun(bad.name)).toMatchObject({ outcome: "failed", error: "provider down" });
  });
});

describe("jobsHealth", () => {
  it("4: stale and partial jobs are unhealthy; healthy and disabled jobs are fine", async () => {
    const fine = job("h-fine");
    await runOnce(fine);
    const partial = job("h-partial", { run: vi.fn(async () => ({ done: 0, failed: 5 })) });
    await runOnce(partial);
    // Never succeeded, and due since long before the stale window.
    const stale = job("h-stale", { isDue: () => true });
    const off = job("h-off", { isDue: () => true, enabled: () => false });

    const healthyOnly = await jobsHealth([fine, off]);
    expect(healthyOnly.status).toBe("ok");
    expect(healthyOnly.jobs.find((x) => x.name === off.name)).toMatchObject({ enabled: false, healthy: true });

    const report = await jobsHealth([fine, partial, stale, off]);
    expect(report.status).toBe("unhealthy");
    const byName = new Map(report.jobs.map((x) => [x.name, x]));
    expect(byName.get(fine.name)).toMatchObject({ healthy: true, stale: false, lastRun: { outcome: "ok" } });
    expect(byName.get(partial.name)).toMatchObject({ healthy: false, lastRun: { outcome: "partial" } });
    expect(byName.get(stale.name)).toMatchObject({ healthy: false, stale: true, lastSuccessAt: null });
  });

  it("4b: a job is stale only once it has been due for longer than the stale window", async () => {
    const dueSince = Date.now() - HOUR;
    const j = job("h-window", { isDue: (lastOk, now) => !lastOk && now.getTime() >= dueSince });
    expect((await jobsHealth([j])).jobs[0]).toMatchObject({ stale: false });
    const later = new Date(dueSince + STALE_AFTER_MS + HOUR);
    expect((await jobsHealth([j], later)).jobs[0]).toMatchObject({ stale: true });
  });
});

describe("GET /api/healthz/jobs", () => {
  it("5: reports every app job, 503 when unhealthy, and never serves error text", async () => {
    const res = await request(app).get("/api/healthz/jobs");
    expect([200, 503]).toContain(res.status);
    expect(res.status === 200).toBe(res.body.status === "ok");
    expect(res.body.jobs.map((j: { name: string }) => j.name)).toEqual(APP_JOBS.map((j) => j.name));
    expect(JSON.stringify(res.body)).not.toContain('"error"');
  });

  it("guard: /api/healthz is still a plain 200 ok", async () => {
    const res = await request(app).get("/api/healthz").expect(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("app jobs", () => {
  it("6: playerClub and playerStats are judged on their failure counts", () => {
    const byName = new Map(APP_JOBS.map((j) => [j.name, j]));
    expect(byName.get("playerClub")?.problem?.({ playersChecked: 3, failures: 200 })).toMatch(/failures/);
    expect(byName.get("playerClub")?.problem?.({ playersChecked: 250, failures: 12 })).toBeNull();
    expect(byName.get("playerStats")?.problem?.({ clubsProcessed: 2, failures: 90 })).toMatch(/failures/);
    expect(byName.get("playerStats")?.problem?.({ clubsProcessed: 150, failures: 4 })).toBeNull();
  });
});
