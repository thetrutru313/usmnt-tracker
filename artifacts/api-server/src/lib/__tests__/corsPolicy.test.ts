import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { NextFunction, Request, Response } from "express";

const spies = vi.hoisted(() => ({
  route: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// Exercise the real app middleware without loading DB-backed routes or writing
// data. The probe proves that rejected requests never reach a route handler.
vi.mock("../../routes", async () => {
  const { Router } = await import("express");
  const router = Router();
  router.all("/cors-probe", (_req, res) => {
    spies.route();
    res.json({ ok: true });
  });
  return { default: router };
});
vi.mock("../logger", () => ({
  logger: { warn: spies.warn, error: spies.error },
}));
vi.mock("pino-http", () => ({
  default: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

async function loadApp(mode = "development") {
  vi.stubEnv("NODE_ENV", mode);
  return (await import("../../app")).default;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("ALLOWED_ORIGINS", "https://allowed.example");
  vi.stubEnv("REPLIT_DEV_DOMAIN", "");
  vi.stubEnv("REPLIT_DOMAINS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("CORS policy — actual app middleware", () => {
  it("1: allows IPv4 loopback in non-production, with or without a port", async () => {
    const app = await loadApp();
    for (const origin of ["http://127.0.0.1:5173", "http://127.0.0.1"]) {
      const res = await request(app).get("/api/cors-probe").set("Origin", origin);
      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe(origin);
    }
    expect(spies.route).toHaveBeenCalledTimes(2);
  });

  it("2: allows IPv6 loopback in non-production, with or without a port", async () => {
    const app = await loadApp();
    for (const origin of ["http://[::1]:5173", "http://[::1]"]) {
      const res = await request(app).get("/api/cors-probe").set("Origin", origin);
      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe(origin);
    }
    expect(spies.route).toHaveBeenCalledTimes(2);
  });

  it("3: still allows localhost in non-production, with or without a port", async () => {
    const app = await loadApp();
    for (const origin of ["http://localhost:5173", "http://localhost"]) {
      const res = await request(app).get("/api/cors-probe").set("Origin", origin);
      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe(origin);
    }
  });

  it("4: rejects IPv4, IPv6 and localhost loopback with 403 in production", async () => {
    const app = await loadApp("production");
    for (const origin of ["http://127.0.0.1:5173", "http://[::1]:5173", "http://localhost:5173"]) {
      const res = await request(app).get("/api/cors-probe").set("Origin", origin);
      expect(res.status).toBe(403);
      expect(res.body.error).toContain(origin);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    }
    expect(spies.route).not.toHaveBeenCalled();
  });

  it("5: rejects an unlisted origin server-side with 403, names it, and logs WARN", async () => {
    const app = await loadApp();
    const origin = "https://rejected.example";
    for (const method of ["get", "post", "options"] as const) {
      const res = await request(app)[method]("/api/cors-probe")
        .set("Origin", origin)
        .set("Access-Control-Request-Method", "POST");
      expect(res.status).toBe(403);
      expect(res.body.error).toContain(origin);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    }
    expect(spies.route).not.toHaveBeenCalled();
    expect(spies.warn).toHaveBeenCalledTimes(3);
    expect(spies.warn).toHaveBeenCalledWith(
      { origin },
      `CORS: origin not allowed — ${origin}`,
    );
    expect(spies.error).not.toHaveBeenCalled();
  });

  it("6: still allows requests without an Origin header in dev and production", async () => {
    for (const mode of ["development", "production"]) {
      vi.resetModules();
      const app = await loadApp(mode);
      const res = await request(app).get("/api/cors-probe");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    }
  });

  it("7: still allows explicitly allowlisted origins in dev and production", async () => {
    for (const mode of ["development", "production"]) {
      vi.resetModules();
      const app = await loadApp(mode);
      const res = await request(app).get("/api/cors-probe")
        .set("Origin", "https://allowed.example");
      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe("https://allowed.example");
    }
  });

  it("does not allow non-loopback hosts, lookalikes, paths, or HTTPS through the dev gate", async () => {
    const app = await loadApp();
    for (const origin of [
      "http://127.0.0.2:5173", "http://[::2]:5173",
      "http://localhost.attacker.example:5173",
      "http://127.0.0.1.attacker.example:5173",
      "http://localhost:5173/path", "https://localhost:5173",
    ]) {
      const res = await request(app).get("/api/cors-probe").set("Origin", origin);
      expect(res.status).not.toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    }
    expect(spies.route).not.toHaveBeenCalled();
  });
});
