import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, scheduleEventsTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Auth guard (same pattern as admin.ts)
// ---------------------------------------------------------------------------
function requireAdminToken(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) {
    res.status(503).json({ error: "Admin endpoints are not configured on this server" });
    return;
  }
  const auth = req.headers["authorization"] ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------
const EventKindValues = ["friendly", "nations-league", "gold-cup", "copa-america", "world-cup-qualifying", "world-cup"] as const;
const EventStatusValues = ["confirmed", "approximate", "tbd"] as const;

const upsertEventBody = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(EventKindValues),
  status: z.enum(EventStatusValues),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  dateLabel: z.string().min(1),
  description: z.string().min(1),
  sortOrder: z.number().int().default(0),
});

// ---------------------------------------------------------------------------
// GET /api/schedule  — public, no auth required
// ---------------------------------------------------------------------------
router.get("/schedule", async (_req, res): Promise<void> => {
  const events = await db
    .select()
    .from(scheduleEventsTable)
    .orderBy(asc(scheduleEventsTable.sortOrder), asc(scheduleEventsTable.startDate));

  res.json({ events });
});

// ---------------------------------------------------------------------------
// GET /api/admin/schedule  — list all events (admin)
// ---------------------------------------------------------------------------
router.get("/admin/schedule", requireAdminToken, async (_req, res): Promise<void> => {
  const events = await db
    .select()
    .from(scheduleEventsTable)
    .orderBy(asc(scheduleEventsTable.sortOrder), asc(scheduleEventsTable.startDate));

  res.json({ events });
});

// ---------------------------------------------------------------------------
// POST /api/admin/schedule  — create a new event
// ---------------------------------------------------------------------------
router.post("/admin/schedule", requireAdminToken, async (req, res): Promise<void> => {
  const parsed = upsertEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }

  const [created] = await db
    .insert(scheduleEventsTable)
    .values({ ...parsed.data, updatedAt: new Date() })
    .returning();

  res.status(201).json({ event: created });
});

// ---------------------------------------------------------------------------
// PUT /api/admin/schedule/:id  — replace an event by numeric id
// ---------------------------------------------------------------------------
router.put("/admin/schedule/:id", requireAdminToken, async (req, res): Promise<void> => {
  const idParam = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
  const id = parseInt(idParam ?? "", 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid event id" });
    return;
  }

  const parsed = upsertEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }

  const [updated] = await db
    .update(scheduleEventsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(scheduleEventsTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Schedule event not found" });
    return;
  }

  res.json({ event: updated });
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/schedule/:id  — remove an event
// ---------------------------------------------------------------------------
router.delete("/admin/schedule/:id", requireAdminToken, async (req, res): Promise<void> => {
  const idParam = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
  const id = parseInt(idParam ?? "", 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid event id" });
    return;
  }

  const [deleted] = await db
    .delete(scheduleEventsTable)
    .where(eq(scheduleEventsTable.id, id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Schedule event not found" });
    return;
  }

  res.status(204).end();
});

export default router;
