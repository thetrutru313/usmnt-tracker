/**
 * Unit tests for the NT fixture ID disambiguation helper.
 *
 * Tests the exact scenario the code review flagged: two USMNT matches within
 * a ±7-day window (Jamaica Aug 24 / T&T Aug 28) where naively taking all
 * logs in the window would mix the two fixtures' data.
 */

import { describe, it, expect } from "vitest";
import { pickBestNtFixtureId } from "../pickBestNtFixtureId.js";

const JAMAICA_ID = 9001;
const TT_ID = 9002;

function jamaicaLogs(count = 5) {
  return Array.from({ length: count }, () => ({
    apiFootballFixtureId: JAMAICA_ID,
    date: "2026-08-24",
  }));
}

function ttLogs(count = 5) {
  return Array.from({ length: count }, () => ({
    apiFootballFixtureId: TT_ID,
    date: "2026-08-28",
  }));
}

describe("pickBestNtFixtureId", () => {
  it("returns null when there are no candidates", () => {
    expect(pickBestNtFixtureId([], Date.now())).toBeNull();
  });

  it("returns the only ID when all candidates agree", () => {
    const candidates = jamaicaLogs(6);
    const kickoff = new Date("2026-08-24T20:00:00Z").getTime();
    expect(pickBestNtFixtureId(candidates, kickoff)).toBe(JAMAICA_ID);
  });

  it("picks Jamaica when kickoff is Aug 24 and both fixtures' logs are present — majority wins", () => {
    // Jamaica has more linked players who appeared → majority vote picks correctly.
    const candidates = [...jamaicaLogs(8), ...ttLogs(4)];
    const kickoff = new Date("2026-08-24T20:00:00Z").getTime();
    expect(pickBestNtFixtureId(candidates, kickoff)).toBe(JAMAICA_ID);
  });

  it("picks T&T when kickoff is Aug 28 and both fixtures' logs are present — majority wins", () => {
    const candidates = [...jamaicaLogs(4), ...ttLogs(8)];
    const kickoff = new Date("2026-08-28T20:00:00Z").getTime();
    expect(pickBestNtFixtureId(candidates, kickoff)).toBe(TT_ID);
  });

  it("breaks a tie by nearest date — prefers Jamaica when kickoff is Aug 24", () => {
    const candidates = [...jamaicaLogs(5), ...ttLogs(5)];
    const kickoff = new Date("2026-08-24T20:00:00Z").getTime();
    expect(pickBestNtFixtureId(candidates, kickoff)).toBe(JAMAICA_ID);
  });

  it("breaks a tie by nearest date — prefers T&T when kickoff is Aug 28", () => {
    const candidates = [...jamaicaLogs(5), ...ttLogs(5)];
    const kickoff = new Date("2026-08-28T20:00:00Z").getTime();
    expect(pickBestNtFixtureId(candidates, kickoff)).toBe(TT_ID);
  });

  it("handles a seeded kickoff that differs from the real match date (Belgium: seeded Jul 9, actual Jul 7)", () => {
    const candidates = Array.from({ length: 11 }, () => ({
      apiFootballFixtureId: 1570715,
      date: "2026-07-07",
    }));
    const kickoff = new Date("2026-07-09T20:00:00Z").getTime();
    expect(pickBestNtFixtureId(candidates, kickoff)).toBe(1570715);
  });
});
