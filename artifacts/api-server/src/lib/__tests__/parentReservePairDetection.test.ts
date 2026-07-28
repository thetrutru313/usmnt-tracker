import { describe, it, expect } from "vitest";
import { looksLikeParentReservePair } from "../apiFootballSync.js";

describe("looksLikeParentReservePair", () => {
  // ── Positive cases (should detect as parent/reserve pair) ────────────────

  it("detects 'Orlando City SC' / 'Orlando City II'", () => {
    expect(looksLikeParentReservePair("Orlando City SC", "Orlando City II")).toBe(true);
  });

  it("detects reversed order 'Orlando City II' / 'Orlando City SC'", () => {
    expect(looksLikeParentReservePair("Orlando City II", "Orlando City SC")).toBe(true);
  });

  it("detects 'Bayern Munich' / 'Bayern Munich II'", () => {
    expect(looksLikeParentReservePair("Bayern Munich", "Bayern Munich II")).toBe(true);
  });

  it("detects 'Real Madrid' / 'Real Madrid B'", () => {
    expect(looksLikeParentReservePair("Real Madrid", "Real Madrid B")).toBe(true);
  });

  it("detects clubs with FC suffix: 'Hamburg FC' / 'Hamburg FC II'", () => {
    expect(looksLikeParentReservePair("Hamburg FC", "Hamburg FC II")).toBe(true);
  });

  it("detects youth team: 'Ajax' / 'Ajax U21'", () => {
    expect(looksLikeParentReservePair("Ajax", "Ajax U21")).toBe(true);
  });

  it("detects reserves keyword: 'Chelsea' / 'Chelsea Reserves'", () => {
    expect(looksLikeParentReservePair("Chelsea", "Chelsea Reserves")).toBe(true);
  });

  // ── Negative cases (should NOT flag as parent/reserve pair) ───────────────

  it("does NOT flag two first-team clubs with the same API id (genuine duplicate)", () => {
    expect(looksLikeParentReservePair("Lyngby Boldklub", "Lyngby")).toBe(false);
  });

  it("does NOT flag two first-team MLS clubs with similar names", () => {
    expect(looksLikeParentReservePair("Orlando City SC", "Columbus Crew")).toBe(false);
  });

  it("does NOT flag two reserve/youth sides as a parent/reserve pair", () => {
    expect(looksLikeParentReservePair("Bayern Munich II", "Hamburg FC II")).toBe(false);
  });

  it("does NOT flag when reserve name does not share the parent root", () => {
    expect(looksLikeParentReservePair("Liverpool", "Manchester City II")).toBe(false);
  });

  it("does NOT flag identical names (same club referenced twice)", () => {
    expect(looksLikeParentReservePair("Orlando City SC", "Orlando City SC")).toBe(false);
  });
});
