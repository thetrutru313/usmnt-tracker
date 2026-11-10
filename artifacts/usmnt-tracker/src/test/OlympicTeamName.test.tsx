import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { FixtureCard, type FixtureCardFixture } from "@/components/FixtureCard";
import { displayTeamName } from "@/lib/teamNames";

const FIXTURE: FixtureCardFixture = {
  id: 1, isNationalTeam: true, competition: "Friendlies",
  kickoff: new Date("2026-11-15T14:00:00Z"), venue: "Pinatar Arena",
  homeTeam: "Scotland U21", awayTeam: "USA U21", homeLogoUrl: null, awayLogoUrl: null,
  homeScore: null, awayScore: null, status: "scheduled", elapsedMinute: null,
  tvNetwork: null, streamingService: null, broadcastLink: null, featuredPlayers: [],
};

describe("USA Olympic team name", () => {
  it("1: shows the Olympic-cycle squads as the Olympic team; everyone else as stored", () => {
    expect(displayTeamName("USA U21")).toBe("USA Olympic Team");
    expect(displayTeamName("United States U23")).toBe("USA Olympic Team");
    expect(displayTeamName("USA U20")).toBe("USA U20");
    expect(displayTeamName("United States U17")).toBe("United States U17");
    expect(displayTeamName("Scotland U21")).toBe("Scotland U21");
    expect(displayTeamName("USA")).toBe("USA");
  });

  it("2: fixture cards label the US side as the Olympic team", () => {
    render(<Router><FixtureCard fixture={FIXTURE} /></Router>);
    expect(screen.getAllByText("USA Olympic Team").length).toBeGreaterThan(0);
    expect(screen.queryByText("USA U21")).not.toBeInTheDocument();
    expect(screen.getAllByText("Scotland U21").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Scotland U21 vs USA Olympic Team" })).toBeInTheDocument();
  });
});
