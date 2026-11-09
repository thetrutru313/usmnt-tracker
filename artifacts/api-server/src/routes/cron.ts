import { Router, type IRouter } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { claimSyncRun } from "../lib/syncGuard";
import { runTick } from "../lib/tick";
import { APP_JOBS, runDueJobs } from "../lib/scheduledJobs";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/** Ticks closer together than this are skipped (the cron runs every 5 min). */
export const TICK_COOLDOWN_MS = 4 * 60 * 1000;

// Compare digests so the check takes the same time whatever the input length.
function secretMatches(supplied: string, secret: string): boolean {
  const a = createHash("sha256").update(supplied).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

/**
 * POST /cron/tick
 * Called every 5 minutes by an external cron service with
 * `Authorization: Bearer <CRON_SECRET>`. Does the time-sensitive work —
 * match status, lineups, goals, post-match stats, alerts — inside the request,
 * because Autoscale only reliably runs code while a request is open.
 * It also starts any daily or weekly job that's due (they run in the
 * background; see scheduledJobs.ts).
 */
router.post("/cron/tick", async (req, res): Promise<void> => {
  const secret = process.env["CRON_SECRET"]?.trim();
  if (!secret) {
    res.status(503).json({ error: "Cron is not configured on this server" });
    return;
  }
  const auth = req.headers["authorization"] ?? "";
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!supplied || !secretMatches(supplied, secret)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // A few quick reads; started jobs run on after the response.
  const { started: jobsStarted } = await runDueJobs(APP_JOBS);
  if (!(await claimSyncRun("cronTick", TICK_COOLDOWN_MS))) {
    res.json({ skipped: "ran recently", jobsStarted });
    return;
  }
  try {
    const summary = await runTick();
    if (summary.fixturesChecked > 0 || summary.postMatchRuns > 0) logger.info(summary, "Cron tick");
    res.json({ ...summary, jobsStarted });
  } catch (err) {
    logger.error({ err }, "Cron tick failed");
    res.status(500).json({ error: "Tick failed" });
  }
});

export default router;
