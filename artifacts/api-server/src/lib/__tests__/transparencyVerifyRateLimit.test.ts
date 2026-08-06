/**
 * Regression guard: the 6th login attempt to POST /admin/transparency/verify
 * within a 15-minute window must return 429.
 *
 * Uses the full app (supertest) because this tests Express middleware ordering,
 * not DB logic.  Requires DATABASE_URL (transitively, via app → queries.ts →
 * @workspace/db).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";

const ADMIN_PASSWORD = "transparency-verify-rate-limit-test-pw";

function authHeader() {
  return { Authorization: `Bearer ${ADMIN_PASSWORD}` };
}

describe("POST /admin/transparency/verify — brute-force rate limit", () => {
  beforeAll(() => {
    process.env["ADMIN_PASSWORD"] = ADMIN_PASSWORD;
  });

  afterAll(() => {
    delete process.env["ADMIN_PASSWORD"];
  });

  it(
    "allows the first 5 requests within 15 minutes",
    async () => {
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post("/api/admin/transparency/verify")
          .set(authHeader());
        expect(
          res.status,
          `Request ${i + 1} should succeed (200), got ${res.status}: ${JSON.stringify(res.body)}`,
        ).toBe(200);
      }
    },
    30_000,
  );

  it(
    "returns 429 on the 6th request within the same window",
    async () => {
      const res = await request(app)
        .post("/api/admin/transparency/verify")
        .set(authHeader());
      expect(
        res.status,
        `6th request should be rate-limited (429), got ${res.status}: ${JSON.stringify(res.body)}`,
      ).toBe(429);
    },
    30_000,
  );
});
