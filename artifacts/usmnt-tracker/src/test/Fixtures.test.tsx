/**
 * Integration tests for the Fixtures page — status-transition rendering.
 *
 * The live-polling cycle delivers updated fixture data to `useListFixtures`
 * without a page reload. These tests confirm that when the cached data
 * changes (status "scheduled" → "finished"), the Fixtures page:
 *
 *   1. Removes the finished fixture from the upcoming section immediately.
 *   2. Shows the "Recent Results" collapsible toggle (previously absent).
 *   3. Reveals the fixture inside the collapsible when the toggle is clicked.
 *
 * The API hook is mocked so we can simulate a poll-cycle data update by
 * calling `mockReturnValue` between renders.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import Fixtures from "@/pages/Fixtures";
import type { FixtureCardFixture } from "@/components/FixtureCard";

// ─── Mock the API hook ────────────────────────────────────────────────────────

const mockUseListFixtures = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useListFixtures: (...args: unknown[]) => mockUseListFixtures(...args),
  getListFixturesQueryKey: () => ["fixtures", { scope: "all" }],
}));

// Suppress real polling intervals — we control data via the mock.
vi.mock("@/lib/livePolling", () => ({
  fixturesRefetchInterval: () => false,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal fixture suitable for the Fixtures page. */
function makeFixture(
  status: FixtureCardFixture["status"],
  overrides: Partial<FixtureCardFixture> = {},
): FixtureCardFixture {
  const hasScore = status === "finished" || status === "live";
  return {
    id: 42,
    isNationalTeam: false,
    competition: "MLS",
    kickoff: new Date("2026-07-17T20:00:00Z"),
    venue: "Allianz Field",
    homeTeam: "Minnesota United",
    awayTeam: "LA Galaxy",
    homeLogoUrl: null,
    awayLogoUrl: null,
    homeScore: hasScore ? 2 : null,
    awayScore: hasScore ? 1 : null,
    status,
    elapsedMinute: null,
    tvNetwork: null,
    streamingService: null,
    broadcastLink: null,
    featuredPlayers: [],
    ...overrides,
  };
}

/**
 * Render the Fixtures page wrapped in the providers it relies on.
 * Returns the same render result so callers can rerender with new data.
 */
function renderFixtures() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const utils = render(
    <QueryClientProvider client={queryClient}>
      <Router>
        <Fixtures />
      </Router>
    </QueryClientProvider>,
  );

  /**
   * Simulate a live-poll data update: replace the mock return value and
   * rerender inside identical providers (same query client so no cache
   * reset occurs — matches real React Query behaviour during a refetch).
   */
  const updateFixtures = (fixtures: FixtureCardFixture[]) => {
    mockUseListFixtures.mockReturnValue({ data: fixtures, isLoading: false });
    utils.rerender(
      <QueryClientProvider client={queryClient}>
        <Router>
          <Fixtures />
        </Router>
      </QueryClientProvider>,
    );
  };

  return { ...utils, updateFixtures };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Fixtures page — scheduled → finished status transition", () => {
  it("removes the fixture from the upcoming list as soon as its status becomes finished", () => {
    mockUseListFixtures.mockReturnValue({
      data: [makeFixture("scheduled")],
      isLoading: false,
    });

    const { updateFixtures } = renderFixtures();

    // Before: fixture is in the upcoming section (FixtureCard renders both
    // mobile + desktop variants so there can be multiple matching nodes)
    expect(screen.getAllByText("Minnesota United").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Recent Results/)).not.toBeInTheDocument();

    // Simulate a poll cycle delivering the finished status
    updateFixtures([makeFixture("finished")]);

    // The fixture must no longer appear in the upcoming section.
    // The Recent Results collapsible is closed by default so no card is
    // rendered yet — the team name should be completely absent from the DOM.
    expect(screen.queryAllByText("Minnesota United")).toHaveLength(0);
    expect(screen.getByText(/NO UPCOMING FIXTURES/i)).toBeInTheDocument();
  });

  it("shows the Recent Results toggle once a fixture becomes finished", () => {
    mockUseListFixtures.mockReturnValue({
      data: [makeFixture("scheduled")],
      isLoading: false,
    });

    const { updateFixtures } = renderFixtures();

    expect(screen.queryByText(/Recent Results/)).not.toBeInTheDocument();

    updateFixtures([makeFixture("finished")]);

    // The collapsible toggle must now be present and show the count
    expect(screen.getByText(/Recent Results \(1\)/i)).toBeInTheDocument();
  });

  it("places the finished fixture inside the Recent Results collapsible", () => {
    mockUseListFixtures.mockReturnValue({
      data: [makeFixture("scheduled")],
      isLoading: false,
    });

    const { updateFixtures } = renderFixtures();

    updateFixtures([makeFixture("finished")]);

    // Before expanding: the collapsible is closed, fixture cards are not
    // rendered at all (the {open && ...} guard prevents mounting)
    expect(screen.queryAllByText("Minnesota United")).toHaveLength(0);
    expect(screen.queryAllByText("LA Galaxy")).toHaveLength(0);

    // Expand the collapsible
    const toggleBtn = screen.getByRole("button", { name: /Recent Results/i });
    fireEvent.click(toggleBtn);

    // After expanding: FixtureCard is mounted; both team names are present
    expect(screen.getAllByText("Minnesota United").length).toBeGreaterThan(0);
    expect(screen.getAllByText("LA Galaxy").length).toBeGreaterThan(0);
  });

  it("handles multiple fixtures: finished ones move to Recent Results, upcoming ones stay", () => {
    const scheduledA = makeFixture("scheduled", {
      id: 1,
      homeTeam: "Portland Timbers",
      awayTeam: "Seattle Sounders",
    });
    const scheduledB = makeFixture("scheduled", {
      id: 2,
      homeTeam: "Minnesota United",
      awayTeam: "LA Galaxy",
    });

    mockUseListFixtures.mockReturnValue({
      data: [scheduledA, scheduledB],
      isLoading: false,
    });

    const { updateFixtures } = renderFixtures();

    expect(screen.getAllByText("Portland Timbers").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Minnesota United").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Recent Results/)).not.toBeInTheDocument();

    // Only fixture B finishes
    const finishedB = { ...scheduledB, status: "finished" as const, homeScore: 2, awayScore: 1 };
    updateFixtures([scheduledA, finishedB]);

    // Fixture A stays in upcoming
    expect(screen.getAllByText("Portland Timbers").length).toBeGreaterThan(0);

    // Fixture B is gone from upcoming (collapsible is closed — card not mounted)
    expect(screen.queryAllByText("Minnesota United")).toHaveLength(0);
    expect(screen.getByText(/Recent Results \(1\)/i)).toBeInTheDocument();

    // Expand and confirm fixture B is inside
    fireEvent.click(screen.getByRole("button", { name: /Recent Results/i }));
    expect(screen.getAllByText("Minnesota United").length).toBeGreaterThan(0);
  });

  it("shows Recent Results with correct count when all fixtures finish", () => {
    const a = makeFixture("scheduled", { id: 1, homeTeam: "Portland Timbers", awayTeam: "Seattle Sounders" });
    const b = makeFixture("scheduled", { id: 2, homeTeam: "Minnesota United", awayTeam: "LA Galaxy" });

    mockUseListFixtures.mockReturnValue({ data: [a, b], isLoading: false });

    const { updateFixtures } = renderFixtures();

    updateFixtures([
      { ...a, status: "finished", homeScore: 1, awayScore: 0 },
      { ...b, status: "finished", homeScore: 2, awayScore: 1 },
    ]);

    expect(screen.getByText(/NO UPCOMING FIXTURES/i)).toBeInTheDocument();
    // Both fixtures moved to Recent Results
    expect(screen.getByText(/Recent Results \(2\)/i)).toBeInTheDocument();
  });
});

describe("Fixtures page — loading and empty states", () => {
  it("shows a skeleton while isLoading is true", () => {
    mockUseListFixtures.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = renderFixtures();
    // The loading state renders an animate-pulse wrapper
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("shows the no-fixtures empty state when the API returns an empty array", () => {
    mockUseListFixtures.mockReturnValue({ data: [], isLoading: false });
    renderFixtures();
    expect(screen.getByText(/NO FIXTURES SCHEDULED/i)).toBeInTheDocument();
  });
});
