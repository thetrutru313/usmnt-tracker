import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Router } from "wouter";
import type { Fixture } from "@workspace/api-client-react";
import { FixtureCard } from "@/components/FixtureCard";
import { ScheduleMatchRow } from "@/components/ScheduleMatchRow";
import Dashboard from "@/pages/Dashboard";
import { formatDate, formatTime } from "@/lib/formatTime";

const dashboardState = vi.hoisted(() => ({ data: {} as unknown }));
vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/api-client-react")>(),
  useGetDashboard: () => ({ data: dashboardState.data, isLoading: false, error: null }),
}));

const leg1: Fixture & { kickoffTimeTbd: boolean } = {
  id: 2005, isNationalTeam: true, competition: "CONCACAF Nations League",
  kickoff: "2026-11-15T00:00:00Z", kickoffTimeTbd: true,
  venue: "TBD", city: null, homeTeam: "Haiti", awayTeam: "USA",
  homeLogoUrl: "https://media.api-sports.io/football/teams/2386.png",
  awayLogoUrl: "https://media.api-sports.io/football/teams/2384.png",
  homeScore: null, awayScore: null, status: "scheduled",
  tvNetwork: "TNT", streamingService: "HBO Max", featuredPlayers: [],
};
const leg2 = {
  ...leg1, id: 2006, kickoff: "2026-11-18T00:00:00Z", kickoffTimeTbd: false,
  homeTeam: "USA", awayTeam: "Haiti",
  homeLogoUrl: leg1.awayLogoUrl, awayLogoUrl: leg1.homeLogoUrl,
  venue: "TQL Stadium", city: "Cincinnati, OH",
};

describe("November fixtures — frontend regression", () => {
  it("1: FixtureCard shows Time TBD instead of the placeholder clock", () => {
    render(<Router><FixtureCard fixture={leg1} showDate /></Router>);
    expect(screen.getByText("Time TBD")).toBeInTheDocument();
    expect(screen.queryByText(formatTime(leg1.kickoff))).not.toBeInTheDocument();
  });
  it("1 control: FixtureCard shows the known clock when false", () => {
    render(<Router><FixtureCard fixture={leg2} showDate /></Router>);
    expect(screen.getByText(formatTime(leg2.kickoff))).toBeInTheDocument();
    expect(screen.queryByText("Time TBD")).not.toBeInTheDocument();
  });
  it("2: FixtureCard retains the November 14 date when time is TBD", () => {
    render(<Router><FixtureCard fixture={leg1} showDate /></Router>);
    expect(formatDate(leg1.kickoff)).toBe("Nov 14");
    expect(screen.getByText("Nov 14")).toBeInTheDocument();
  });
  it("3: ScheduleMatchRow shows Time TBD instead of the placeholder clock", () => {
    render(<ScheduleMatchRow fixture={leg1} />);
    expect(screen.getByText("Time TBD")).toBeInTheDocument();
    expect(screen.queryByText(formatTime(leg1.kickoff))).not.toBeInTheDocument();
  });
  it("3 control: ScheduleMatchRow shows the known clock when false", () => {
    render(<ScheduleMatchRow fixture={leg2} />);
    expect(screen.getByText(formatTime(leg2.kickoff))).toBeInTheDocument();
    expect(screen.queryByText("Time TBD")).not.toBeInTheDocument();
  });
  it("3 date: ScheduleMatchRow retains the November 14 date", () => {
    render(<ScheduleMatchRow fixture={leg1} />);
    expect(screen.getByText("Nov 14")).toBeInTheDocument();
  });
  it("4: USA-away row names both teams and puts the Haiti flag first", () => {
    render(<ScheduleMatchRow fixture={leg1} />);
    const desktop = within(screen.getByTestId("match-row-desktop"));
    expect(desktop.getByText("Haiti")).toBeInTheDocument();
    expect(desktop.getByRole("img", { name: "Haiti" })).toHaveAttribute("src", leg1.homeLogoUrl);
    expect(desktop.getByAltText("USA")).toHaveAttribute("src", leg1.awayLogoUrl);
    expect(desktop.getAllByRole("img").map((img) => img.getAttribute("alt"))).toEqual(["Haiti", "USA"]);
  });
  it("5: dashboard hero shows both home-first legs, Time TBD, and broadcasts", () => {
    dashboardState.data = {
      todaysGames: [], upcomingGames: [], topPerformers: [], latestNews: [],
      transfers: [], injuries: [], trending: [], recentlyReturned: [],
      nextScheduleEvent: {
        id: 30, slug: "cnl-qf-nov-2026", name: "Nations League Quarterfinals",
        kind: "nations-league", status: "confirmed", dateLabel: "Nov 14 & 17, 2026",
        description: "Two-legged tie against Haiti.", fixtures: [leg1, leg2],
      },
    };
    render(<Router><Dashboard /></Router>);
    const hero = screen.getByRole("heading", { name: "Nations League Quarterfinals" }).closest("section")!;
    const desktopRows = within(hero).getAllByTestId("match-row-desktop");
    expect(desktopRows).toHaveLength(2);
    expect(desktopRows.flatMap(row => within(row).queryAllByText("Haiti"))).toHaveLength(2);
    expect(within(hero).getByText("Nov 14")).toBeInTheDocument();
    expect(within(hero).getByText("Nov 17")).toBeInTheDocument();
    expect(within(hero).getByText("Time TBD")).toBeInTheDocument();
    expect(desktopRows.flatMap(row => within(row).queryAllByText("USA"))).toHaveLength(2);
    expect(within(hero).getAllByText("vs")).toHaveLength(2);
    expect(within(hero).queryByText("@")).not.toBeInTheDocument();
  });

  it("dashboard hero renders both broadcast lines with the production endpoint values", () => {
    dashboardState.data = {
      todaysGames: [], upcomingGames: [], topPerformers: [], latestNews: [],
      transfers: [], injuries: [], trending: [], recentlyReturned: [],
      nextScheduleEvent: {
        id: 30, slug: "cnl-qf-nov-2026", name: "Nations League Quarterfinals",
        kind: "nations-league", status: "confirmed", dateLabel: "Nov 14 & 17, 2026",
        description: "Two-legged tie against Haiti.", fixtures: [leg1, leg2],
      },
    };
    render(<Router><Dashboard /></Router>);
    const hero = screen.getByRole("heading", { name: "Nations League Quarterfinals" }).closest("section")!;
    const broadcasts = within(hero).getAllByTestId("match-row-broadcast");
    expect(broadcasts).toHaveLength(2);
    for (const broadcast of broadcasts) {
      expect(broadcast).toHaveTextContent("TNT · HBO Max");
    }
  });
});
