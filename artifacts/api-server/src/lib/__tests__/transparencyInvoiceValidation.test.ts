/**
 * Integration guard: confirms that PUT /admin/transparency/:id rejects
 * invoiceUrls entries that are missing required fields.
 *
 * Flow:
 *  1. POST  /api/admin/transparency  — create a sentinel month record.
 *  2. PUT   /api/admin/transparency/:id — send an invoiceUrls array with an
 *     entry missing `url` → expect 400.
 *  3. PUT   /api/admin/transparency/:id — send an invoiceUrls array with an
 *     entry missing `label` → expect 400.
 *  4. Confirm the record is still unchanged (no partial write occurred).
 *
 * Uses a sentinel period (year=1901, month=2) that will never collide with
 * real data. The record is deleted in afterAll to keep the DB clean.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { db, transparencyMonthsTable, adminSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashToken } from "../../lib/tokenUtils.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_PERIOD_YEAR = 1901;
const TEST_PERIOD_MONTH = 2;

const VALID_INVOICE = { label: "Valid Invoice", url: "/objects/invoices/valid.pdf" };

/** Admin password injected for the test session. */
const ADMIN_PASSWORD = "transparency-invoice-validation-test-pw";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Populated by beforeAll after the verify call. */
let sessionToken = "";

function authHeader() {
  return { Authorization: `Bearer ${sessionToken}` };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

let createdId: number | undefined;

beforeAll(async () => {
  process.env["ADMIN_PASSWORD"] = ADMIN_PASSWORD;
  // Obtain a server-issued session token. The raw ADMIN_PASSWORD is only
  // accepted at the verify endpoint — all other admin routes require the token.
  const verifyRes = await request(app)
    .post("/api/admin/transparency/verify")
    .set({ Authorization: `Bearer ${ADMIN_PASSWORD}` });
  sessionToken = (verifyRes.body as { token: string }).token;
});

afterAll(async () => {
  // Delete the session row directly — logout only sets revoked_at, which
  // leaves a dead row until the daily sweep. A hard delete is cleaner for tests.
  if (sessionToken) {
    await db
      .delete(adminSessionsTable)
      .where(eq(adminSessionsTable.tokenHash, hashToken(sessionToken)));
  }
  if (createdId != null) {
    await db
      .delete(transparencyMonthsTable)
      .where(eq(transparencyMonthsTable.id, createdId));
  }
  delete process.env["ADMIN_PASSWORD"];
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PUT /admin/transparency/:id — invoiceUrls field validation", () => {
  beforeAll(async () => {
    // Create a sentinel record to update in the validation tests.
    const postRes = await request(app)
      .post("/api/admin/transparency")
      .set(authHeader())
      .send({
        periodYear: TEST_PERIOD_YEAR,
        periodMonth: TEST_PERIOD_MONTH,
        expensesCents: 1_000,
        donationsCents: 500,
        goalFoundationCents: 0,
        invoiceUrls: [VALID_INVOICE],
        notes: "test record — invoice validation guard",
      });

    expect(
      postRes.status,
      `POST /admin/transparency failed (${postRes.status}): ${JSON.stringify(postRes.body)}`,
    ).toBe(201);

    createdId = (postRes.body as { month?: { id?: number } }).month?.id;
    expect(typeof createdId).toBe("number");
  }, 30_000);

  it(
    "returns 400 when an invoiceUrls entry is missing the url field",
    async () => {
      const putRes = await request(app)
        .put(`/api/admin/transparency/${createdId}`)
        .set(authHeader())
        .send({
          expensesCents: 1_000,
          donationsCents: 500,
          goalFoundationCents: 0,
          // Entry has label but no url
          invoiceUrls: [{ label: "Missing URL entry" }],
          notes: "test record — invoice validation guard",
        });

      expect(
        putRes.status,
        `Expected 400 for missing url, got ${putRes.status}: ${JSON.stringify(putRes.body)}`,
      ).toBe(400);

      expect((putRes.body as { error?: string }).error).toMatch(/url/i);
    },
    30_000,
  );

  it(
    "returns 400 when an invoiceUrls entry is missing the label field",
    async () => {
      const putRes = await request(app)
        .put(`/api/admin/transparency/${createdId}`)
        .set(authHeader())
        .send({
          expensesCents: 1_000,
          donationsCents: 500,
          goalFoundationCents: 0,
          // Entry has url but no label
          invoiceUrls: [{ url: "/objects/invoices/no-label.pdf" }],
          notes: "test record — invoice validation guard",
        });

      expect(
        putRes.status,
        `Expected 400 for missing label, got ${putRes.status}: ${JSON.stringify(putRes.body)}`,
      ).toBe(400);

      expect((putRes.body as { error?: string }).error).toMatch(/label/i);
    },
    30_000,
  );

  it(
    "confirms the record was not modified by the rejected requests",
    async () => {
      const getRes = await request(app)
        .get("/api/transparency")
        .expect(200);

      const months = (
        getRes.body as { months?: { id: number; invoiceUrls: { label: string; url: string }[] }[] }
      ).months ?? [];
      const record = months.find((m) => m.id === createdId);

      expect(
        record,
        `Test record (id=${createdId}) not found in GET /api/transparency response`,
      ).toBeDefined();

      // Original invoice should still be intact — no partial write occurred.
      expect(record!.invoiceUrls).toHaveLength(1);
      expect(record!.invoiceUrls[0]?.url).toBe(VALID_INVOICE.url);
      expect(record!.invoiceUrls[0]?.label).toBe(VALID_INVOICE.label);
    },
    30_000,
  );
});
