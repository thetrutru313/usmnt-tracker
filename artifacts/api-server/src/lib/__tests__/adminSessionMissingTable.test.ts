/**
 * Guard: confirms that requireAdminSession returns HTTP 503 (not 500) when the
 * admin_sessions table does not yet exist in the database.
 *
 * This situation can arise during a deploy where application code reaches
 * production before the Publish flow has applied the new migration. A 503
 * tells the client "not ready" rather than a confusing "internal error".
 *
 * Tier: mock (mocks @workspace/db — no DATABASE_URL required).
 */

import { vi, describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Mock @workspace/db to throw a "relation does not exist" error for the
// admin_sessions query, simulating a pre-migration production database.
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockRejectedValue(
            new Error('relation "admin_sessions" does not exist'),
          ),
        }),
      }),
    }),
  },
  adminSessionsTable: { _table: "admin_sessions" },
}));

vi.mock("drizzle-orm", () => ({
  eq:     (_col: unknown, _val: unknown) => ({ _eq: [_col, _val] }),
  and:    (...args: unknown[])           => ({ _and: args }),
  gt:     (_col: unknown, _val: unknown) => ({ _gt: [_col, _val] }),
  isNull: (_col: unknown)                => ({ _isNull: _col }),
}));

// Import after mocks are registered
import { requireAdminSession } from "../adminAuth.js";

// ---------------------------------------------------------------------------
// Build a minimal Express app that gates one endpoint behind requireAdminSession
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json());
  app.get("/protected", requireAdminSession, (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("requireAdminSession — missing admin_sessions table", () => {
  it("returns 503 (not 500) when the admin_sessions table does not exist", async () => {
    // ADMIN_PASSWORD must be set so the middleware reaches the DB query
    process.env["ADMIN_PASSWORD"] = "test-pw-for-missing-table";

    const app = buildApp();

    const res = await request(app)
      .get("/protected")
      .set("Authorization", "Bearer some-session-token");

    expect(res.status).toBe(503);
    // Must not leak a generic 500 "Internal Server Error"
    expect(res.status).not.toBe(500);

    delete process.env["ADMIN_PASSWORD"];
  });
});
