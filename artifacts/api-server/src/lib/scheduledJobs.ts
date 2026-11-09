/**
 * Daily and weekly jobs, run when they're due rather than on in-process timers.
 *
 * Why: on Autoscale an instance rarely lives 24 hours, so a 24-hour
 * setInterval almost never fires, and the daily syncs only ran when a new
 * instance happened to start. If that instance was replaced mid-run, the
 * claim (written before the run) blocked a retry for 23 hours. In production
 * the club match logs went six days (3–8 Nov 2026) without a completed run.
 *
 * How:
 *   - `sync_metadata` keeps two rows per job: `<name>` (last start, via
 *     claimSyncRun) and `<name>:ok` (last successful finish).
 *   - A job is due when its last success is older than its schedule allows.
 *   - The claim's cooldown is the job's longest expected run, so a run that
 *     died is retried after that, not the next day.
 *   - runDueJobs() is called by the 5-minute cron tick (production) and on a
 *     30-minute timer from server start (dev, and any long-lived instance).
 *     The claim stops two callers from starting the same job.
 *   - Jobs run in the background; the tick doesn't wait for them.
 */
import { db, syncMetadataTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { claimSyncRun } from "./syncGuard";
import { logger } from "./logger";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type ScheduledJob = {
  /** sync_metadata name. Kept the same as the old timer-based schedules. */
  name: string;
  /** Whether the job should start, given its last successful finish. */
  isDue: (lastOk: Date | null, now: Date) => boolean;
  /** Longest a healthy run takes. A run that started longer ago than this and never finished is retried. */
  maxRunMs: number;
  /** Jobs that need a provider key skip themselves when it isn't set. */
  enabled?: () => boolean;
  run: () => Promise<unknown>;
};

/**
 * Due once per day, at or after `hourUtc`: due when the last success was
 * before the most recent `hourUtc` boundary. 09:00 UTC is 2–3 am in Denver,
 * after the evening matches and before anyone checks the app.
 */
export function dailyAt(hourUtc: number): ScheduledJob["isDue"] {
  return (lastOk, now) => {
    let boundary = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc);
    if (boundary > now.getTime()) boundary -= DAY_MS;
    return !lastOk || lastOk.getTime() < boundary;
  };
}

/** Due when the last success is at least `days` old (with an hour's slack so it doesn't drift later each week). */
export function every(days: number): ScheduledJob["isDue"] {
  return (lastOk, now) => !lastOk || now.getTime() - lastOk.getTime() >= days * DAY_MS - HOUR_MS;
}

const okName = (name: string) => `${name}:ok`;

async function lastSuccess(name: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: syncMetadataTable.lastRunAt })
    .from(syncMetadataTable)
    .where(eq(syncMetadataTable.syncName, okName(name)));
  return row?.at ?? null;
}

async function recordSuccess(name: string): Promise<void> {
  await db
    .insert(syncMetadataTable)
    .values({ syncName: okName(name), lastRunAt: sql`now()` })
    .onConflictDoUpdate({ target: syncMetadataTable.syncName, set: { lastRunAt: sql`now()` } });
}

/** Jobs running in this process, so one still going past maxRunMs isn't started twice here. */
const running = new Set<string>();

async function runJob(job: ScheduledJob): Promise<void> {
  running.add(job.name);
  const started = Date.now();
  try {
    await job.run();
    await recordSuccess(job.name);
    logger.info({ job: job.name, minutes: Math.round((Date.now() - started) / 60_000) }, "Scheduled job finished");
  } catch (err) {
    logger.error({ err, job: job.name }, "Scheduled job failed — will retry after its run window");
  } finally {
    running.delete(job.name);
  }
}

export type DueJobsResult = {
  /** Names of the jobs started by this call. */
  started: string[];
  /** Resolves when every started job has finished (tests wait on it; the tick doesn't). */
  finished: Promise<void>;
};

/** Start every job that's due. Never throws. */
export async function runDueJobs(jobs: ScheduledJob[], now = new Date()): Promise<DueJobsResult> {
  const started: string[] = [];
  const runs: Promise<void>[] = [];
  for (const job of jobs) {
    try {
      if (job.enabled && !job.enabled()) continue;
      if (running.has(job.name)) continue;
      if (!job.isDue(await lastSuccess(job.name), now)) continue;
      if (!(await claimSyncRun(job.name, job.maxRunMs))) continue;
      started.push(job.name);
      runs.push(runJob(job));
    } catch (err) {
      logger.warn({ err, job: job.name }, "Could not check whether a scheduled job is due");
    }
  }
  if (started.length > 0) logger.info({ started }, "Scheduled jobs started");
  return { started, finished: Promise.all(runs).then(() => undefined) };
}

// ─── The app's jobs ──────────────────────────────────────────────────────────

const hasApiFootballKey = () => Boolean(process.env["API_FOOTBALL_KEY"]);

/**
 * Loaded lazily so importing this module (the cron route, tests) doesn't load
 * every sync. Order matters only loosely: clubs before stats, so stats are
 * fetched for each player's current club; all API-Football calls share one
 * rate-limited queue.
 */
export const APP_JOBS: ScheduledJob[] = [
  {
    name: "playerClub",
    isDue: dailyAt(9),
    maxRunMs: 2 * HOUR_MS,
    enabled: hasApiFootballKey,
    run: async () => (await import("./playerClubSync.js")).syncPlayerClubs(),
  },
  {
    // Club stats, match logs and injuries, then USMNT stats and the
    // commitment sweep, which need the fresh stats (same chain as before).
    name: "playerStats",
    isDue: dailyAt(9),
    maxRunMs: 2 * HOUR_MS,
    enabled: hasApiFootballKey,
    run: async () => {
      const { syncPlayerStatsAndInjuries } = await import("./playerStatsSync.js");
      const { syncUsmntStats } = await import("./usmntSync.js");
      const { runCommitmentSweep } = await import("./commitmentTracker.js");
      await syncPlayerStatsAndInjuries();
      await syncUsmntStats();
      await runCommitmentSweep().catch((err) =>
        logger.error({ err }, "Commitment sweep (chained after daily stats sync) failed"),
      );
    },
  },
  {
    // Caps and goals from Wikipedia. No API key needed.
    name: "nationalTeamCaps",
    isDue: dailyAt(9),
    maxRunMs: HOUR_MS,
    run: async () => (await import("./nationalTeamSync.js")).syncNationalTeamCapsAndGoals(),
  },
  {
    // ECB EUR→USD rate (published ~15:00 UTC on working days), then
    // re-convert hand-entered market values to dollars.
    name: "eurUsdRate",
    isDue: dailyAt(16),
    maxRunMs: 30 * 60 * 1000,
    run: async () => (await import("./marketValues.js")).refreshEurUsd(),
  },
  {
    // Re-scores candidates from stored signals.
    name: "candidateRescore",
    isDue: every(7),
    maxRunMs: HOUR_MS,
    enabled: hasApiFootballKey,
    run: async () => (await import("./playerDiscovery.js")).rescoreAllCandidates(),
  },
];

let timer: NodeJS.Timeout | null = null;

/** Check now, then every 30 minutes while this instance is up. */
export function startScheduledJobs(intervalMs = 30 * 60 * 1000): void {
  const check = () => void runDueJobs(APP_JOBS).catch((err) => logger.error({ err }, "Scheduled job check failed"));
  check();
  timer = setInterval(check, intervalMs);
}

export function stopScheduledJobs(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
