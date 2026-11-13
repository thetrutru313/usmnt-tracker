import { describe, expect, it, vi } from "vitest";
import { applyDataMigrations } from "../dataMigrations";
import type { DataMigrationDatabase } from "../../dataMigrations/types";

describe("migration transaction safety", () => {
  it("e: re-checks the record after the advisory lock, skipping another instance's work", async () => {
    const events: string[] = [];
    let recorded = false;
    const run = vi.fn();
    const recordInsert = vi.fn();
    const tx = {
      execute: vi.fn(async () => { events.push("lock"); recorded = true; }),
      select: () => ({ from: () => ({ where: async () => {
        events.push("recheck");
        return recorded ? [{ id: "0001_other_instance" }] : [];
      } }) }),
      insert: recordInsert,
    };
    const database = {
      select: () => ({ from: async () => recorded ? [{ id: "0001_other_instance" }] : [] }),
      transaction: async (callback: (t: unknown) => Promise<unknown>) => callback(tx),
      insert: () => ({ values: () => ({ onConflictDoUpdate: async () => {} }) }),
    } as unknown as DataMigrationDatabase;
    await applyDataMigrations(database, [{ id: "0001_other_instance", description: "Already done by peer", run }]);
    expect(events).toEqual(["lock", "recheck"]);
    expect(run).not.toHaveBeenCalled();
    expect(recordInsert).not.toHaveBeenCalled();
  });
  it("missing table: reports failure and never attempts to create a table", async () => {
    let saved: { value: string } | undefined;
    const transaction = vi.fn();
    const database = {
      select: () => ({ from: async () => { throw new Error('relation "data_migrations" does not exist'); } }),
      transaction,
      insert: () => ({ values: (value: { value: string }) => {
        saved = value;
        return { onConflictDoUpdate: async () => {} };
      } }),
    } as unknown as DataMigrationDatabase;
    await applyDataMigrations(database, [{ id: "0001_missing", description: "Missing table", run: vi.fn() }]);
    expect(saved).toBeDefined();
    expect(JSON.parse(saved!.value)).toMatchObject({
      applied: [], failed: { id: "0001_missing", error: expect.stringContaining("does not exist") }, pending: ["0001_missing"],
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});
