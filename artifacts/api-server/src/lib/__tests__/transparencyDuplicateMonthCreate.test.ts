/**
 * Regression guard: POST /admin/transparency with a duplicate period_year /
 * period_month must return 409, not 500.
 *
 * Root cause: Drizzle/pg wraps unique-constraint violations in an error where
 * `code === "23505"` but the `message` may not contain the words "unique" or
 * "duplicate".  The route previously fell through to the 500 branch because it
 * only checked `err.message`.  This test pins the fix that also checks
 * `err.code` directly.
 *
 * Uses a mocked @workspace/db so no DATABASE_URL is required:
 *   - Session-lookup chain → returns a valid, non-expired session (adminAuth passes).
 *   - Insert chain         → throws { code: "23505", message: "Query failed" }.
 *
 * Only the transparency router is mounted; the rest of the app is not imported.
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// ── Hoisted mock state ────────────────────────────────────────────────────────

const {
  mockDb,
  tAdmin,
  tTransparency,
} = vi.hoisted(() => {
  // ── Session-lookup chain ──────────────────────────────────────────────────
  // db.select().from(adminSessionsTable).where(...).limit(1)
  // Returns a non-expired session so requireAdminSession calls next().
  const mockSelectLimit = vi.fn().mockResolvedValue([
    {
      tokenHash: "hashed",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  ]);
  const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockSelectLimit });
  const mockSelectFrom  = vi.fn().mockReturnValue({ where: mockSelectWhere });
  const mockSelect      = vi.fn().mockReturnValue({ from: mockSelectFrom });

  // ── Insert chain ──────────────────────────────────────────────────────────
  // db.insert(transparencyMonthsTable).values({...}).returning()
  // Throws a PG unique-violation error — code "23505", message without the
  // words "unique" or "duplicate" to replicate the Drizzle wrapping behaviour
  // that the fix addresses.
  const mockInsertReturning = vi.fn().mockRejectedValue(
    Object.assign(new Error("Query failed"), { code: "23505" }),
  );
  const mockInsertValues = vi.fn().mockReturnValue({ returning: mockInsertReturning });
  const mockInsert       = vi.fn().mockReturnValue({ values: mockInsertValues });

  const mockDb = { select: mockSelect, insert: mockInsert };

  // ── Table stubs ───────────────────────────────────────────────────────────
  // Plain objects — only the field names accessed by the route and middleware.
  const tAdmin = {
    tokenHash: { name: "token_hash" },
    revokedAt: { name: "revoked_at" },
    expiresAt: { name: "expires_at" },
  };
  const tTransparency = {
    periodYear:          { name: "period_year" },
    periodMonth:         { name: "period_month" },
    expensesCents:       { name: "expenses_cents" },
    donationsCents:      { name: "donations_cents" },
    goalFoundationCents: { name: "goal_foundation_cents" },
    invoiceUrls:         { name: "invoice_urls" },
    notes:               { name: "notes" },
  };

  return { mockDb, tAdmin, tTransparency };
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db:                     mockDb,
  adminSessionsTable:     tAdmin,
  transparencyMonthsTable: tTransparency,
}));

// ── Minimal test app ──────────────────────────────────────────────────────────

import express from "express";
import transparencyRouter from "../../routes/transparency.js";
import request from "supertest";

const testApp = express();
testApp.use(express.json());
testApp.use("/api", transparencyRouter);

// ── Tests ─────────────────────────────────────────────────────────────────────

const TEST_TOKEN    = "test-admin-token-for-23505-guard";
const TEST_PASSWORD = "test-pw-for-23505-guard";

describe("POST /admin/transparency — duplicate period returns 409 not 500", () => {
  beforeAll(() => {
    process.env["ADMIN_PASSWORD"] = TEST_PASSWORD;
  });

  afterAll(() => {
    delete process.env["ADMIN_PASSWORD"];
  });

  it(
    "returns 409 when the DB throws a PG code-23505 error on insert",
    async () => {
      const res = await request(testApp)
        .post("/api/admin/transparency")
        .set("Authorization", `Bearer ${TEST_TOKEN}`)
        .set("Content-Type", "application/json")
        .send({
          periodYear:          2035,
          periodMonth:         12,
          expensesCents:       0,
          donationsCents:      0,
          goalFoundationCents: 0,
          notes:               null,
          invoiceUrls:         [],
        });

      expect(
        res.status,
        `Expected 409 for a duplicate month, got ${res.status}: ${JSON.stringify(res.body)}`,
      ).toBe(409);

      expect(
        (res.body as { error?: string }).error,
        "Response body should describe the conflict",
      ).toMatch(/already exists/i);
    },
    30_000,
  );

  it(
    "does NOT return 500 — 500 is reserved for genuinely unexpected errors",
    async () => {
      // Re-run the same request; mockInsertReturning is set up to always throw
      // the 23505 error so consecutive calls also return 409.
      const res = await request(testApp)
        .post("/api/admin/transparency")
        .set("Authorization", `Bearer ${TEST_TOKEN}`)
        .set("Content-Type", "application/json")
        .send({
          periodYear:          2035,
          periodMonth:         12,
          expensesCents:       0,
          donationsCents:      0,
          goalFoundationCents: 0,
          notes:               null,
          invoiceUrls:         [],
        });

      expect(
        res.status,
        "A 23505 DB error must never surface as a 500",
      ).not.toBe(500);
    },
    30_000,
  );
});
