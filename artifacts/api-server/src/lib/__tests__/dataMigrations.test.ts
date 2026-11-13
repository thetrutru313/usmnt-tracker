import { describe, expect, it, vi } from "vitest";
import { db, dataMigrationsTable, serverConfigTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { applyDataMigrations } from "../dataMigrations";
import { baseline } from "../../dataMigrations/0001_baseline";
import type { DataMigration, DataMigrationBootResult, DataMigrationTransaction } from "../../dataMigrations/types";

async function isolated(check: (tx: DataMigrationTransaction) => Promise<void>) {
  const rollback = new Error("intentional migration test rollback");
  try {
    await db.transaction(async (tx) => {
      for (const table of ["data_migrations", "server_config"]) {
        await tx.execute(sql.raw(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`));
      }
      await check(tx);
      throw rollback;
    });
  } catch (err) {
    if (err !== rollback) throw err;
  }
}

function migration(id: string, run: DataMigration["run"] = async () => {}): DataMigration {
  return { id, description: `Test ${id}`, run };
}
async function recorded(tx: DataMigrationTransaction) {
  return tx.select().from(dataMigrationsTable).orderBy(dataMigrationsTable.id);
}
async function lastBoot(tx: DataMigrationTransaction): Promise<DataMigrationBootResult | null> {
  const [row] = await tx.select().from(serverConfigTable).where(eq(serverConfigTable.key, "dataMigrations.lastBoot"));
  return row ? JSON.parse(row.value) : null;
}

describe("recorded data migrations", () => {
  it("a: applies pending ids in order, records them, and does nothing on a second run", async () => {
    await isolated(async (tx) => {
      const order: string[] = [];
      const migrations = ["0001_one", "0002_two"].map(id => migration(id, async () => { order.push(id); }));
      await applyDataMigrations(tx, migrations);
      expect(order).toEqual(["0001_one", "0002_two"]);
      expect((await recorded(tx)).map(row => row.id)).toEqual(order);
      for (const row of await recorded(tx)) {
        expect(row.description).toBe(`Test ${row.id}`);
        expect(row.appliedAt).toBeInstanceOf(Date);
        expect(row.durationMs).toBeGreaterThanOrEqual(0);
      }
      expect(await lastBoot(tx)).toMatchObject({ applied: order, failed: null, pending: [] });
      await applyDataMigrations(tx, migrations);
      expect(order).toEqual(["0001_one", "0002_two"]);
      expect(await lastBoot(tx)).toMatchObject({ applied: [], failed: null, pending: [] });
    });
  });
  it("b: rolls back a failed migration and its record, preserves earlier work, and stops later ids", async () => {
    await isolated(async (tx) => {
      const later = vi.fn();
      const put = (key: string) => async (inner: DataMigrationTransaction) => {
        await inner.insert(serverConfigTable).values({ key, value: "2099-01-01" });
      };
      await applyDataMigrations(tx, [
        migration("0001_ok", put("before")),
        migration("0002_fail", async (inner) => {
          await put("rollback")(inner);
          throw new Error("intentional migration failure");
        }),
        migration("0003_later", later),
      ]);
      expect((await recorded(tx)).map(row => row.id)).toEqual(["0001_ok"]);
      expect(await tx.select().from(serverConfigTable).where(eq(serverConfigTable.key, "rollback"))).toEqual([]);
      expect(await tx.select().from(serverConfigTable).where(eq(serverConfigTable.key, "before"))).toHaveLength(1);
      expect(later).not.toHaveBeenCalled();
      expect(await lastBoot(tx)).toMatchObject({
        applied: ["0001_ok"], failed: { id: "0002_fail", error: "intentional migration failure" },
        pending: ["0002_fail", "0003_later"],
      });
    });
  });
  it.each([
    ["unsorted", ["0002_two", "0001_one"]],
    ["duplicate", ["0001_one", "0001_one"]],
  ])("c: rejects an %s list before applying anything and records failure", async (_label, ids) => {
    await isolated(async (tx) => {
      const run = vi.fn();
      await applyDataMigrations(tx, ids.map(id => migration(id, run)));
      expect(await lastBoot(tx)).toMatchObject({
        applied: [], failed: { id: ids[1], error: expect.any(String) }, pending: [...new Set(ids)],
      });
      expect(run).not.toHaveBeenCalled();
      expect(await recorded(tx)).toEqual([]);
    });
  });
  it("d: skips recorded ids even when their code would now throw", async () => {
    await isolated(async (tx) => {
      await tx.insert(dataMigrationsTable).values({
        id: "0001_recorded", description: "Existing", appliedAt: new Date("2099-01-01T00:00:00Z"),
      });
      const forbidden = vi.fn(async () => { throw new Error("must not run"); });
      await applyDataMigrations(tx, [migration("0001_recorded", forbidden), migration("0002_new")]);
      expect((await recorded(tx)).map(row => row.id)).toEqual(["0001_recorded", "0002_new"]);
      expect(forbidden).not.toHaveBeenCalled();
      expect(await lastBoot(tx)).toMatchObject({ applied: ["0002_new"], failed: null, pending: [] });
    });
  });
  it("baseline: records the default no-op migration without changing application data", async () => {
    await isolated(async (tx) => {
      await applyDataMigrations(tx, [baseline]);
      expect((await recorded(tx)).map(row => row.id)).toEqual(["0001_baseline"]);
      expect((await tx.select().from(serverConfigTable)).map(row => row.key)).toEqual(["dataMigrations.lastBoot"]);
    });
  });
});
