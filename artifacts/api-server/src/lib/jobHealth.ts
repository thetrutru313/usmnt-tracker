/**
 * Health of the daily/weekly jobs (review R2), served at GET /api/healthz/jobs.
 *
 * A job is unhealthy when:
 *   - it's stale: it has been due for more than STALE_AFTER_MS without a
 *     successful run (it keeps failing, or nothing is starting it), or
 *   - its last run was partial (most of its work failed, e.g. the provider's
 *     limit ran out), including a partial retry that was counted as done.
 *
 * The endpoint answers 503 when any enabled job is unhealthy, so an external
 * monitor (cron-job.org) can alert on it. Error text stays in the database.
 */
import { APP_JOBS, lastSuccess, readLastRun, type JobOutcome, type ScheduledJob } from "./scheduledJobs";

/** How long a job may stay due without succeeding (retries included) before it's stale. */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export type JobHealth = {
  name: string;
  enabled: boolean;
  lastSuccessAt: string | null;
  lastRun: { outcome: JobOutcome; startedAt: string; finishedAt: string; problem?: string } | null;
  stale: boolean;
  healthy: boolean;
};

export type JobsHealthReport = {
  status: "ok" | "unhealthy";
  checkedAt: string;
  jobs: JobHealth[];
};

export async function jobsHealth(jobs: ScheduledJob[] = APP_JOBS, now = new Date()): Promise<JobsHealthReport> {
  const report: JobHealth[] = [];
  for (const job of jobs) {
    const enabled = !job.enabled || job.enabled();
    const lastOk = await lastSuccess(job.name);
    const run = await readLastRun(job.name);
    const lastRun = run
      ? { outcome: run.outcome, startedAt: run.startedAt, finishedAt: run.finishedAt, ...(run.problem ? { problem: run.problem } : {}) }
      : null;
    // Stale = it was already due STALE_AFTER_MS ago and still hasn't succeeded.
    const stale = enabled && job.isDue(lastOk, new Date(now.getTime() - STALE_AFTER_MS));
    const healthy = !enabled || (!stale && lastRun?.outcome !== "partial");
    report.push({ name: job.name, enabled, lastSuccessAt: lastOk?.toISOString() ?? null, lastRun, stale, healthy });
  }
  return {
    status: report.every((j) => j.healthy) ? "ok" : "unhealthy",
    checkedAt: now.toISOString(),
    jobs: report,
  };
}
