/**
 * Unit tests for FixtureCard — LiveIndicator visibility by fixture status.
 *
 * The pulsing "LIVE" badge must appear only when `fixture.status === "live"`.
 * For every other status ("finished", "scheduled", "postponed") it must be
 * completely absent so that a status transition from live → finished removes
 * the indicator without a page reload.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { FixtureCard, type FixtureCardFixture } from "@/components/FixtureCard";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal valid fixture for rendering FixtureCard. */
function makeFixture(
  status: FixtureCardFixture["status"],
): FixtureCardFixture {
  return {
    id: 1,
    isNationalTeam: false,
    competition: "MLS",
    kickoff: new Date("2026-07-17T20:00:00Z"),
    venue: "Allianz Field",
    homeTeam: "Minnesota United",
    awayTeam: "LA Galaxy",
    homeLogoUrl: null,
    awayLogoUrl: null,
    homeScore: status === "live" || status === "finished" ? 1 : null,
    awayScore: status === "live" || status === "finished" ? 0 : null,
    status,
    elapsedMinute: null,
    tvNetwork: null,
    streamingService: null,
    broadcastLink: null,
    featuredPlayers: [],
  };
}

/**
 * Render FixtureCard inside a wouter Router so that any <Link> elements
 * inside the component work correctly in the jsdom environment.
 */
function renderCard(fixture: FixtureCardFixture, showDate = false) {
  return render(
    <Router>
      <FixtureCard fixture={fixture} showDate={showDate} />
    </Router>,
  );
}

// ─── LiveIndicator presence ───────────────────────────────────────────────────

describe("FixtureCard — LiveIndicator visibility", () => {
  it('shows the LIVE indicator when status is "live"', () => {
    renderCard(makeFixture("live"));
    // The LiveIndicator renders the text "LIVE"; there may be two (sm + md
    // variants share the same output structure but only one is visible at a
    // time depending on `showDate`). getAllByText handles either case.
    expect(screen.getByText("LIVE")).toBeInTheDocument();
  });

  it('hides the LIVE indicator when status is "finished"', () => {
    renderCard(makeFixture("finished"));
    expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
  });

  it('hides the LIVE indicator when status is "scheduled"', () => {
    renderCard(makeFixture("scheduled"));
    expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
  });

  it('hides the LIVE indicator when status is "postponed"', () => {
    renderCard(makeFixture("postponed"));
    expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
  });
});

// ─── Status transition: live → finished ───────────────────────────────────────

describe("FixtureCard — live → finished transition", () => {
  it("removes the LIVE indicator as soon as status changes from live to finished", () => {
    const { rerender } = render(
      <Router>
        <FixtureCard fixture={makeFixture("live")} />
      </Router>,
    );
    // Indicator is visible while the match is in progress
    expect(screen.getByText("LIVE")).toBeInTheDocument();

    // Simulate the data update after the final whistle
    rerender(
      <Router>
        <FixtureCard fixture={makeFixture("finished")} />
      </Router>,
    );
    expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
  });
});

// ─── Elapsed minute display ───────────────────────────────────────────────────

describe("FixtureCard — elapsed minute display", () => {
  it("shows the elapsed minute alongside the score when status is live and minute is provided", () => {
    const fixture = { ...makeFixture("live"), elapsedMinute: 72 };
    renderCard(fixture);
    expect(screen.getByText(/72/)).toBeInTheDocument();
  });

  it("does not show a minute when elapsedMinute is null", () => {
    const fixture = { ...makeFixture("live"), elapsedMinute: null };
    renderCard(fixture);
    // Score should still render; no extra minute token
    expect(screen.queryByText(/\d+'/)).not.toBeInTheDocument();
  });

  it("shows the elapsed minute in the showDate layout", () => {
    const fixture = { ...makeFixture("live"), elapsedMinute: 45 };
    renderCard(fixture, /* showDate */ true);
    expect(screen.getByText(/45/)).toBeInTheDocument();
  });
});

// ─── animate-ping CSS class presence ─────────────────────────────────────────
//
// The pulsing effect relies on Tailwind's `animate-ping` class being present in
// the rendered DOM. A Tailwind purge misconfiguration would keep the element but
// strip the class, leaving a static red dot with no failing test. These checks
// guard against that by asserting on the class directly rather than just the
// LIVE text node.

describe("FixtureCard — animate-ping class presence", () => {
  it('renders an element with animate-ping when status is "live"', () => {
    const { container } = renderCard(makeFixture("live"));
    expect(container.querySelector(".animate-ping")).toBeInTheDocument();
  });

  it('renders an element with animate-ping in the showDate layout when status is "live"', () => {
    const { container } = renderCard(makeFixture("live"), /* showDate */ true);
    expect(container.querySelector(".animate-ping")).toBeInTheDocument();
  });

  it('has no animate-ping element when status is "finished"', () => {
    const { container } = renderCard(makeFixture("finished"));
    expect(container.querySelector(".animate-ping")).not.toBeInTheDocument();
  });

  it('has no animate-ping element when status is "scheduled"', () => {
    const { container } = renderCard(makeFixture("scheduled"));
    expect(container.querySelector(".animate-ping")).not.toBeInTheDocument();
  });

  it('has no animate-ping element when status is "postponed"', () => {
    const { container } = renderCard(makeFixture("postponed"));
    expect(container.querySelector(".animate-ping")).not.toBeInTheDocument();
  });

  it("removes animate-ping when status transitions from live to finished", () => {
    const { container, rerender } = render(
      <Router>
        <FixtureCard fixture={makeFixture("live")} />
      </Router>,
    );
    expect(container.querySelector(".animate-ping")).toBeInTheDocument();

    rerender(
      <Router>
        <FixtureCard fixture={makeFixture("finished")} />
      </Router>,
    );
    expect(container.querySelector(".animate-ping")).not.toBeInTheDocument();
  });
});

// ─── showDate layout variant ──────────────────────────────────────────────────

describe("FixtureCard — LiveIndicator in showDate layout", () => {
  it('shows the LIVE indicator in the showDate layout when status is "live"', () => {
    renderCard(makeFixture("live"), /* showDate */ true);
    expect(screen.getByText("LIVE")).toBeInTheDocument();
  });

  it('hides the LIVE indicator in the showDate layout when status is "finished"', () => {
    renderCard(makeFixture("finished"), /* showDate */ true);
    expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
  });

  it('hides the LIVE indicator in the showDate layout when status is "scheduled"', () => {
    renderCard(makeFixture("scheduled"), /* showDate */ true);
    expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
  });

  it('hides the LIVE indicator in the showDate layout when status is "postponed"', () => {
    renderCard(makeFixture("postponed"), /* showDate */ true);
    expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
  });
});
