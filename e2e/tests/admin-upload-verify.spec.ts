/**
 * Admin transparency invoice upload — CSP round-trip verification
 *
 * Verifies that the 2026-08-07 connect-src fix unblocked the upload path:
 *   1. POST /admin/transparency/upload-url → 200 (server intact)
 *   2. Browser PUT directly to storage.googleapis.com → 200 (CSP now permits it)
 *   3. No connect-src CSP violation in the browser console
 *   4. POST /admin/transparency (save month) → 201 first run / 409 re-run
 *   5. Invoice download link → 200 or 302 (server-side auth check passes)
 *
 * Teardown: afterAll deletes the 2035-12 test fixture from the DB so it does
 * not appear on the public /transparency page.  The uploaded GCS object is
 * left in place (no admin delete-object API exists); it is inaccessible
 * without a saved DB reference because the download route validates the path
 * against transparency_months.invoice_urls before signing.
 *
 * Run in isolation:
 *   pnpm --filter @workspace/e2e run test -- tests/admin-upload-verify.spec.ts
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { test, expect, type Page } from "@playwright/test";

// Override per-test timeout: sidecar sign (≤30 s) + GCS PUT + API save.
test.setTimeout(120_000);

// Disable Playwright's auto-retry: repeated login attempts within seconds
// can trigger the API server's rate limiter, causing the retry to hang.
test.describe.configure({ retries: 0 });

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "Pudnyw-gewvo2-pa";
const GCS_BUCKET     = "replit-objstore-7761b4b7-4dc3-42da-a4a4-8ade75ae1d75";

// ── State shared between the test body and afterAll ──────────────────────────

// Populated from the verify response during the test; reused for cleanup so
// afterAll does not need a second login (which would consume another rate-limit
// slot on POST /admin/transparency/verify).
let capturedToken = "";

// ─── Login helper ────────────────────────────────────────────────────────────

async function loginAdmin(page: Page) {
  await page.goto("admin");
  await page.waitForLoadState("load");

  // The password form renders while the session is not established.
  const passwordInput = page.locator('input[type="password"]').first();
  await expect(passwordInput).toBeVisible({ timeout: 15_000 });
  await passwordInput.fill(ADMIN_PASSWORD);
  await page.locator('button[type="submit"]').first().click();

  // "Monthly Transparency" is inside AdminPanel and only rendered after auth.
  // The login form also shows "Admin Panel" as its own heading, so we cannot
  // use h1 "Admin Panel" as the post-login landmark.
  await expect(
    page.locator("h2").filter({ hasText: /monthly transparency/i })
  ).toBeVisible({ timeout: 25_000 });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe("Admin transparency invoice upload round-trip", () => {
  // ── Teardown: remove the test fixture row from the public transparency page ─
  test.afterAll(async ({ request }) => {
    if (!capturedToken) return; // test did not complete login — nothing to clean up

    // The public transparency API returns all months including the test fixture.
    const res = await request.get("/api/transparency");
    if (!res.ok()) return;

    type Month = { id: number; periodYear: number; periodMonth: number; invoiceUrls: { url: string }[] };
    const { months } = await res.json() as { months: Month[] };
    const dec2035 = months.find((m) => m.periodYear === 2035 && m.periodMonth === 12);
    if (!dec2035) return; // already gone

    await request.delete(`/api/admin/transparency/${dec2035.id}`, {
      headers: { Authorization: `Bearer ${capturedToken}` },
    });
    // GCS object is intentionally left: it is inaccessible without a DB entry
    // and there is no admin delete-object endpoint.
  });

  test(
    "upload PUT reaches GCS and returns 200; download link reachable; no CSP violation",
    async ({ page }) => {

      // ── Track connect-src CSP violations ─────────────────────────────────────
      const cspViolations: string[] = [];
      page.on("console", (msg) => {
        const t = msg.text();
        if (msg.type() === "error" && t.includes("Content Security Policy") && t.includes("connect-src")) {
          cspViolations.push(t);
        }
      });

      // ── Capture response statuses for the key API calls ───────────────────────
      let uploadUrlStatus = -1;
      let gcsPutStatus    = -1;
      let gcsPutUrl       = "";
      let saveStatus      = -1;

      page.on("response", async (response) => {
        const url    = response.url();
        const method = response.request().method();

        // Step 1: upload-url POST (proxied through Vite → API server)
        if (url.includes("/api/admin/transparency/upload-url")) {
          uploadUrlStatus = response.status();
        }
        // Capture token from the verify response for afterAll cleanup.
        if (url.includes("/api/admin/transparency/verify") && method === "POST") {
          try {
            const body = await response.json() as { token?: string };
            if (body.token) capturedToken = body.token;
          } catch { /* ignore parse errors */ }
        }
        // Step 2: direct PUT to GCS (cross-origin, now permitted by CSP fix)
        if (url.includes("storage.googleapis.com") && method === "PUT") {
          gcsPutStatus = response.status();
          gcsPutUrl    = url;
        }
        // Step 4: save month POST
        if (url.includes("/api/admin/transparency") &&
            !url.includes("/upload-url") &&
            !url.includes("/invoice") &&
            !url.includes("/verify") &&
            method === "POST") {
          saveStatus = response.status();
        }
      });

      // ── Log in ────────────────────────────────────────────────────────────────
      await loginAdmin(page);

      // ── Locate the Monthly Transparency section ───────────────────────────────
      // h2 "Monthly Transparency" is inside a <section> (Admin.tsx:1068).
      const section = page
        .locator("section")
        .filter({ has: page.locator("h2", { hasText: /monthly transparency/i }) })
        .last();
      await section.scrollIntoViewIfNeeded();

      // ── Click "Add Month" to reveal the MonthForm (Admin.tsx:1074-1096) ──────
      // The form is only rendered when showForm===true.
      const addMonthBtn = section.locator("button", { hasText: /add month/i });
      await expect(addMonthBtn).toBeVisible({ timeout: 10_000 });
      await addMonthBtn.click();

      // Wait for MonthForm to mount — the h3 "Add Month" heading is the signal.
      const monthForm = section.locator("form").filter({
        has: page.locator("h3", { hasText: /add month/i }),
      });
      await expect(monthForm).toBeVisible({ timeout: 5_000 });

      // ── Fill year and month ───────────────────────────────────────────────────
      // year = input[type="number"] (first in the form, before expense fields)
      // month = <select> (second in the form)
      // 2035-12 is definitively unused and within the form's max={2035} constraint.
      const yearInput   = monthForm.locator('input[type="number"]').first();
      const monthSelect = monthForm.locator("select").first();
      await expect(yearInput).toBeVisible({ timeout: 5_000 });
      await yearInput.fill("2035");
      await monthSelect.selectOption({ value: "12" }); // December

      // ── Click "Add invoice" to open the pending-upload row ───────────────────
      const addInvoiceBtn = monthForm.locator("button", { hasText: /add invoice/i });
      await expect(addInvoiceBtn).toBeVisible({ timeout: 5_000 });
      await addInvoiceBtn.click();

      // Pending-label input appears (autoFocus, list="invoice-label-suggestions").
      const pendingLabelInput = monthForm.locator('input[list="invoice-label-suggestions"]');
      await expect(pendingLabelInput).toBeVisible({ timeout: 5_000 });
      await pendingLabelInput.fill("CSP verification invoice");

      // ── Create a small test PDF in /tmp and upload it ─────────────────────────
      const tmpFile = path.join(os.tmpdir(), "csp-verify.pdf");
      fs.writeFileSync(
        tmpFile,
        "%PDF-1.4\n1 0 obj<</Type /Catalog>>endobj\nCSP-verification-payload",
      );

      const fileInput = monthForm.locator('input[type="file"]');
      await fileInput.setInputFiles(tmpFile);

      // ── Wait for upload to complete ────────────────────────────────────────────
      // After upload success the invoice row appears inside monthForm with a
      // "View ↗" anchor.  We watch for that link inside the <form> (not the
      // records table) to distinguish our new invoice from pre-existing months.
      const viewLinkInsideForm = monthForm.locator("a", { hasText: "View ↗" }).first();
      await expect(viewLinkInsideForm).toBeVisible({ timeout: 60_000 });

      // ── Assertions after upload ───────────────────────────────────────────────

      // 1. Upload-url → 200
      expect(uploadUrlStatus, "POST /admin/transparency/upload-url should return 200").toBe(200);

      // 2. GCS PUT → 200 (this is what the CSP fix enables)
      expect(gcsPutUrl, "PUT should go to the correct GCS bucket").toMatch(
        new RegExp(`storage\\.googleapis\\.com/${GCS_BUCKET}`),
      );
      expect(gcsPutStatus, "PUT to GCS should return 200").toBe(200);

      // 3. No connect-src CSP violations
      expect(cspViolations, "No connect-src CSP violations should appear").toHaveLength(0);

      // ── Step 4: save the month ────────────────────────────────────────────────
      // 201 on first run (new record), 409 on re-runs (duplicate — the
      // transparency.ts create handler now correctly detects PG code 23505 and
      // returns 409 rather than 500).  500 is a genuine failure and not expected.
      const saveButton = monthForm.locator('button[type="submit"]').first();
      await expect(saveButton).toBeEnabled({ timeout: 5_000 });
      await saveButton.click();

      // Wait for the mutation to settle — button re-enables either on success
      // (after form closes) or on error (mutation resets).
      await expect(saveButton.or(section.locator("button", { hasText: /add month/i }))).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(500); // let the response event fire

      expect(
        [201, 409],
        `POST /admin/transparency should return 201 (new) or 409 (duplicate), got ${saveStatus}`,
      ).toContain(saveStatus);

      // ── Step 5: invoice download link is reachable ────────────────────────────
      // Fetch the public transparency API to get the saved 2035-12 record.
      // Works on first runs (save returned 201) and re-runs (save returned 409 —
      // the record already exists from the previous run).
      const savedMonth = await page.evaluate(async () => {
        const res = await fetch("/api/transparency");
        const json = await res.json() as {
          months: { periodYear: number; periodMonth: number; invoiceUrls: { url: string; label: string }[] }[];
        };
        return json.months.find((m) => m.periodYear === 2035 && m.periodMonth === 12) ?? null;
      });
      expect(savedMonth, "2035-12 record must exist in the public transparency API").not.toBeNull();
      const firstInvoice = savedMonth!.invoiceUrls[0];
      expect(firstInvoice, "2035-12 record must have at least one invoice URL").toBeDefined();

      // The invoice URL stored is an objectPath like "/objects/uploads/<uuid>".
      // The download route strips the "/objects/" prefix:
      //   GET /api/transparency/invoice/uploads/<uuid>
      const objectPath  = firstInvoice.url;
      const invoicePath = objectPath.replace(/^\/objects\//, "");
      const invoiceHref = `/api/transparency/invoice/${invoicePath}`;

      const downloadStatus = await page.evaluate(async (href: string) => {
        try {
          const res = await fetch(href, { redirect: "manual" });
          return res.status;
        } catch {
          return -1;
        }
      }, invoiceHref);

      // 200 = direct serve
      // 302 = signed-URL redirect to GCS (expected in prod)
      // 0   = opaque redirect — Fetch API's status when redirect:"manual" and the
      //       server returns a 3xx.  Dev returns 0: API server redirects to a
      //       signed GCS URL and the browser returns an opaqueredirect response.
      //       This proves the route exists and the redirect was issued correctly.
      expect(
        [200, 302, 0],
        `Invoice download (${invoiceHref}) should return 200, 302, or opaque-redirect (0), got ${downloadStatus}`,
      ).toContain(downloadStatus);
    },
  );
});
