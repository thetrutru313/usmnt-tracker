import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { anonUsersTable } from "./anonUsers";

/** Alert types a device can switch on or off. */
export const PUSH_ALERT_KINDS = [
  "kickoff",
  "lineups",
  "goals",
  "ratings",
  "announcements",
  "injuries",
  "transfers",
] as const;
export type PushAlertKind = (typeof PUSH_ALERT_KINDS)[number];

/**
 * One device's alert choices. `scope` decides which players' alerts it gets:
 * "mine" = the anon user's followed players, "all" = every tracked player.
 * USMNT announcements ignore scope.
 */
export type PushPrefs = Record<PushAlertKind, boolean> & { scope: "mine" | "all" };

/**
 * Web Push subscriptions — one row per device (browser or installed app) that
 * has switched alerts on. `endpoint` is the push service URL the browser
 * handed out; `p256dh` and `auth` are the keys used to encrypt each message.
 * Rows are removed when the push service reports the subscription gone, and
 * with their anon user (ON DELETE CASCADE).
 */
export const pushSubscriptionsTable = pgTable(
  "push_subscriptions",
  {
    id: serial("id").primaryKey(),
    anonUserId: integer("anon_user_id")
      .notNull()
      .references(() => anonUsersTable.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    prefs: jsonb("prefs").$type<PushPrefs>().notNull(),
    failureCount: integer("failure_count").notNull().default(0),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("push_subscriptions_anon_user_id_idx").on(t.anonUserId)],
);

export type PushSubscriptionRow = typeof pushSubscriptionsTable.$inferSelect;

/**
 * Alerts already sent, one row per event (e.g. "kickoff:123",
 * "rating:123:45"). Inserting the key claims the event, so each alert goes
 * out once even when several server instances scan at the same time.
 */
export const pushEventsTable = pgTable("push_events", {
  key: text("key").primaryKey(),
  kind: text("kind").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
