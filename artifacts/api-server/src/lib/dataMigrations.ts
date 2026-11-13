import { dataMigrationsTable, serverConfigTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { DATA_MIGRATIONS } from "../dataMigrations";
import type { DataMigration, DataMigrationBootResult, DataMigrationDatabase } from "../dataMigrations/types";
import { logger } from "./logger";

const BOOT_KEY = "dataMigrations.lastBoot";
// One fixed key across every instance and migration. The lock lasts until commit/rollback.
const MIGRATION_LOCK_KEY = 739067431;

/** Data changes only: the schema table must already exist (created by Publish). */
export async function applyDataMigrations(
  db: DataMigrationDatabase,
  migrations: DataMigration[] = DATA_MIGRATIONS,
): Promise<DataMigrationBootResult> {
  const startedAt = new Date().toISOString();
  const applied: string[] = [];
  let failed: DataMigrationBootResult["failed"] = null;
  let recorded = new Set<string>();
  const fail = (id: string, err: unknown) => {
    failed = { id, error: err instanceof Error ? err.message : String(err) };
    logger.error({ err, migrationId: id }, "Data migration failed — later migrations skipped; server continues");
  };

  // Validate before any migration runs, including ones that precede a bad ID.
  const invalidIndex = migrations.findIndex((migration, i) => i > 0 && migration.id <= migrations[i - 1].id);
  if (invalidIndex !== -1) {
    fail(migrations[invalidIndex].id, new Error("Data migration IDs must be unique and strictly ascending"));
  }

  let currentId = migrations[0]?.id ?? "data_migrations";
  try {
    recorded = new Set((await db.select({ id: dataMigrationsTable.id }).from(dataMigrationsTable)).map(row => row.id));
    if (!failed) {
      for (const migration of migrations) {
        if (recorded.has(migration.id)) continue;
        currentId = migration.id;
        const didApply = await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`);
          // A peer may have committed while this boot waited for the lock.
          const [existing] = await tx.select({ id: dataMigrationsTable.id })
            .from(dataMigrationsTable).where(eq(dataMigrationsTable.id, migration.id));
          if (existing) return false;
          const start = Date.now();
          await migration.run(tx);
          await tx.insert(dataMigrationsTable).values({
            id: migration.id, description: migration.description, durationMs: Date.now() - start,
          });
          return true;
        });
        recorded.add(migration.id);
        if (didApply) applied.push(migration.id);
      }
    }
  } catch (err) {
    // Includes a missing ledger table. Never create or repair schema from startup.
    if (!failed) fail(currentId, err);
    else logger.error({ err }, "Could not read recorded data migrations");
  }

  // Refresh after rollback/peer commits so pending contains only unapplied IDs.
  try {
    recorded = new Set((await db.select({ id: dataMigrationsTable.id }).from(dataMigrationsTable)).map(row => row.id));
  } catch (err) {
    if (!failed) fail(currentId, err);
  }
  const result: DataMigrationBootResult = {
    startedAt, finishedAt: new Date().toISOString(), applied, failed,
    pending: [...new Set(migrations.map(migration => migration.id))].filter(id => !recorded.has(id)),
  };
  try {
    const value = JSON.stringify(result);
    await db.insert(serverConfigTable).values({ key: BOOT_KEY, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: serverConfigTable.key, set: { value, updatedAt: new Date() } });
  } catch (err) {
    logger.error({ err }, "Could not record data-migration boot result — server continues");
  }
  logger.info({ applied: result.applied, failedId: result.failed?.id ?? null, pending: result.pending }, "Data migrations boot complete");
  return result;
}

export type DataMigrationHealth = { lastBootAt: string | null; failedId: string | null; pending: string[] };

/** Public health excludes migration error text and descriptions. */
export async function readDataMigrationHealth(db: Pick<DataMigrationDatabase, "select">): Promise<DataMigrationHealth> {
  const [row] = await db.select({ value: serverConfigTable.value }).from(serverConfigTable)
    .where(eq(serverConfigTable.key, BOOT_KEY));
  if (!row) return { lastBootAt: null, failedId: null, pending: [] };
  try {
    const boot = JSON.parse(row.value) as DataMigrationBootResult;
    return { lastBootAt: boot.finishedAt, failedId: boot.failed?.id ?? null, pending: boot.pending };
  } catch (err) {
    logger.error({ err }, "Could not parse data-migration boot health");
    return { lastBootAt: null, failedId: BOOT_KEY, pending: [] };
  }
}
