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

function expectTeamOrder(home: string, away: string) {
  const homeName = screen.queryByText(home);
  const awayName = screen.queryByText(away);
  expect(homeName).toBeInTheDocument();
  expect(awayName).toBeInTheDocument();
  expect(
    homeName!.compareDocumentPosition(awayName!) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
}

describe("ScheduleMatchRow home-first change-verifying tests", () => {
  it("1: Haiti-home scheduled row names Haiti before USA and never uses @", () => {
    renderRow({ homeTeam: "Haiti", awayTeam: "USA" });
    expect(screen.queryByText("@")).not.toBeInTheDocument();
    expectTeamOrder("Haiti", "USA");
  });

  it("2: USA-home scheduled row names USA before Haiti with vs", () => {
    renderRow();
    expect(screen.queryByText("vs")).toBeInTheDocument();
    expectTeamOrder("USA", "Haiti");
  });

  it("3: finished Haiti 0–2 USA uses the home–away score", () => {
    renderRow({ homeTeam: "Haiti", awayTeam: "USA", status: "finished", homeScore: 0, awayScore: 2 });
    expect(screen.queryByText("FT · 0–2")).toBeInTheDocument();
    expectTeamOrder("Haiti", "USA");
  });

  it("4: finished USA 1–0 Canada names USA before Canada", () => {
    renderRow({ awayTeam: "Canada", status: "finished", homeScore: 1, awayScore: 0 });
    expect(screen.queryByText("FT · 1–0")).toBeInTheDocument();
    expectTeamOrder("USA", "Canada");
  });

  it("live Haiti 0–2 USA retains LIVE and home–away score order", () => {
    renderRow({ homeTeam: "Haiti", awayTeam: "USA", status: "live", homeScore: 0, awayScore: 2 });
    expect(screen.queryByText("LIVE · 0–2")).toBeInTheDocument();
  });
});

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
  it.each([
    { status: "scheduled" as const, tvNetwork: null, streamingService: "HBO Max", expected: "HBO Max" },
    { status: "live" as const, tvNetwork: "TNT", streamingService: null, expected: "TNT" },
    { status: "live" as const, tvNetwork: null, streamingService: "HBO Max", expected: "HBO Max" },
    { status: "live" as const, tvNetwork: null, streamingService: null, expected: null },
  ])("$status broadcast rules for $tvNetwork / $streamingService", ({ expected, ...overrides }) => {
    renderRow(overrides);
    const broadcast = screen.queryByTestId("match-row-broadcast");
    if (expected === null) {
      expect(broadcast).not.toBeInTheDocument();
    } else {
      expect(broadcast).toHaveTextContent(expected);
      expect(broadcast).not.toHaveTextContent("·");
    }
  });

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

  it("9: uses vs for both USA home and USA away, never @", () => {
    const view = renderRow();
    expect(screen.getByText("vs")).toBeInTheDocument();
    view.rerender(
      <Router><ScheduleMatchRow fixture={{ ...fixture, homeTeam: "Haiti", awayTeam: "USA" }} /></Router>
    );
    expect(screen.getByText("vs")).toBeInTheDocument();
    expect(screen.queryByText("@")).not.toBeInTheDocument();
  });
});
