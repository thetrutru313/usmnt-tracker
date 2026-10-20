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
  return render(<Router><ScheduleMatchRow fixture={{ ...fixture, ...overrides }} /></Router>);
}

function layout(name: "desktop" | "mobile") {
  const element = screen.queryByTestId(`match-row-${name}`);
  expect(element).toBeInTheDocument();
  return element!;
}

describe("Prompt 28 layout — change verifying", () => {
  it("finished status is in the date column, with only 4–1 in the desktop centre", () => {
    row({ status: "finished", homeScore: 4, awayScore: 1 });
    const date = screen.getByText(formatDate(fixture.kickoff)).parentElement!;
    expect(within(date).queryByText("FT")).toBeInTheDocument();
    const centre = within(layout("desktop")).getByTestId("match-row-center");
    expect(centre).toHaveTextContent(/^4–1$/);
    expect(centre).not.toHaveTextContent("FT");
  });

  it("keeps the combined scheduled time and zone explicitly nowrap", () => {
    row();
    expect(screen.getByText(formatTime(fixture.kickoff))).toHaveClass("whitespace-nowrap");
  });

  it("desktop DOM order is home name, home flag, centre, away flag, away name", () => {
    row();
    const desktop = within(layout("desktop"));
    const ordered = [
      desktop.getByText("USA"), desktop.getByRole("img", { name: "USA" }),
      desktop.getByTestId("match-row-center"),
      desktop.getByRole("img", { name: "Haiti" }), desktop.getByText("Haiti"),
    ];
    ordered.slice(0, -1).forEach((element, index) => {
      expect(element.compareDocumentPosition(ordered[index + 1]!) & Node.DOCUMENT_POSITION_FOLLOWING)
        .toBeTruthy();
    });
    expect(ordered[1]).toHaveClass("shrink-0");
    expect(ordered[3]).toHaveClass("shrink-0");
    expect(layout("desktop")).toHaveClass("grid");
  });

  it("mobile keeps home above away, each with its own right-aligned score and no vs", () => {
    row({ status: "finished", homeScore: 4, awayScore: 1 });
    const mobile = within(layout("mobile"));
    const home = mobile.getByTestId("match-row-home-line");
    const away = mobile.getByTestId("match-row-away-line");
    expect(home.compareDocumentPosition(away) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(home).getByText("USA")).toBeInTheDocument();
    expect(within(away).getByText("Haiti")).toBeInTheDocument();
    expect(within(home).getByTestId("match-row-home-score")).toHaveTextContent(/^4$/);
    expect(within(away).getByTestId("match-row-away-score")).toHaveTextContent(/^1$/);
    expect(mobile.queryByText("vs")).not.toBeInTheDocument();
  });

  it.each(["desktop", "mobile"] as const)("%s: only Canada's losing name and score are muted", variant => {
    row({ awayTeam: "Canada", status: "finished", homeScore: 1, awayScore: 0 });
    const scoped = within(layout(variant));
    expect(scoped.getByText("Canada")).toHaveClass("text-muted-foreground");
    expect(scoped.getByTestId("match-row-away-score")).toHaveClass("text-muted-foreground");
    expect(scoped.getByText("USA")).not.toHaveClass("text-muted-foreground");
    expect(scoped.getByTestId("match-row-home-score")).not.toHaveClass("text-muted-foreground");
  });

  it.each(["desktop", "mobile"] as const)("%s: a finished draw mutes neither team", variant => {
    row({ awayTeam: "Canada", status: "finished", homeScore: 2, awayScore: 2 });
    const scoped = within(layout(variant));
    for (const name of ["USA", "Canada"]) {
      expect(scoped.getByText(name)).not.toHaveClass("text-muted-foreground");
    }
    for (const side of ["home", "away"]) {
      expect(scoped.getByTestId(`match-row-${side}-score`)).not.toHaveClass("text-muted-foreground");
    }
  });

  it("live date column carries LIVE, the known minute and the existing destructive colour", () => {
    row({ status: "live", elapsedMinute: 67, homeScore: 0, awayScore: 2 });
    const date = screen.getByText(formatDate(fixture.kickoff)).parentElement!;
    expect(date).toHaveTextContent("LIVE");
    expect(date).toHaveTextContent("67");
    expect(within(date).getByText(/LIVE/)).toHaveClass("text-destructive");
    expect(within(layout("desktop")).getByTestId("match-row-center")).toHaveTextContent(/^0–2$/);
  });

  it("postponed date column shows PPD instead of a kickoff clock", () => {
    row({ status: "postponed" });
    const date = screen.getByText(formatDate(fixture.kickoff)).parentElement!;
    expect(within(date).queryByText("PPD")).toBeInTheDocument();
    expect(within(date).queryByText(formatTime(fixture.kickoff))).not.toBeInTheDocument();
  });

  it.each(["desktop", "mobile"] as const)("%s: live losing team stays full-colour", variant => {
    row({ status: "live", homeScore: 4, awayScore: 1 });
    const scoped = within(layout(variant));
    expect(scoped.getByText("Haiti")).not.toHaveClass("text-muted-foreground");
    expect(scoped.getByTestId("match-row-away-score")).not.toHaveClass("text-muted-foreground");
  });

  it.each(["scheduled", "postponed"] as const)("%s has no per-team mobile scores", status => {
    row({ status, homeScore: 0, awayScore: 0 });
    const mobile = within(layout("mobile"));
    expect(mobile.queryByTestId("match-row-home-score")).not.toBeInTheDocument();
    expect(mobile.queryByTestId("match-row-away-score")).not.toBeInTheDocument();
  });
});

describe("Prompt 28 unchanged regression guards", () => {
  it("scheduled time and zone are already one element with no nested pieces", () => {
    row();
    const clock = screen.getByText(formatTime(fixture.kickoff));
    expect(clock).toHaveTextContent(formatTime(fixture.kickoff));
    expect(clock.childElementCount).toBe(0);
  });

  it("Time TBD remains exact for an unknown scheduled kickoff", () => {
    row({ kickoffTimeTbd: true });
    expect(screen.getByText("Time TBD")).toBeInTheDocument();
    expect(screen.queryByText(formatTime(fixture.kickoff))).not.toBeInTheDocument();
  });

  it.each(["scheduled", "live"] as const)("%s keeps exactly one complete broadcast line", status => {
    row({ status });
    expect(screen.getAllByTestId("match-row-broadcast")).toHaveLength(1);
    expect(screen.getByTestId("match-row-broadcast")).toHaveTextContent("TNT · HBO Max");
  });

  it.each(["finished", "live"] as const)("%s preserves the link, aria-label and focus treatment", status => {
    row({ status, homeScore: 4, awayScore: 1 });
    const link = screen.getByRole("link", { name: "USA vs Haiti — match details" });
    expect(link).toHaveAttribute("href", "/matches/2006");
    expect(link).toHaveClass("hover:bg-primary/15", "focus-visible:ring-2", "focus-visible:ring-primary");
  });

  it.each(["scheduled", "postponed"] as const)("%s remains non-interactive", status => {
    row({ status });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
