import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import type { Fixture } from "@workspace/api-client-react";
import { ScheduleMatchRow } from "@/components/ScheduleMatchRow";

const fixture: Fixture = {
  id: 2006,
  isNationalTeam: true,
  competition: "CONCACAF Nations League",
  kickoff: "2026-11-18T00:00:00Z",
  kickoffTimeTbd: false,
  venue: "TQL Stadium",
  city: "Cincinnati, OH",
  homeTeam: "USA",
  awayTeam: "Haiti",
  homeLogoUrl: null,
  awayLogoUrl: null,
  homeScore: null,
  awayScore: null,
  status: "scheduled",
  tvNetwork: "TNT",
  streamingService: "HBO Max",
  featuredPlayers: [],
};

function renderRow(overrides: Partial<Fixture> = {}) {
  return render(
    <Router><ScheduleMatchRow fixture={{ ...fixture, ...overrides }} /></Router>
  );
}

describe("ScheduleMatchRow change-verifying tests", () => {
  it("1: scheduled row shows TNT · HBO Max once", () => {
    renderRow();
    expect(screen.getByTestId("match-row-broadcast")).toHaveTextContent("TNT · HBO Max");
    expect(screen.getAllByTestId("match-row-broadcast")).toHaveLength(1);
  });

  it("2: scheduled row with TV only shows TNT without a separator", () => {
    renderRow({ streamingService: null });
    const broadcast = screen.getByTestId("match-row-broadcast");
    expect(broadcast).toHaveTextContent("TNT");
    expect(broadcast).not.toHaveTextContent("·");
  });

  it("3: live row shows the broadcast line", () => {
    renderRow({ status: "live" });
    expect(screen.getByTestId("match-row-broadcast")).toHaveTextContent("TNT · HBO Max");
  });

  it("4: finished row links to match details", () => {
    renderRow({ status: "finished", homeScore: 2, awayScore: 0 });
    expect(screen.getByRole("link", { name: "USA vs Haiti — match details" }))
      .toHaveAttribute("href", "/matches/2006");
  });

  it("5: live row links to match details", () => {
    renderRow({ status: "live" });
    expect(screen.getByRole("link", { name: "USA vs Haiti — match details" }))
      .toHaveAttribute("href", "/matches/2006");
  });
});

describe("ScheduleMatchRow regression guards", () => {
  it("6: finished row never shows broadcast info", () => {
    renderRow({ status: "finished", homeScore: 2, awayScore: 0 });
    expect(screen.queryByTestId("match-row-broadcast")).not.toBeInTheDocument();
  });

  it("7: scheduled row is not a link", () => {
    renderRow();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("8: scheduled row with null broadcast values has no broadcast element", () => {
    renderRow({ tvNetwork: null, streamingService: null });
    expect(screen.queryByTestId("match-row-broadcast")).not.toBeInTheDocument();
  });

  it("9: retains vs for USA home and @ for USA away", () => {
    const view = renderRow();
    expect(screen.getByText("vs")).toBeInTheDocument();
    view.rerender(
      <Router><ScheduleMatchRow fixture={{ ...fixture, homeTeam: "Haiti", awayTeam: "USA" }} /></Router>
    );
    expect(screen.getByText("@")).toBeInTheDocument();
  });
});
