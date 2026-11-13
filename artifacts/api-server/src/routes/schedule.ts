import { Router, type IRouter } from "express";
import { db, scheduleEventsTable, fixturesTable } from "@workspace/db";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import { requireAdminSession } from "../lib/adminAuth";
import { seniorNtFixtureCondition } from "../lib/queries";
import { matchWindowEnd, matchWindowStart } from "../lib/scheduleWindow";

const router: IRouter = Router();

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

  // Find events that have both startDate and endDate set so we can attach
  // any NT fixtures whose kickoff falls within that window.
  const windowedEvents = events.filter((e) => e.startDate != null && e.endDate != null);

  type NtFixtureRow = typeof fixturesTable.$inferSelect;
  const fixturesByEvent = new Map<number, NtFixtureRow[]>();
  if (windowedEvents.length > 0) {
    // Compute the global bounding box and do a single batch query.
    const minStart = windowedEvents
      .map((e) => e.startDate as string)
      .sort()[0]!;
    const maxEndDate = windowedEvents
      .map((e) => e.endDate as string)
      .sort()
      .at(-1)!;
    const maxEndExclusive = matchWindowEnd(maxEndDate);

    const ntFixtures = await db
      .select()
      .from(fixturesTable)
      .where(
        and(
          seniorNtFixtureCondition,
          gte(fixturesTable.kickoff, matchWindowStart(minStart)),
          lt(fixturesTable.kickoff, maxEndExclusive),
        ),
      )
      .orderBy(asc(fixturesTable.kickoff));

    // Group fixtures by the event they fall within.
    for (const event of windowedEvents) {
      const start = matchWindowStart(event.startDate as string);
      const endExclusive = matchWindowEnd(event.endDate as string);

      const matching = ntFixtures.filter(
        (f) => f.kickoff >= start && f.kickoff < endExclusive,
      );
      fixturesByEvent.set(event.id, matching);
    }
  }

  const eventsWithFixtures = events.map((event) => ({
    ...event,
    fixtures: (fixturesByEvent.get(event.id) ?? []).map((f) => ({
      ...f,
      featuredPlayers: [],
    })),
  }));

  res.json({ events: eventsWithFixtures });
});

// ---------------------------------------------------------------------------
// GET /api/admin/schedule  — list all events (admin)
// ---------------------------------------------------------------------------
router.get("/admin/schedule", requireAdminSession, async (_req, res): Promise<void> => {
  const events = await db
    .select()
    .from(scheduleEventsTable)
    .orderBy(asc(scheduleEventsTable.sortOrder), asc(scheduleEventsTable.startDate));

  res.json({ events });
});

// ---------------------------------------------------------------------------
// POST /api/admin/schedule  — create a new event
// ---------------------------------------------------------------------------
router.post("/admin/schedule", requireAdminSession, async (req, res): Promise<void> => {
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
router.put("/admin/schedule/:id", requireAdminSession, async (req, res): Promise<void> => {
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
router.delete("/admin/schedule/:id", requireAdminSession, async (req, res): Promise<void> => {
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
