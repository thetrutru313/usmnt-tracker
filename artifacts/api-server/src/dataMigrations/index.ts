import { baseline } from "./0001_baseline";
import type { DataMigration } from "./types";

export type { DataMigration } from "./types";
export const DATA_MIGRATIONS: DataMigration[] = [baseline];
