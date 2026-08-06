import { db, anonUsersTable, userFollowsTable, recoveryTokensTable, adminSessionsTable } from "@workspace/db";
import { and, lt, notExists, inArray, eq, sql, or, isNotNull } from "drizzle-orm";
import { logger } from "./logger";

/**
 * How old an anon_user must be (in days) before it is eligible for cleanup.
 * Override with the ANON_USER_CLEANUP_AGE_DAYS environment variable.
 */
function getOrphanAgeDays(): number {
  const raw = process.env["ANON_USER_CLEANUP_AGE_DAYS"];
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    logger.warn({ raw }, "ANON_USER_CLEANUP_AGE_DAYS is set but invalid; using default of 90");
  }
  return 90;
}

/**
 * How often to run the cleanup (in milliseconds).
 * Override with the ANON_USER_CLEANUP_INTERVAL_MS environment variable.
 */
function getCleanupIntervalMs(): number {
  const raw = process.env["ANON_USER_CLEANUP_INTERVAL_MS"];
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    logger.warn({ raw }, "ANON_USER_CLEANUP_INTERVAL_MS is set but invalid; using default of 24 h");
  }
  return 24 * 60 * 60 * 1000; // 24 hours
}

/**
 * Deletes `anon_users` rows that:
 *   - have no `user_follows` children (i.e. the user never followed anyone, or
 *     all their follows were removed), AND
 *   - were created more than {@link getOrphanAgeDays} days ago.
 *
 * Associated `recovery_tokens` rows are deleted first (within the same
 * transaction) because the FK from `recovery_tokens → anon_users` has no
 * ON DELETE CASCADE in the current schema.
 *
 * @returns The number of `anon_users` rows deleted.
 */
export async function cleanupOrphanedAnonUsers(): Promise<number> {
  const orphanAgeDays = getOrphanAgeDays();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - orphanAgeDays);

  // Collect the IDs of orphaned anon_users in one query so the subsequent
  // deletes are scoped to the same snapshot of rows.
  const orphans = await db
    .select({ id: anonUsersTable.id })
    .from(anonUsersTable)
    .where(
      and(
        lt(anonUsersTable.createdAt, cutoff),
        notExists(
          db
            .select({ one: sql<number>`1` })
            .from(userFollowsTable)
            .where(eq(userFollowsTable.anonUserId, anonUsersTable.id)),
        ),
      ),
    );

  if (orphans.length === 0) {
    logger.info({ orphanAgeDays }, "Anon-user cleanup: no orphaned rows found");
    return 0;
  }

  const orphanIds = orphans.map((r) => r.id);

  await db.transaction(async (tx) => {
    // Delete recovery_tokens first to satisfy the FK constraint.
    await tx
      .delete(recoveryTokensTable)
      .where(inArray(recoveryTokensTable.anonUserId, orphanIds));

    await tx.delete(anonUsersTable).where(inArray(anonUsersTable.id, orphanIds));
  });

  logger.info(
    { deleted: orphanIds.length, orphanAgeDays },
    "Anon-user cleanup: deleted orphaned anon_users",
  );

  return orphanIds.length;
}

/**
 * Deletes `admin_sessions` rows that are either:
 *   - expired (`expires_at < now()`), or
 *   - explicitly revoked (`revoked_at IS NOT NULL`).
 *
 * These rows serve no purpose after expiry/revocation and accumulate over
 * time as operators log in and out.
 */
export async function cleanupExpiredAdminSessions(): Promise<number> {
  const now = new Date();
  const deleted = await db
    .delete(adminSessionsTable)
    .where(or(lt(adminSessionsTable.expiresAt, now), isNotNull(adminSessionsTable.revokedAt)))
    .returning({ id: adminSessionsTable.id });

  if (deleted.length > 0) {
    logger.info({ deleted: deleted.length }, "Admin-session cleanup: purged expired/revoked sessions");
  }
  return deleted.length;
}

let _cleanupIntervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Runs {@link cleanupOrphanedAnonUsers} immediately on call, then on the
 * configured interval (default: 24 hours, overridable via
 * ANON_USER_CLEANUP_INTERVAL_MS).  Subsequent calls are no-ops (the interval
 * is started only once).
 */
export function startAnonUserCleanupSchedule(intervalMs?: number): void {
  if (_cleanupIntervalHandle !== null) return; // already running

  const resolvedIntervalMs = intervalMs ?? getCleanupIntervalMs();

  async function run(): Promise<void> {
    try {
      await cleanupOrphanedAnonUsers();
    } catch (err) {
      logger.error({ err }, "Anon-user cleanup: scheduled run failed");
    }
    try {
      await cleanupExpiredAdminSessions();
    } catch (err) {
      logger.error({ err }, "Admin-session cleanup: scheduled run failed");
    }
  }

  void run();
  _cleanupIntervalHandle = setInterval(() => void run(), resolvedIntervalMs);
}

/** Exposed for tests that need to reset the singleton guard. */
export function _resetCleanupScheduleForTests(): void {
  if (_cleanupIntervalHandle !== null) {
    clearInterval(_cleanupIntervalHandle);
    _cleanupIntervalHandle = null;
  }
}
