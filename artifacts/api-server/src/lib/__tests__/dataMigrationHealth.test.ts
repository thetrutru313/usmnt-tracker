import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, serverConfigTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import app from "../../app";

const sandbox = vi.hoisted(() => ({ transaction: null as unknown }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: new Proxy(actual.db, {
    get(target, key) {
      const source = (sandbox.transaction ?? target) as typeof actual.db;
      const value = Reflect.get(source, key);
      return typeof value === "function" ? value.bind(source) : value;
    },
  }) };
});
vi.mock("../scheduledJobs", async (importOriginal) => ({
  ...await importOriginal<typeof import("../scheduledJobs")>(), APP_JOBS: [],
}));

async function isolated(value: unknown, check: () => Promise<void>) {
  const rollback = new Error("intentional migration health rollback");
  try {
    await db.transaction(async tx => {
      sandbox.transaction = tx;
      await tx.execute(sql`CREATE TEMP TABLE server_config (LIKE public.server_config INCLUDING ALL) ON COMMIT DROP`);
      if (value !== null) {
        await tx.insert(serverConfigTable).values({ key: "dataMigrations.lastBoot", value: JSON.stringify(value) });
      }
      await check();
      throw rollback;
    });
  } catch (err) {
    if (err !== rollback) throw err;
  } finally {
    sandbox.transaction = null;
  }
}
const finishedAt = "2099-01-01T00:00:01.000Z";
describe("f: data migration job health", () => {
  it("returns 503 with failed id and pending ids, never error text", async () => {
    await isolated({
      startedAt: "2099-01-01T00:00:00.000Z", finishedAt, applied: ["0001_baseline"],
      failed: { id: "0002_failed", error: "PRIVATE_MIGRATION_ERROR" }, pending: ["0002_failed", "0003_later"],
    }, async () => {
      const response = await request(app).get("/api/healthz/jobs");
      expect(response.status).toBe(503);
      expect(response.body.status).toBe("unhealthy");
      expect(response.body.dataMigrations).toEqual({ lastBootAt: finishedAt, failedId: "0002_failed", pending: ["0002_failed", "0003_later"] });
      expect(JSON.stringify(response.body)).not.toContain("PRIVATE_MIGRATION_ERROR");
      expect(response.body.dataMigrations).not.toHaveProperty("error");
    });
  });
  it("returns 200 and migration health when the boot succeeded", async () => {
    await isolated({ startedAt: finishedAt, finishedAt, applied: ["0001_baseline"], failed: null, pending: [] }, async () => {
      const response = await request(app).get("/api/healthz/jobs");
      expect(response.body.dataMigrations).toEqual({ lastBootAt: finishedAt, failedId: null, pending: [] });
      expect(response.status).toBe(200);
      expect(response.body.status).toBe("ok");
    });
  });
  it("returns 200 with null boot and no failure when the key is absent", async () => {
    await isolated(null, async () => {
      const response = await request(app).get("/api/healthz/jobs");
      expect(response.body.dataMigrations).toEqual({ lastBootAt: null, failedId: null, pending: [] });
      expect(response.status).toBe(200);
    });
  });
});
