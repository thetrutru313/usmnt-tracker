/**
 * Unit tests for `isTeamNational` — the DB-cached team-identity resolver
 * behind the DUAL_NATIONAL false-positive fix. Mocks `@workspace/db` and
 * `afFetch` so these run as fast, deterministic unit tests rather than
 * hitting a real database or API-Football.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const selectMock = vi.fn();
const insertMock = vi.fn();
const afFetchMock = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: selectMock,
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: insertMock,
      }),
    }),
  },
  apiFootballTeamsTable: {},
}));

vi.mock("../apiFootballSync", () => ({
  afFetch: afFetchMock,
  isLikelyNationalTeamName: (name: string) => {
    const trimmed = name.trim();
    return trimmed === "USA" || trimmed === "United States" || /\bU(1[5-9]|2[0-3])\b/.test(trimmed);
  },
}));

vi.mock("../logger", () => ({
  logger: { warn: vi.fn() },
}));

const { isTeamNational } = await import("../teamNationalityCache");

beforeEach(() => {
  selectMock.mockReset();
  insertMock.mockReset();
  afFetchMock.mockReset();
});

describe("isTeamNational", () => {
  it("returns the cached value and never calls afFetch on a cache hit", async () => {
    selectMock.mockResolvedValue([{ apiFootballTeamId: 1595, isNational: false }]);
    const result = await isTeamNational(1595, "Seattle Sounders");
    expect(result).toBe(false);
    expect(afFetchMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("fetches, caches, and returns true for a real national team on a cache miss", async () => {
    selectMock.mockResolvedValue([]);
    afFetchMock.mockResolvedValue([{ team: { id: 5529, name: "Canada", country: "Canada", national: true } }]);
    const result = await isTeamNational(5529, "Canada");
    expect(result).toBe(true);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("uses the name backstop when API-Football's national flag is a known false negative (youth team)", async () => {
    selectMock.mockResolvedValue([]);
    afFetchMock.mockResolvedValue([
      { team: { id: 10306, name: "United States U20", country: "USA", national: false } },
    ]);
    const result = await isTeamNational(10306, "United States U20");
    expect(result).toBe(true);
  });

  it("fails closed (returns false) without throwing when the id is missing", async () => {
    const result = await isTeamNational(undefined, "Some Team");
    expect(result).toBe(false);
    expect(afFetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when API-Football returns no team", async () => {
    selectMock.mockResolvedValue([]);
    afFetchMock.mockResolvedValue([]);
    const result = await isTeamNational(999999, "Ghost Team");
    expect(result).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("fails closed when the /teams lookup throws", async () => {
    selectMock.mockResolvedValue([]);
    afFetchMock.mockRejectedValue(new Error("network error"));
    const result = await isTeamNational(1616, "Los Angeles FC");
    expect(result).toBe(false);
  });

  it("does not treat a real club as national just because its name resembles a youth academy squad", async () => {
    selectMock.mockResolvedValue([]);
    afFetchMock.mockResolvedValue([
      { team: { id: 4242, name: "Club Reserves U19", country: "USA", national: false } },
    ]);
    // This is a documented, accepted trade-off (see isLikelyNationalTeamName
    // docstring in apiFootballSync.ts) — a club's own U19 side reads as
    // "national" by name pattern too. It only matters for the youth-cap
    // bucket, and youth blocks never affect DUAL_NATIONAL status.
    const result = await isTeamNational(4242, "Club Reserves U19");
    expect(result).toBe(true);
  });
});
