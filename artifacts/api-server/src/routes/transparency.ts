import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, transparencyMonthsTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();

// ── Admin auth ────────────────────────────────────────────────────────────────

/**
 * Middleware that gates write/admin endpoints behind ADMIN_PASSWORD.
 * Callers supply `Authorization: Bearer <ADMIN_PASSWORD>`.
 */
function requireAdminPassword(req: Request, res: Response, next: NextFunction): void {
  const password = process.env["ADMIN_PASSWORD"];
  if (!password) {
    res.status(503).json({ error: "Admin panel is not configured on this server" });
    return;
  }
  const auth = req.headers["authorization"] ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const tokenBuf = Buffer.from(token);
  const passBuf = Buffer.from(password);
  const match = tokenBuf.length === passBuf.length && timingSafeEqual(tokenBuf, passBuf);
  if (!match) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// ── Public read endpoints ─────────────────────────────────────────────────────

/**
 * GET /transparency
 * All monthly records sorted chronologically (oldest first).
 * No auth required — public transparency data.
 */
router.get("/transparency", async (_req, res): Promise<void> => {
  const months = await db
    .select()
    .from(transparencyMonthsTable)
    .orderBy(transparencyMonthsTable.periodYear, transparencyMonthsTable.periodMonth);
  res.json({ months });
});

/**
 * GET /transparency/totals
 * All-time aggregate sums + month count.
 * No auth required.
 */
router.get("/transparency/totals", async (_req, res): Promise<void> => {
  const [totals] = await db
    .select({
      totalExpensesCents: sql<number>`coalesce(sum(${transparencyMonthsTable.expensesCents}), 0)::int`,
      totalDonationsCents: sql<number>`coalesce(sum(${transparencyMonthsTable.donationsCents}), 0)::int`,
      totalGoalFoundationCents: sql<number>`coalesce(sum(${transparencyMonthsTable.goalFoundationCents}), 0)::int`,
      monthCount: sql<number>`count(*)::int`,
    })
    .from(transparencyMonthsTable);

  res.json({
    totalExpensesCents: totals?.totalExpensesCents ?? 0,
    totalDonationsCents: totals?.totalDonationsCents ?? 0,
    totalGoalFoundationCents: totals?.totalGoalFoundationCents ?? 0,
    monthCount: totals?.monthCount ?? 0,
  });
});

// ── Admin write endpoints ─────────────────────────────────────────────────────
// All routes below require ADMIN_PASSWORD Bearer token.

/**
 * POST /admin/transparency/verify
 * Returns 200 OK if the password is correct. Used by the frontend to validate
 * credentials before storing them in sessionStorage.
 */
router.post("/admin/transparency/verify", requireAdminPassword, (_req, res): void => {
  res.json({ ok: true });
});

/**
 * POST /admin/transparency
 * Create a new monthly record. Body: { periodYear, periodMonth, expensesCents,
 * donationsCents, goalFoundationCents, invoiceUrl?, notes? }
 */
router.post("/admin/transparency", requireAdminPassword, async (req, res): Promise<void> => {
  const body = req.body as {
    periodYear?: number;
    periodMonth?: number;
    expensesCents?: number;
    donationsCents?: number;
    goalFoundationCents?: number;
    invoiceUrl?: string | null;
    notes?: string | null;
  };

  if (!body.periodYear || !body.periodMonth) {
    res.status(400).json({ error: "periodYear and periodMonth are required" });
    return;
  }

  try {
    const [row] = await db
      .insert(transparencyMonthsTable)
      .values({
        periodYear: body.periodYear,
        periodMonth: body.periodMonth,
        expensesCents: body.expensesCents ?? 0,
        donationsCents: body.donationsCents ?? 0,
        goalFoundationCents: body.goalFoundationCents ?? 0,
        invoiceUrl: body.invoiceUrl ?? null,
        notes: body.notes ?? null,
      })
      .returning();
    logger.info({ id: row?.id, period: `${body.periodYear}-${body.periodMonth}` }, "Admin: transparency month created");
    res.status(201).json({ ok: true, month: row });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      res.status(409).json({ error: "A record for this month already exists" });
    } else {
      logger.error({ err }, "Admin: create transparency month failed");
      res.status(500).json({ error: "Failed to create record" });
    }
  }
});

/**
 * PUT /admin/transparency/:id
 * Update an existing monthly record.
 */
router.put("/admin/transparency/:id", requireAdminPassword, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const body = req.body as {
    expensesCents?: number;
    donationsCents?: number;
    goalFoundationCents?: number;
    invoiceUrl?: string | null;
    notes?: string | null;
  };

  const [updated] = await db
    .update(transparencyMonthsTable)
    .set({
      expensesCents: body.expensesCents,
      donationsCents: body.donationsCents,
      goalFoundationCents: body.goalFoundationCents,
      invoiceUrl: body.invoiceUrl,
      notes: body.notes,
      updatedAt: new Date(),
    })
    .where(eq(transparencyMonthsTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Record not found" });
    return;
  }

  logger.info({ id }, "Admin: transparency month updated");
  res.json({ ok: true, month: updated });
});

/**
 * DELETE /admin/transparency/:id
 * Remove a monthly record.
 */
router.delete("/admin/transparency/:id", requireAdminPassword, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [deleted] = await db
    .delete(transparencyMonthsTable)
    .where(eq(transparencyMonthsTable.id, id))
    .returning({ id: transparencyMonthsTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Record not found" });
    return;
  }

  logger.info({ id }, "Admin: transparency month deleted");
  res.json({ ok: true });
});

/**
 * POST /admin/transparency/upload-url
 * Returns a presigned GCS upload URL for invoice file uploads.
 * Body: { name: string, size: number, contentType: string }
 * Returns: { uploadUrl: string, objectPath: string }
 */
router.post("/admin/transparency/upload-url", requireAdminPassword, async (req, res): Promise<void> => {
  const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
  if (!bucketId) {
    res.status(503).json({ error: "Object storage is not configured" });
    return;
  }

  try {
    const service = new ObjectStorageService();
    const uploadUrl = await service.getObjectEntityUploadURL();
    // normalizeObjectEntityPath converts the full GCS URL to a local /objects/... path
    const objectPath = service.normalizeObjectEntityPath(uploadUrl);
    res.json({ uploadUrl, objectPath });
  } catch (err) {
    logger.error({ err }, "Admin: invoice upload URL generation failed");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

export default router;
