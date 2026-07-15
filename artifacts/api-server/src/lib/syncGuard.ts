/**
 * Cooldown guard for scheduled syncs.
 *
 * Prevents expensive syncs from re-running on every server restart.
 * Call `claimSyncRun(name, cooldownMs)` at the top of each run callback:
 *   - Returns `true`  → proceed; last-run timestamp already written to DB.
 *   - Returns `false` → too soon; skip this run and log how long ago it ran.
 *
 * The timestamp is written BEFORE the sync executes so that a concurrent or
 * back-to-back restart sees it immediately and skips rather than piling up.
 * Trade-off: a failed sync won't auto-retry until the cooldown expires, but
 * for daily syncs (23 h window) this is preferable to burning the daily API
 * quota on repeated crash-restart loops.
 */

import { db, syncMetadataTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export async function claimSyncRun(syncName: string, cooldownMs: number): Promise<boolean> {
  try {
    const [row] = await db
      .select({ lastRunAt: syncMetadataTable.lastRunAt })
      .from(syncMetadataTable)
      .where(eq(syncMetadataTable.syncName, syncName))
      .limit(1);

    if (row) {
      const elapsed = Date.now() - row.lastRunAt.getTime();
      if (elapsed < cooldownMs) {
        logger.info(
          {
            syncName,
            ranMinutesAgo: Math.round(elapsed / 60_000),
            cooldownMinutes: Math.round(cooldownMs / 60_000),
          },
          "Sync skipped — ran recently (cooldown active)",
        );
        return false;
      }
    }

    // Claim the slot before running to block concurrent or fast-restart duplicates.
    await db
      .insert(syncMetadataTable)
      .values({ syncName, lastRunAt: new Date() })
      .onConflictDoUpdate({
        target: syncMetadataTable.syncName,
        set: { lastRunAt: new Date() },
      });

    return true;
  } catch (err) {
    // Metadata failure must never block a sync — fail open so a DB hiccup
    // doesn't permanently prevent data from refreshing.
    logger.warn({ err, syncName }, "Could not read/write sync metadata — allowing sync to proceed");
    return true;
  }
}
