/**
 * Integration guard: confirms that omitting an invoice entry from the
 * invoiceUrls array in a PUT /admin/transparency/:id request permanently
 * removes it — the dropped invoice must not reappear after the update.
 *
 * Flow:
 *  1. POST  /api/admin/transparency  — create a month record with two invoices.
 *  2. PUT   /api/admin/transparency/:id — send only one invoice (the second is
 *     intentionally omitted to delete it).
 *  3. GET   /api/transparency          — fetch all months and find the record.
 *  4. Assert exactly one invoice is stored (the omitted one is gone).
 *
 * Uses a sentinel period (year=1900, month=2) that will never collide with
 * real data. The record is deleted in afterAll to keep the DB clean.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { db, transparencyMonthsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_PERIOD_YEAR = 1900;
const TEST_PERIOD_MONTH = 2;

// Fake pre-uploaded object paths — no actual file upload is performed.
const INVOICE_A = { label: "Invoice A — kept", url: "/objects/invoices/deletion-test-file-a.pdf" };
const INVOICE_B = { label: "Invoice B — deleted", url: "/objects/invoices/deletion-test-file-b.pdf" };

/** Admin password injected for the test session. */
const ADMIN_PASSWORD = "transparency-invoice-deletion-test-pw";

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
  // Revoke the session server-side so the row doesn't linger.
  if (sessionToken) {
    await request(app)
      .post("/api/admin/logout")
      .set({ Authorization: `Bearer ${sessionToken}` });
  }
  // Clean up the sentinel record so repeated test runs don't conflict.
  if (createdId != null) {
    await db
      .delete(transparencyMonthsTable)
      .where(eq(transparencyMonthsTable.id, createdId));
  }
  delete process.env["ADMIN_PASSWORD"];
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PUT /admin/transparency/:id — invoice entry deletion", () => {
  it(
    "fully removes the omitted invoice and does not ghost it back",
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
          notes: "test record — invoice deletion guard",
        });

      expect(
        postRes.status,
        `POST /admin/transparency failed (${postRes.status}): ${JSON.stringify(postRes.body)}`,
      ).toBe(201);

      createdId = (postRes.body as { month?: { id?: number } }).month?.id;
      expect(typeof createdId).toBe("number");

      // Sanity: both invoices created.
      const createdInvoices = (postRes.body as { month?: { invoiceUrls?: unknown[] } }).month?.invoiceUrls ?? [];
      expect(createdInvoices).toHaveLength(2);

      // ── Step 2: PUT with only invoice A — invoice B intentionally omitted ─
      const putRes = await request(app)
        .put(`/api/admin/transparency/${createdId}`)
        .set(authHeader())
        .send({
          expensesCents: 10_000,
          donationsCents: 5_000,
          goalFoundationCents: 2_000,
          invoiceUrls: [INVOICE_A],
          notes: "test record — invoice deletion guard",
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

      const months = (
        getRes.body as {
          months?: { id: number; invoiceUrls: { label: string; url: string }[] }[];
        }
      ).months ?? [];
      const record = months.find((m) => m.id === createdId);

      expect(
        record,
        `Test record (id=${createdId}) not found in GET /api/transparency response`,
      ).toBeDefined();

      const invoiceUrls = record!.invoiceUrls;

      // ── Step 4: assert exactly one invoice remains and it is invoice A ─────

      // Only one invoice should be stored — invoice B must be gone.
      expect(
        invoiceUrls,
        `Expected exactly 1 invoice after deletion but got ${invoiceUrls.length}: ${JSON.stringify(invoiceUrls)}`,
      ).toHaveLength(1);

      // Invoice A must still be present with its original label and URL.
      const invoiceA = invoiceUrls.find((inv) => inv.url === INVOICE_A.url);
      expect(
        invoiceA,
        `Invoice A (${INVOICE_A.url}) is missing — it should have been kept`,
      ).toBeDefined();
      expect(invoiceA!.label).toBe(INVOICE_A.label);

      // Invoice B must not appear (not as a ghost entry).
      const invoiceB = invoiceUrls.find((inv) => inv.url === INVOICE_B.url);
      expect(
        invoiceB,
        `Invoice B (${INVOICE_B.url}) still appears after deletion — ghost entry detected`,
      ).toBeUndefined();
    },
    30_000 /* generous timeout for DB pool startup */,
  );
});
