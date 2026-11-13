import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { jobsHealth } from "../lib/jobHealth";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * GET /healthz/jobs — daily/weekly job health (lib/jobHealth.ts). 503 when
 * any job is stale or its last run was partial, for an external monitor.
 * /healthz itself stays a plain liveness check.
 */
router.get("/healthz/jobs", async (_req, res): Promise<void> => {
  const report = await jobsHealth();
  res.status(report.status === "ok" ? 200 : 503).json(report);
});

export default router;
