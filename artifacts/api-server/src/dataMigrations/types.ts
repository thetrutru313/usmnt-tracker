import type { db } from "@workspace/db";

export type DataMigrationTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DataMigrationDatabase = Pick<typeof db, "select" | "insert" | "transaction">;

export type DataMigration = {
  id: string;
  description: string;
  run: (tx: DataMigrationTransaction) => Promise<void>;
};

export type DataMigrationBootResult = {
  startedAt: string;
  finishedAt: string;
  applied: string[];
  failed: { id: string; error: string } | null;
  pending: string[];
};
