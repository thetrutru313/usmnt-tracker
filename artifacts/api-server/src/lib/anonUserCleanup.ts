import { db, anonUsersTable, userFollowsTable, recoveryTokensTable } from "@workspace/db";
import { and, lt, notExists, inArray, eq, sql } from "drizzle-orm";
import { logger } from "./logger";

/** How old an anon_user must be (in days) before it is eligible for cleanup. */
const ORPHAN_AGE_DAYS = 90;

/**
 * Deletes `anon_users` rows that:
 *   - have no `user_follows` children (i.e. the user never followed anyone, or
 *     all their follows were removed), AND
 *   - were created more than {@link ORPHAN_AGE_DAYS} days ago.
 *
 * Associated `recovery_tokens` rows are deleted first (within the same
 * transaction) because the FK from `recovery_tokens → anon_users` has no
 * ON DELETE CASCADE in the current schema.
 *
 * @returns The number of `anon_users` rows deleted.
 */
export async function cleanupOrphanedAnonUsers(): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - ORPHAN_AGE_DAYS);

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
    logger.info({ orphanAgeDays: ORPHAN_AGE_DAYS }, "Anon-user cleanup: no orphaned rows found");
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
    { deleted: orphanIds.length, orphanAgeDays: ORPHAN_AGE_DAYS },
    "Anon-user cleanup: deleted orphaned anon_users",
  );

  return orphanIds.length;
}

let _cleanupIntervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Runs {@link cleanupOrphanedAnonUsers} immediately on call, then once per day.
 * Subsequent calls are no-ops (the interval is started only once).
 */
export function startAnonUserCleanupSchedule(intervalMs = 24 * 60 * 60 * 1000): void {
  if (_cleanupIntervalHandle !== null) return; // already running

  async function run(): Promise<void> {
    try {
      await cleanupOrphanedAnonUsers();
    } catch (err) {
      logger.error({ err }, "Anon-user cleanup: scheduled run failed");
    }
  }

  void run();
  _cleanupIntervalHandle = setInterval(() => void run(), intervalMs);
}
