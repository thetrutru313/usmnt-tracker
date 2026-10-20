import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db, syncMetadataTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { claimSyncRun } from "../syncGuard.js";
import { logger } from "../logger.js";

const names: string[] = [];
function uniqueName() {
  const name = "__sync_guard_test__" + randomUUID();
  names.push(name);
  return name;
}
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (names.length) {
    await db.delete(syncMetadataTable).where(inArray(syncMetadataTable.syncName, names));
    names.length = 0;
  }
});

describe("atomic sync claims — change verifying", () => {
  it("1: exactly one of 20 concurrent claims for a fresh unique name succeeds", async () => {
    const name = uniqueName();
    const claimed = await Promise.all(Array.from({ length: 20 }, () => claimSyncRun(name, 60 * 60 * 1000)));
    const winners = claimed.filter(Boolean).length;
    process.stdout.write(`Concurrent claim baseline/result: ${winners} true out of 20\n`);
    expect(winners).toBe(1);
  });
  it("database time controls the cooldown even when the application clock jumps forward", async () => {
    const name = uniqueName();
    expect(await claimSyncRun(name, 60 * 60 * 1000)).toBe(true);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-01-01T00:00:00Z"));
    expect(await claimSyncRun(name, 60 * 60 * 1000)).toBe(false);
  });
});

describe("sync claim regression guards — green before and after", () => {
  it("4: denies a second claim inside cooldown, and allows one after expiry", async () => {
    const name = uniqueName();
    expect(await claimSyncRun(name, 60 * 60 * 1000)).toBe(true);
    expect(await claimSyncRun(name, 60 * 60 * 1000)).toBe(false);
    // Advance only this unique test row past expiry using database time.
    await db.update(syncMetadataTable).set({
      lastRunAt: sql`now() - interval '61 minutes'`,
    }).where(eq(syncMetadataTable.syncName, name));
    expect(await claimSyncRun(name, 60 * 60 * 1000)).toBe(true);
  });
  it("5: database failure allows the run and preserves the WARN message", async () => {
    const name = uniqueName();
    const error = new Error("mock metadata outage");
    vi.spyOn(db, "select").mockImplementation(() => { throw error; });
    vi.spyOn(db, "insert").mockImplementation(() => { throw error; });
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    expect(await claimSyncRun(name, 60 * 60 * 1000)).toBe(true);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { err: error, syncName: name },
      "Could not read/write sync metadata — allowing sync to proceed",
    );
  });
});
