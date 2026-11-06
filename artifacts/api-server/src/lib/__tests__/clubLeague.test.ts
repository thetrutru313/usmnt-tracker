import { describe, expect, it } from "vitest";
import { pickClubLeague } from "../clubLeague.js";

const f = (name: string, n = 1) => Array.from({ length: n }, () => ({ league: { name } }));

describe("pickClubLeague", () => {
  it("ignores a preseason friendly that comes first", () => {
    expect(pickClubLeague([...f("Friendlies Clubs", 3), ...f("Premier League", 2)])).toBe("Premier League");
  });
  it("ignores preseason summer series named after a league", () => {
    expect(pickClubLeague([...f("Premier League - Summer Series", 3), ...f("Premier League", 2)])).toBe("Premier League");
  });
  it("prefers the competition played most often over a cup", () => {
    expect(pickClubLeague([...f("Copa del Rey", 2), ...f("Segunda División RFEF - Group 2", 5)])).toBe("Segunda División RFEF - Group 2");
  });
  it("returns null when only friendlies are known", () => {
    expect(pickClubLeague(f("Friendlies Clubs", 4))).toBeNull();
  });
  it("returns null for an empty fixture list", () => {
    expect(pickClubLeague([])).toBeNull();
  });
});
