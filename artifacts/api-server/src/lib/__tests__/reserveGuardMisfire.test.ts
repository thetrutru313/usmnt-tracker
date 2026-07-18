/**
 * Regression guard: `isReserveFixtureForClub` must only block tagging when
 * the club's own API name looks like a reserve/youth squad AND differs from
 * the club's registered name.
 *
 * ## Bugs fixed
 *
 * Bug 1 (Benfica B / Wynder): "Benfica B" ends in " B", matching the
 *   `\sB$` branch of RESERVE_TEAM_PATTERN.  The old guard checked BOTH
 *   sides, so every Benfica B fixture was skipped — Wynder never tagged.
 *
 * Bug 2 (Real Monarchs / Gozo): "Real Monarchs" itself is fine, but all
 *   their MLS Next Pro opponents end in " II" (Timbers II, City II, etc.).
 *   The old `||` condition fired on the opponent name → same outcome.
 *
 * ## What is tested
 * Pure unit tests against `isReserveFixtureForClub` and `isReserveOrYouthTeam`.
 * No DB, no API calls, no network.
 */

import { describe, it, expect } from "vitest";
import {
  isReserveOrYouthTeam,
  isReserveFixtureForClub,
} from "../apiFootballSync.js";

describe("isReserveOrYouthTeam — pattern coverage", () => {
  it.each([
    // reserve/youth suffix patterns
    ["Portland Timbers II", true],
    ["Toronto FC II", true],
    ["Real Salt Lake II", true],
    ["Leeds United U21", true],
    ["Arsenal U18", true],
    ["Manchester City U23", true],
    ["Chelsea Reserves", true],
    ["Chelsea Reserve", true],
    ["Ajax Development Squad", true],
    ["Arsenal Academy", true],
    // " B" suffix
    ["Benfica B", true],
    ["Sporting B", true],
    // clean senior names
    ["Real Monarchs", false],
    ["Portland Timbers", false],
    ["LAFC", false],
    ["Nashville SC", false],
    ["New York City FC", false],
    ["Leeds United", false],
    ["Borussia Dortmund", false],
  ])("%s → %s", (name, expected) => {
    expect(isReserveOrYouthTeam(name)).toBe(expected);
  });
});

describe("isReserveFixtureForClub — the fixed guard logic", () => {
  // ── Bug 2 regression ──────────────────────────────────────────────────────
  describe("opponent ends in ' II' but club's registered name is clean", () => {
    it("Real Monarchs vs Portland Timbers II — club side is clean → NOT reserve", () => {
      // The registered club is "Real Monarchs"; the API returns "Real Monarchs"
      // as the home side.  The opponent is "Portland Timbers II" (away), but we
      // only check the club's own side now.
      expect(
        isReserveFixtureForClub("Real Monarchs", "Real Monarchs"),
      ).toBe(false);
    });

    it("Real Monarchs vs Real Salt Lake II — same club side → NOT reserve", () => {
      expect(
        isReserveFixtureForClub("Real Monarchs", "Real Monarchs"),
      ).toBe(false);
    });

    it("confirms Timbers II would have falsely triggered the old both-sides guard", () => {
      // Under the old guard this was: isReserveOrYouthTeam("Real Monarchs")
      // || isReserveOrYouthTeam("Portland Timbers II") → true → BUG.
      // The opponent side alone should not control the guard.
      expect(isReserveOrYouthTeam("Portland Timbers II")).toBe(true); // opponent matches pattern
      expect(isReserveOrYouthTeam("Real Monarchs")).toBe(false);      // club does not
      // New guard: only the club's side is checked.
      expect(isReserveFixtureForClub("Real Monarchs", "Real Monarchs")).toBe(false);
    });
  });

  // ── Bug 1 regression ──────────────────────────────────────────────────────
  describe("tracked club's registered name ends in ' B'", () => {
    it("Benfica B (registered) vs API name 'Benfica B' → NOT reserve (names match)", () => {
      // The club is explicitly tracked as "Benfica B".  When the API also
      // returns "Benfica B" as the club's side, the names match → not reserve.
      expect(
        isReserveFixtureForClub("Benfica B", "Benfica B"),
      ).toBe(false);
    });

    it("confirms Benfica B would have triggered the old single-side guard", () => {
      // Under the old guard this was: isReserveOrYouthTeam("Benfica B") → true → BUG.
      expect(isReserveOrYouthTeam("Benfica B")).toBe(true); // pattern matches name
      // New guard: exempt because registered name === api name.
      expect(isReserveFixtureForClub("Benfica B", "Benfica B")).toBe(false);
    });

    it("Sporting B (registered as 'Sporting B') → NOT reserve when API agrees", () => {
      expect(isReserveFixtureForClub("Sporting B", "Sporting B")).toBe(false);
    });
  });

  // ── Guard still fires for genuine reserve entries ─────────────────────────
  describe("API returns a reserve entry under the senior club's team ID", () => {
    it("Leeds United (registered) with API name 'Leeds United U21' → IS reserve", () => {
      // API-Football sometimes returns an EFL Trophy / reserve cup fixture
      // under the senior club's team ID but with the U21 name.
      expect(
        isReserveFixtureForClub("Leeds United", "Leeds United U21"),
      ).toBe(true);
    });

    it("Arsenal (registered) with API name 'Arsenal U18' → IS reserve", () => {
      expect(
        isReserveFixtureForClub("Arsenal", "Arsenal U18"),
      ).toBe(true);
    });

    it("Manchester City (registered) with API name 'Manchester City U23' → IS reserve", () => {
      expect(
        isReserveFixtureForClub("Manchester City", "Manchester City U23"),
      ).toBe(true);
    });

    it("Ajax (registered) with API name 'Ajax Development Squad' → IS reserve", () => {
      expect(
        isReserveFixtureForClub("Ajax", "Ajax Development Squad"),
      ).toBe(true);
    });
  });

  // ── Clean senior clubs — never blocked ───────────────────────────────────
  describe("normal senior clubs never flagged as reserve", () => {
    it.each([
      ["LAFC", "LAFC"],
      ["Nashville SC", "Nashville SC"],
      ["New York City FC", "New York City FC"],
      ["Borussia Dortmund", "Borussia Dortmund"],
      ["AC Milan", "AC Milan"],
    ])("%s → NOT reserve", (registered, apiName) => {
      expect(isReserveFixtureForClub(registered, apiName)).toBe(false);
    });
  });
});
