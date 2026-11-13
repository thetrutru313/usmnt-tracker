import type { DataMigration } from "./types";

export const baseline: DataMigration = {
  id: "0001_baseline",
  description: "Baseline: verify the recorded data-migration pipeline",
  run: async () => {},
};
