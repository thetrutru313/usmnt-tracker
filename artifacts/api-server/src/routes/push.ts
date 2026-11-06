import { Router, type IRouter } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { and, count, eq } from "drizzle-orm";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { requireAnonUser } from "../lib/anonAuth";
import { isAllowedPushEndpoint, sendPush, vapidPublicKey } from "../lib/push";

const router: IRouter = Router();

/** Devices one anonymous user may register for alerts. */
export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 10;

const PrefsSchema = z
  .object({
    kickoff: z.boolean(),
    lineups: z.boolean(),
    goals: z.boolean(),
    ratings: z.boolean(),
    announcements: z.boolean(),
    injuries: z.boolean(),
    transfers: z.boolean(),
    scope: z.enum(["mine", "all"]),
  })
  .strict();

// Browser keys are base64url; generous bounds, no other characters.
const KeySchema = z.string().min(16).max(256).regex(/^[A-Za-z0-9_-]+=*$/);

const EndpointSchema = z
  .string()
  .max(2048)
  .refine(isAllowedPushEndpoint, { message: "Unsupported push endpoint" });

const PutBody = z.object({
  subscription: z.object({
    endpoint: EndpointSchema,
    keys: z.object({ p256dh: KeySchema, auth: KeySchema }),
  }),
  prefs: PrefsSchema,
});

const EndpointBody = z.object({ endpoint: z.string().max(2048) });

const testLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many test alerts, please try again later." },
});

/**
 * GET /push/config
 * The public key browsers subscribe with. `publicKey` is null when the
 * VAPID_* Secrets aren't set, and the app then shows alerts as unavailable.
 */
router.get("/push/config", (_req, res): void => {
  res.json({ publicKey: vapidPublicKey() });
});

/**
 * PUT /push/subscription
 * Save this device's subscription and alert choices (insert or update by
 * endpoint). A device that moves to another anon user (e.g. after recovery)
 * is reassigned to the caller.
 */
router.put("/push/subscription", requireAnonUser, async (req, res): Promise<void> => {
  const parsed = PutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
    return;
  }
  const user = res.locals.anonUser;
  const { subscription, prefs } = parsed.data;

  const [existing] = await db
    .select({ anonUserId: pushSubscriptionsTable.anonUserId })
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, subscription.endpoint))
    .limit(1);
  if (!existing || existing.anonUserId !== user.id) {
    const [row] = await db
      .select({ n: count() })
      .from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.anonUserId, user.id));
    if ((row?.n ?? 0) >= MAX_PUSH_SUBSCRIPTIONS_PER_USER) {
      res.status(409).json({ error: "Too many devices have alerts switched on" });
      return;
    }
  }

  await db
    .insert(pushSubscriptionsTable)
    .values({
      anonUserId: user.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      prefs,
    })
    .onConflictDoUpdate({
      target: pushSubscriptionsTable.endpoint,
      set: {
        anonUserId: user.id,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        prefs,
        failureCount: 0,
        updatedAt: new Date(),
      },
    });

  res.json({ prefs });
});

/**
 * GET /push/subscription?endpoint=…
 * This device's saved alert choices, or 404 when the server doesn't know it.
 */
router.get("/push/subscription", requireAnonUser, async (req, res): Promise<void> => {
  const endpoint = typeof req.query["endpoint"] === "string" ? req.query["endpoint"] : "";
  const [row] = await db
    .select({ prefs: pushSubscriptionsTable.prefs })
    .from(pushSubscriptionsTable)
    .where(and(
      eq(pushSubscriptionsTable.endpoint, endpoint),
      eq(pushSubscriptionsTable.anonUserId, res.locals.anonUser.id),
    ))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Not subscribed" });
    return;
  }
  res.json({ prefs: row.prefs });
});

/**
 * DELETE /push/subscription  { endpoint }
 * Switch alerts off for this device.
 */
router.delete("/push/subscription", requireAnonUser, async (req, res): Promise<void> => {
  const parsed = EndpointBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  await db
    .delete(pushSubscriptionsTable)
    .where(and(
      eq(pushSubscriptionsTable.endpoint, parsed.data.endpoint),
      eq(pushSubscriptionsTable.anonUserId, res.locals.anonUser.id),
    ));
  res.status(204).end();
});

/**
 * POST /push/test  { endpoint }
 * Send a test alert to this device.
 */
router.post("/push/test", testLimiter, requireAnonUser, async (req, res): Promise<void> => {
  const parsed = EndpointBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const [sub] = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(and(
      eq(pushSubscriptionsTable.endpoint, parsed.data.endpoint),
      eq(pushSubscriptionsTable.anonUserId, res.locals.anonUser.id),
    ))
    .limit(1);
  if (!sub) {
    res.status(404).json({ error: "Not subscribed" });
    return;
  }
  // iOS shows "from USMNT" under the title, so the title doesn't repeat it.
  const result = await sendPush(sub, {
    title: "Test alert",
    body: "Notifications are working on this device.",
    url: "/alerts",
    tag: "test",
  });
  const status = { sent: 200, "not-configured": 503, gone: 410, failed: 502 }[result];
  res.status(status).json({ result });
});

export default router;
