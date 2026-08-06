/**
 * Regression guard: GET /transparency/invoice/:path must verify the requested
 * path is stored as an invoice in transparency_months.invoice_urls before
 * signing a GCS download URL.
 *
 * - Negative: path absent from invoice_urls → 404, signing never reached.
 * - Positive: path present in invoice_urls → 302, signing called once with
 *   the correct normalised object path and TTL.
 *
 * @workspace/db is mocked — no live database or DATABASE_URL needed.
 * Only the transparency router is mounted; the rest of the app is not imported,
 * so no module-level table references from queries.ts or other routes are
 * triggered.
 */

import { vi, describe, it, expect, afterEach } from "vitest";

// ── Hoisted mock state ────────────────────────────────────────────────────────

const { mockLimit, mockDb, tTransparency, mockGetDownloadUrl, MockObjectNotFoundError } =
  vi.hoisted(() => {
    // DB chain: db.select({id}).from(t).where(sql`...`).limit(1)
    // Default return is [] (no matching row) — the negative case.
    // Positive-case tests override with mockResolvedValueOnce.
    const mockLimit   = vi.fn().mockResolvedValue([] as { id: number }[]);
    const mockWhere   = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockFrom    = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect  = vi.fn().mockReturnValue({ from: mockFrom });
    const mockDb      = { select: mockSelect };

    // Minimal table stub — only the fields referenced by the route query.
    const tTransparency = {
      id:          { name: "id" },
      invoiceUrls: { name: "invoice_urls" },
    };

    const mockGetDownloadUrl = vi.fn<() => Promise<string>>();

    class MockObjectNotFoundError extends Error {
      constructor(msg?: string) {
        super(msg);
        this.name = "ObjectNotFoundError";
      }
    }

    return { mockLimit, mockDb, tTransparency, mockGetDownloadUrl, MockObjectNotFoundError };
  });

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: mockDb,
  transparencyMonthsTable: tTransparency,
}));

// ObjectStorageService must be a proper class (not an arrow-fn mock) because
// src/routes/storage.ts instantiates it at module-load time with `new`.
// Since we mount only the transparency router here (not the full app), this
// particular constraint does not apply — but keeping it as a class is correct
// regardless and guards against future route reorganisation.
vi.mock("../objectStorage.js", () => ({
  ObjectStorageService: class MockObjectStorageService {
    getObjectEntityDownloadUrl = mockGetDownloadUrl;
  },
  ObjectNotFoundError: MockObjectNotFoundError,
}));

// ── Minimal test app ──────────────────────────────────────────────────────────
//
// Mount only the transparency router — no other routes, no shared app state,
// no transitively imported modules that reference live-DB table columns at
// module-load time (e.g. queries.ts).

import express from "express";
import transparencyRouter from "../../routes/transparency.js";
import request from "supertest";

const testApp = express();
testApp.use("/api", transparencyRouter);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /transparency/invoice/:path — path must be a registered invoice", () => {
  afterEach(() => {
    mockLimit.mockClear();
    mockGetDownloadUrl.mockClear();
  });

  // ── Negative cases ──────────────────────────────────────────────────────────

  it(
    "returns 404 for a path not present in any transparency_months row",
    async () => {
      // mockLimit default returns [] — no row found, route returns 404.
      const res = await request(testApp).get(
        "/api/transparency/invoice/uploads/00000000-0000-0000-0000-000000000000",
      );

      expect(
        res.status,
        `Expected 404, got ${res.status}: ${JSON.stringify(res.body)}`,
      ).toBe(404);
      expect((res.body as { error?: string }).error).toBe("Invoice not found");
    },
    30_000,
  );

  it(
    "never calls the signing service when the path is not a registered invoice",
    async () => {
      // mockLimit default returns [] — route short-circuits before signing.
      await request(testApp).get(
        "/api/transparency/invoice/uploads/00000000-0000-0000-0000-000000000001",
      );

      expect(
        mockGetDownloadUrl,
        "getObjectEntityDownloadUrl must not be called for an unregistered path",
      ).not.toHaveBeenCalled();
    },
    30_000,
  );

  // ── Positive case ───────────────────────────────────────────────────────────

  it(
    "returns 302 and calls getObjectEntityDownloadUrl for a registered invoice path",
    async () => {
      const suffix      = "uploads/ffffffff-ffff-ffff-ffff-ffffffffffff";
      const objectPath  = `/objects/${suffix}`;
      const fakeSignedUrl =
        "https://storage.googleapis.com/fake-bucket/signed?X-Goog-Signature=test";

      // Make the DB chain return one matching row for this test only.
      mockLimit.mockResolvedValueOnce([{ id: 1 }]);
      mockGetDownloadUrl.mockResolvedValueOnce(fakeSignedUrl);

      const res = await request(testApp)
        .get(`/api/transparency/invoice/${suffix}`)
        .redirects(0); // inspect the 302 directly, do not follow

      expect(
        res.status,
        `Expected 302 for a registered invoice path, got ${res.status}: ${JSON.stringify(res.body)}`,
      ).toBe(302);

      expect(
        mockGetDownloadUrl,
        "getObjectEntityDownloadUrl must be called exactly once",
      ).toHaveBeenCalledOnce();

      expect(
        mockGetDownloadUrl,
        "getObjectEntityDownloadUrl must receive the normalised object path and TTL",
      ).toHaveBeenCalledWith(objectPath, 300);
    },
    30_000,
  );
});
