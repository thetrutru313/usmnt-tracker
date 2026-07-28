import { describe, it, expect } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import rateLimit from "express-rate-limit";

// ---------------------------------------------------------------------------
// Unit tests for the per-IP rate limiter on POST /follows/users.
//
// These tests instantiate a minimal Express app with the same limiter
// configuration used in the real route — without touching the database — so
// they run fast, in-process, and without external dependencies.
// ---------------------------------------------------------------------------

function buildTestApp(max: number): Express {
  const app = express();

  // Mirror the production setting: trust one proxy hop so req.ip comes from
  // X-Forwarded-For rather than the socket address.
  app.set("trust proxy", 1);

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes — matches the real limiter
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many account creation requests, please try again later." },
  });

  app.post("/follows/users", limiter, (_req, res) => {
    res.status(201).json({ token: "fake-token" });
  });

  return app;
}

describe("POST /follows/users — per-IP rate limit", () => {
  it("allows requests up to the limit (5) and returns 201 for each", async () => {
    const app = buildTestApp(5);

    for (let i = 1; i <= 5; i++) {
      const res = await request(app)
        .post("/follows/users")
        .set("X-Forwarded-For", "1.2.3.4");
      expect(res.status, `request ${i} should succeed`).toBe(201);
    }
  });

  it("returns 429 on the 6th request from the same IP within the window", async () => {
    const app = buildTestApp(5);

    // Exhaust the 5-request allowance
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post("/follows/users")
        .set("X-Forwarded-For", "1.2.3.4");
    }

    // 6th request must be rejected
    const res = await request(app)
      .post("/follows/users")
      .set("X-Forwarded-For", "1.2.3.4");

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({
      error: "Too many account creation requests, please try again later.",
    });
  });

  it("does not count requests from a different IP against another client's bucket", async () => {
    const app = buildTestApp(5);

    // Exhaust the allowance for IP A
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post("/follows/users")
        .set("X-Forwarded-For", "10.0.0.1");
    }

    // IP B has its own fresh bucket — should still be allowed
    const res = await request(app)
      .post("/follows/users")
      .set("X-Forwarded-For", "10.0.0.2");

    expect(res.status).toBe(201);
  });

  it("includes RateLimit-* headers on successful responses", async () => {
    const app = buildTestApp(5);

    const res = await request(app)
      .post("/follows/users")
      .set("X-Forwarded-For", "2.3.4.5");

    expect(res.status).toBe(201);
    // standardHeaders: true emits RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset
    expect(res.headers).toHaveProperty("ratelimit-limit");
    expect(res.headers).toHaveProperty("ratelimit-remaining");
  });
});
