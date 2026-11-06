import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Router } from "wouter";
import Dashboard from "@/pages/Dashboard";

const dashboardState = vi.hoisted(() => ({ data: {} as unknown }));
vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/api-client-react")>(),
  useGetDashboard: () => ({ data: dashboardState.data, isLoading: false, error: null }),
}));

const performer = {
  id: 501, name: "Test Performer", slug: "test-performer", position: "MF",
  category: "prospect", poolTier: "prospect", clubName: "Test FC", league: "Test League",
  clubLogoUrl: null, photoUrl: null, age: 22, marketValueUsd: null,
  nationalTeamCaps: 0, nationalTeamGoals: 0, trending: false,
  performanceTrend: "ice_cold", potentialCallUpScore: null,
  weekRating: 8.04, weekMinutes: 150,
};

describe("Dashboard Top Performers", () => {
  it("1: shows the week's rating and minutes instead of the form badge", () => {
    dashboardState.data = {
      todaysGames: [], upcomingGames: [], topPerformers: [performer], latestNews: [],
      transfers: [], injuries: [], trending: [], recentlyReturned: [],
    };
    render(<Router><Dashboard /></Router>);
    const row = screen.getByText("Test Performer").closest("a")!;
    expect(within(row).getByText("8.0")).toBeInTheDocument();
    expect(within(row).getByText("150 min")).toBeInTheDocument();
    expect(within(row).queryByText(/ice cold/i)).not.toBeInTheDocument();
  });
});
