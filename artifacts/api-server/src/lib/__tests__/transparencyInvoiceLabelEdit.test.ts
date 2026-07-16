/**
 * Integration guard: confirms that editing an invoice label on an already-
 * uploaded invoice (via PUT /admin/transparency/:id) persists correctly —
 * the updated label is stored, no file re-upload is needed, and both invoice
 * URLs survive the round-trip intact.
 *
 * Flow:
 *  1. POST  /api/admin/transparency  — create a month record with two invoices.
 *  2. PUT   /api/admin/transparency/:id — update only the label on invoice[0];
 *     invoice[1] label and both URLs are passed through unchanged.
 *  3. GET   /api/transparency          — fetch all months and find the record.
 *  4. Assert the new label is stored and both URLs are intact.
 *
 * Uses a sentinel period (year=1900, month=1) that will never collide with
 * real data. The record is deleted in afterAll to keep the DB clean.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { db, transparencyMonthsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_PERIOD_YEAR = 1900;
const TEST_PERIOD_MONTH = 1;

// Fake pre-uploaded object paths — no actual file upload is performed.
const INVOICE_A = { label: "Original label A", url: "/objects/invoices/test-file-a.pdf" };
const INVOICE_B = { label: "Label B stays unchanged", url: "/objects/invoices/test-file-b.pdf" };
const UPDATED_LABEL_A = "Updated label A — no re-upload";

/** Admin password injected for the test session. */
const ADMIN_PASSWORD = "transparency-label-edit-test-pw";

// ── Helpers ───────────────────────────────────────────────────────────────────

function authHeader() {
  return { Authorization: `Bearer ${ADMIN_PASSWORD}` };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

let createdId: number | undefined;

beforeAll(() => {
  // The requireAdminPassword middleware reads ADMIN_PASSWORD at request time,
  // so setting it here (before any request is made) is sufficient.
  process.env["ADMIN_PASSWORD"] = ADMIN_PASSWORD;
});

afterAll(async () => {
  // Clean up the sentinel record so repeated test runs don't conflict.
  if (createdId != null) {
    await db
      .delete(transparencyMonthsTable)
      .where(eq(transparencyMonthsTable.id, createdId));
  }
  delete process.env["ADMIN_PASSWORD"];
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PUT /admin/transparency/:id — invoice label edit without file re-upload", () => {
  it(
    "persists the new label and keeps both invoice URLs intact",
    async () => {
      // ── Step 1: create a month record with two invoices ──────────────────
      const postRes = await request(app)
        .post("/api/admin/transparency")
        .set(authHeader())
        .send({
          periodYear: TEST_PERIOD_YEAR,
          periodMonth: TEST_PERIOD_MONTH,
          expensesCents: 10_000,
          donationsCents: 5_000,
          goalFoundationCents: 2_000,
          invoiceUrls: [INVOICE_A, INVOICE_B],
          notes: "test record — invoice label edit guard",
        });

      expect(
        postRes.status,
        `POST /admin/transparency failed (${postRes.status}): ${JSON.stringify(postRes.body)}`,
      ).toBe(201);

      createdId = (postRes.body as { month?: { id?: number } }).month?.id;
      expect(typeof createdId).toBe("number");

      // ── Step 2: update only the label on invoice[0] ──────────────────────
      // Both invoices are sent back in full; only label A changes.
      // This mirrors what the frontend does: it round-trips the full
      // invoiceUrls array with the edited label, never re-uploading the file.
      const putRes = await request(app)
        .put(`/api/admin/transparency/${createdId}`)
        .set(authHeader())
        .send({
          expensesCents: 10_000,
          donationsCents: 5_000,
          goalFoundationCents: 2_000,
          invoiceUrls: [
            { label: UPDATED_LABEL_A, url: INVOICE_A.url },
            { label: INVOICE_B.label, url: INVOICE_B.url },
          ],
          notes: "test record — invoice label edit guard",
        });

      expect(
        putRes.status,
        `PUT /admin/transparency/${createdId} failed (${putRes.status}): ${JSON.stringify(putRes.body)}`,
      ).toBe(200);

      expect((putRes.body as { ok?: boolean }).ok).toBe(true);

      // ── Step 3: GET all months and locate our test record ─────────────────
      const getRes = await request(app)
        .get("/api/transparency")
        .expect(200);

      const months = (getRes.body as { months?: { id: number; invoiceUrls: { label: string; url: string }[] }[] }).months ?? [];
      const record = months.find((m) => m.id === createdId);

      expect(
        record,
        `Test record (id=${createdId}) not found in GET /api/transparency response`,
      ).toBeDefined();

      const invoiceUrls = record!.invoiceUrls;

      // ── Step 4: assert the updated label and intact URLs ──────────────────

      // Invoice A: label updated, URL unchanged.
      const invoiceA = invoiceUrls.find((inv) => inv.url === INVOICE_A.url);
      expect(
        invoiceA,
        `Invoice A URL (${INVOICE_A.url}) missing from stored invoiceUrls after PUT`,
      ).toBeDefined();
      expect(invoiceA!.label).toBe(UPDATED_LABEL_A);

      // Invoice B: both label and URL untouched.
      const invoiceB = invoiceUrls.find((inv) => inv.url === INVOICE_B.url);
      expect(
        invoiceB,
        `Invoice B URL (${INVOICE_B.url}) missing from stored invoiceUrls after PUT`,
      ).toBeDefined();
      expect(invoiceB!.label).toBe(INVOICE_B.label);

      // Sanity: exactly two invoices stored (no duplication or deletion).
      expect(invoiceUrls).toHaveLength(2);
    },
    30_000 /* generous timeout for DB pool startup */,
  );
});
