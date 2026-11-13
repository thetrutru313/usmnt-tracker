import { describe, expect, it } from "vitest";
import { displaySeasonLabel, leagueCurrentLabel, resolvePlayerSeasons, type SeasonRow } from "../leagueSeasons";

const rows: SeasonRow[] = [
  [39, "Premier League", 2025, "2025/2026", "2025-08-15"],
  [39, "Premier League", 2026, "2026/2027", "2026-08-21"],
  [119, "Superliga (Denmark)", 2025, "2025/2026", "2025-07-18"],
  [119, "Superliga (Denmark)", 2026, "2026/2027", "2026-07-24"],
  [253, "Major League Soccer", 2025, "2025", "2025-02-22"],
  [253, "Major League Soccer", 2026, "2026", "2026-02-21"],
  [489, "USL League One", 2025, "2025", "2025-03-08"],
].map(([apiFootballLeagueId, leagueName, apiSeason, displayLabel, startDate]) => ({
  apiFootballLeagueId: Number(apiFootballLeagueId), leagueName: String(leagueName),
  apiSeason: Number(apiSeason), displayLabel: String(displayLabel), startDate: String(startDate),
}));
const resolve = (leagueId: number | null, today: string, labelsWithData: number[], data = rows) =>
  resolvePlayerSeasons({ leagueId, today, labelsWithData, rows: data });

describe("Group A — changed season rules", () => {
  it("A1 Denmark qualifiers cannot start the league season early", () => {
    expect(resolve(119, "2026-07-10", [2026, 2025]).current).toBe(2025);
  });
  it("A2 MLS advances to an unknown label and flags needsRow", () => {
    expect(resolve(253, "2027-03-01", [2027, 2026])).toEqual({ current: 2027, previous: 2026, flag: "needsRow" });
  });
  it("A3 an unlisted league retains legacy labels and flags unlisted", () => {
    expect(resolve(999, "2026-11-13", [2025, 2024])).toEqual({ current: 2025, previous: 2024, flag: "unlisted" });
  });
  it.each([[253, 2026, "2026"], [253, 2024, "2024"], [489, 2025, "2025"]] as const)(
    "A4 calendar league %s label %s displays %s", (league, label, expected) => {
      expect(displaySeasonLabel(league, label, rows)).toBe(expected);
    },
  );
  it("leagueCurrentLabel uses the most recently started row", () => {
    expect(leagueCurrentLabel(119, rows, "2026-07-10")).toBe(2025);
  });
});

describe("Group B — legacy behavior regression guards", () => {
  it("B1 Premier League in November", () => {
    expect(resolve(39, "2026-11-13", [2026, 2025, 2024])).toMatchObject({ current: 2026, previous: 2025 });
  });
  it("B2 Premier League before an unknown next season starts — labels only", () => {
    expect(resolve(39, "2027-07-20", [2026, 2025])).toMatchObject({ current: 2026, previous: 2025 });
    expect(resolve(39, "2027-07-20", [2026, 2025]).flag).toBeNull();
  });
  it("B3 player without new-season data keeps the prior labels", () => {
    expect(resolve(39, "2026-08-25", [2025, 2024])).toMatchObject({ current: 2025, previous: 2024 });
  });
  it("B4 empty rows use the newest two data labels", () => {
    expect(resolve(39, "2026-11-13", [2025, 2024], [])).toMatchObject({ current: 2025, previous: 2024 });
  });
  it("B5 split and unknown leagues keep split display", () => {
    expect(displaySeasonLabel(39, 2026, rows)).toBe("2026/2027");
    expect(displaySeasonLabel(999, 2024, rows)).toBe("2024/2025");
  });
});
