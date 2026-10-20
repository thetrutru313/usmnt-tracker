import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Router } from "wouter";
import type { Fixture } from "@workspace/api-client-react";
import { ScheduleMatchRow } from "@/components/ScheduleMatchRow";
import { formatDate, formatTime } from "@/lib/formatTime";

const fixture: Fixture = {
  id: 2006, isNationalTeam: true, competition: "CONCACAF Nations League",
  kickoff: "2026-11-18T00:00:00Z", kickoffTimeTbd: false,
  venue: "TQL Stadium", city: "Cincinnati, OH",
  homeTeam: "USA", awayTeam: "Haiti", homeLogoUrl: "/usa.png", awayLogoUrl: "/haiti.png",
  homeScore: null, awayScore: null, status: "scheduled",
  tvNetwork: "TNT", streamingService: "HBO Max", featuredPlayers: [],
};

function row(overrides: Partial<Fixture> = {}) {
  render(<Router><ScheduleMatchRow fixture={{ ...fixture, ...overrides }} /></Router>);
}

describe("Prompt 28b mobile layout — change verifying", () => {
  it.each([
    { label: "scheduled", overrides: {}, status: formatTime(fixture.kickoff) },
    { label: "finished", overrides: { status: "finished" as const }, status: "FT" },
    { label: "unknown kickoff", overrides: { kickoffTimeTbd: true }, status: "Time TBD" },
    { label: "live", overrides: { status: "live" as const, elapsedMinute: 67 }, status: "LIVE 67'" },
    { label: "postponed", overrides: { status: "postponed" as const }, status: "PPD" },
  ])("$label meta joins date and status with a middle dot", ({ overrides, status }) => {
    row(overrides);
    const meta = screen.getByTestId("match-row-date");
    expect(meta).toHaveTextContent(`${formatDate(fixture.kickoff)} · ${status}`);
    expect(meta).toHaveClass("flex", "whitespace-nowrap");
  });

  it("mobile mirrors home name, flag, centre, away flag, name with the score in the centre", () => {
    row({ status: "finished", homeScore: 4, awayScore: 1 });
    const mobile = within(screen.getByTestId("match-row-mobile"));
    const centre = mobile.queryByTestId("match-row-center");
    expect(centre).toBeInTheDocument();
    expect(centre).toHaveTextContent(/^4–1$/);
    const ordered = [
      mobile.getByText("USA"), mobile.getByRole("img", { name: "USA" }), centre!,
      mobile.getByRole("img", { name: "Haiti" }), mobile.getByText("Haiti"),
    ];
    ordered.slice(0, -1).forEach((element, index) => {
      expect(element.compareDocumentPosition(ordered[index + 1]!) & Node.DOCUMENT_POSITION_FOLLOWING)
        .toBeTruthy();
    });
    expect(ordered[1]).toHaveClass("shrink-0");
    expect(ordered[3]).toHaveClass("shrink-0");
  });

  it("finished mobile has no standalone per-team scores or stacked team lines", () => {
    row({ status: "finished", homeScore: 4, awayScore: 1 });
    const mobile = screen.getByTestId("match-row-mobile");
    const standalone = [...mobile.querySelectorAll('[data-testid="match-row-home-score"], [data-testid="match-row-away-score"]')]
      .filter(score => !score.closest('[data-testid="match-row-center"]'));
    expect(standalone).toHaveLength(0);
    expect(within(mobile).queryByTestId("match-row-home-line")).not.toBeInTheDocument();
    expect(within(mobile).queryByTestId("match-row-away-line")).not.toBeInTheDocument();
  });
});
