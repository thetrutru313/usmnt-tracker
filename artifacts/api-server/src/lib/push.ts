import webpush from "web-push";
import { db, pushSubscriptionsTable, type PushSubscriptionRow } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";

export type PushPayload = {
  title: string;
  body: string;
  /** In-app path opened when the alert is tapped. */
  url?: string;
  /** Alerts with the same tag replace each other on the device. */
  tag?: string;
};

export type PushResult = "sent" | "gone" | "failed" | "not-configured";

// Browsers only hand out endpoints on these push services. Anything else is
// refused, so the server never sends requests to an arbitrary URL.
const PUSH_HOST_SUFFIXES = [
  "push.apple.com",
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "notify.windows.com",
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

type Vapid = { publicKey: string; privateKey: string; subject: string };

// Read at call time (not import time) so a newly added Secret takes effect
// on the next request and tests can set it.
function readVapid(): Vapid | null {
  const publicKey = process.env["VAPID_PUBLIC_KEY"]?.trim();
  const privateKey = process.env["VAPID_PRIVATE_KEY"]?.trim();
  const subject = process.env["VAPID_SUBJECT"]?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

/** The public half of the key pair, for browsers to subscribe with; null when alerts aren't set up. */
export function vapidPublicKey(): string | null {
  return readVapid()?.publicKey ?? null;
}

let configuredFor: string | null = null;

function ensureConfigured(): boolean {
  const vapid = readVapid();
  if (!vapid) return false;
  const fingerprint = `${vapid.subject}|${vapid.publicKey}`;
  if (configuredFor === fingerprint) return true;
  try {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    configuredFor = fingerprint;
    return true;
  } catch (err) {
    // Never log the keys themselves — only that they were rejected.
    logger.error({ message: (err as Error).message }, "Push: VAPID settings rejected — check the VAPID_* Secrets");
    return false;
  }
}

/** Consecutive non-"gone" failures after which a subscription is dropped. */
export const MAX_PUSH_FAILURES = 10;

/**
 * Send one alert to one device. A 404/410 from the push service means the
 * subscription no longer exists, so its row is deleted; other failures are
 * counted and the row is dropped after MAX_PUSH_FAILURES in a row.
 */
export async function sendPush(
  sub: Pick<PushSubscriptionRow, "id" | "endpoint" | "p256dh" | "auth">,
  payload: PushPayload,
): Promise<PushResult> {
  if (!ensureConfigured()) return "not-configured";
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 6 * 60 * 60 },
    );
    await db
      .update(pushSubscriptionsTable)
      .set({ failureCount: 0, lastSuccessAt: new Date() })
      .where(eq(pushSubscriptionsTable.id, sub.id));
    return "sent";
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, sub.id));
      logger.info({ subscriptionId: sub.id, status }, "Push: subscription gone — removed");
      return "gone";
    }
    const [row] = await db
      .update(pushSubscriptionsTable)
      .set({ failureCount: sql`${pushSubscriptionsTable.failureCount} + 1` })
      .where(eq(pushSubscriptionsTable.id, sub.id))
      .returning({ failureCount: pushSubscriptionsTable.failureCount });
    if (row && row.failureCount >= MAX_PUSH_FAILURES) {
      await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, sub.id));
      logger.warn({ subscriptionId: sub.id, status }, "Push: too many failures — subscription removed");
    } else {
      logger.warn({ subscriptionId: sub.id, status, message: (err as Error).message }, "Push: send failed");
    }
    return "failed";
  }
}
