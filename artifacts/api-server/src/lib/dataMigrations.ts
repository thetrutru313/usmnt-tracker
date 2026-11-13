import type { DataMigration, DataMigrationDatabase } from "../dataMigrations/types";

// Red-test scaffold only: no migrations execute until the runner is implemented.
export async function applyDataMigrations(_db: DataMigrationDatabase, _migrations: DataMigration[] = []): Promise<unknown> {
  return undefined;
}
