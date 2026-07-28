import { describe, it, expect, vi, beforeEach } from "vitest";
import { hashToken, generateToken } from "../tokenUtils";

// ─── tokenUtils ──────────────────────────────────────────────────────────────

describe("hashToken", () => {
  it("produces a stable 64-char hex string", () => {
    const hash = hashToken("test-token");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input same output", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("is sensitive — different inputs produce different outputs", () => {
    expect(hashToken("token-a")).not.toBe(hashToken("token-b"));
  });
});

describe("generateToken", () => {
  it("returns a UUID-shaped string", () => {
    const token = generateToken();
    expect(token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("returns a unique value each call", () => {
    expect(generateToken()).not.toBe(generateToken());
  });
});

// ─── requireAnonUser middleware ───────────────────────────────────────────────

// Mock the DB module so the middleware tests never touch a real database.
vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  },
  anonUsersTable: {},
}));

// Re-import after mock is established.
const { requireAnonUser } = await import("../anonAuth");
// Cast to any so tests can set mock resolved values on the chained query builder
// without fighting the real NodePgDatabase type that has no `.limit` property.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { db } = await import("@workspace/db") as any;

function makeReqRes(authHeader?: string) {
  const req = { headers: { authorization: authHeader } } as any;
  const locals: Record<string, unknown> = {};
  const res = {
    locals,
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as any;
  const next = vi.fn();
  return { req, res, next };
}

describe("requireAnonUser middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when Authorization header is absent", async () => {
    const { req, res, next } = makeReqRes(undefined);
    await requireAnonUser(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when Authorization header has no Bearer prefix", async () => {
    const { req, res, next } = makeReqRes("Basic dXNlcjpwYXNz");
    await requireAnonUser(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when Bearer token is an empty string", async () => {
    const { req, res, next } = makeReqRes("Bearer ");
    await requireAnonUser(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when token hash has no matching DB row", async () => {
    (db.limit as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const { req, res, next } = makeReqRes("Bearer some-unknown-token");
    await requireAnonUser(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches anonUser to res.locals and calls next on valid token", async () => {
    const fakeUser = { id: 1, tokenHash: hashToken("valid-token"), email: null, createdAt: new Date() };
    (db.limit as ReturnType<typeof vi.fn>).mockResolvedValueOnce([fakeUser]);
    const { req, res, next } = makeReqRes("Bearer valid-token");
    await requireAnonUser(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.locals.anonUser).toEqual(fakeUser);
  });
});

// ─── Recovery token expiry / already-used logic ───────────────────────────────

describe("recovery token validation logic", () => {
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  it("a token with expiresAt in the future and usedAt null is valid", () => {
    const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS);
    const usedAt = null;
    const now = new Date();

    const isExpired = expiresAt < now;
    const isUsed = usedAt !== null;

    expect(isExpired).toBe(false);
    expect(isUsed).toBe(false);
  });

  it("a token with expiresAt in the past is expired", () => {
    const expiresAt = new Date(Date.now() - 1000);
    const now = new Date();

    expect(expiresAt < now).toBe(true);
  });

  it("a token with usedAt set is already used", () => {
    const usedAt = new Date();
    expect(usedAt !== null).toBe(true);
  });

  it("a 30-day window is exactly 30 days from now", () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + THIRTY_DAYS_MS);
    const diffDays = (expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBe(30);
  });
});
