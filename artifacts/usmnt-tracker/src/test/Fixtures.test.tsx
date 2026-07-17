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

// Suppress real polling intervals and the client-side minute tick — we
// control data via the mock.  `useLiveElapsedMinute` is stubbed to return the
// raw server value so cards render deterministically in tests.
vi.mock("@/lib/livePolling", () => ({
  fixturesRefetchInterval: () => false,
  useLiveElapsedMinute: (elapsedMinute: number | null | undefined) =>
    elapsedMinute ?? null,
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

describe("Fixtures page — pool-tier filter and Recent Results count badge", () => {
  /**
   * Fixtures used across these tests:
   *
   *   finishedCore    — finished, one core-tier featured player
   *   finishedInMix   — finished, one inMix-tier featured player
   *   finishedNone    — finished, no featured players (no pool match)
   *   upcomingCore    — scheduled, one core-tier featured player
   *   upcomingInMix   — scheduled, one inMix-tier featured player
   *
   * When the "Core Squad" filter is active only finishedCore / upcomingCore
   * should be visible. Recent Results must show "(1)", not "(3)".
   */

  const coreFeaturedPlayer = { id: 1, name: "Christian Pulisic", poolTier: "core" as const };
  const inMixFeaturedPlayer = { id: 2, name: "Folarin Balogun", poolTier: "inMix" as const };

  const finishedCore = makeFixture("finished", {
    id: 10,
    homeTeam: "AC Milan",
    awayTeam: "Juventus",
    featuredPlayers: [coreFeaturedPlayer],
  });
  const finishedInMix = makeFixture("finished", {
    id: 11,
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    featuredPlayers: [inMixFeaturedPlayer],
  });
  const finishedNone = makeFixture("finished", {
    id: 12,
    homeTeam: "PSG",
    awayTeam: "Lyon",
    featuredPlayers: [],
  });
  const upcomingCore = makeFixture("scheduled", {
    id: 20,
    homeTeam: "Inter Milan",
    awayTeam: "Napoli",
    featuredPlayers: [coreFeaturedPlayer],
  });
  const upcomingInMix = makeFixture("scheduled", {
    id: 21,
    homeTeam: "Bayer Leverkusen",
    awayTeam: "Dortmund",
    featuredPlayers: [inMixFeaturedPlayer],
  });

  it("Recent Results count reflects only filtered finished fixtures when a pool filter is active", () => {
    mockUseListFixtures.mockReturnValue({
      data: [finishedCore, finishedInMix, finishedNone, upcomingCore, upcomingInMix],
      isLoading: false,
    });

    renderFixtures();

    // Sanity check: unfiltered ("All") shows all 3 finished fixtures
    expect(screen.getByText(/Recent Results \(3\)/i)).toBeInTheDocument();

    // Activate the "Core Squad" filter
    fireEvent.click(screen.getByRole("button", { name: /Core Squad/i }));

    // Only finishedCore survives the filter → count must be 1
    expect(screen.getByText(/Recent Results \(1\)/i)).toBeInTheDocument();
    // Not the unfiltered total
    expect(screen.queryByText(/Recent Results \(3\)/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Recent Results \(2\)/i)).not.toBeInTheDocument();
  });

  it("upcoming section is also filtered when a pool filter is active", () => {
    mockUseListFixtures.mockReturnValue({
      data: [finishedCore, finishedInMix, finishedNone, upcomingCore, upcomingInMix],
      isLoading: false,
    });

    renderFixtures();

    // Both upcoming fixtures visible before filtering
    expect(screen.getAllByText("Inter Milan").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bayer Leverkusen").length).toBeGreaterThan(0);

    // Activate "Core Squad" filter
    fireEvent.click(screen.getByRole("button", { name: /Core Squad/i }));

    // Only the core upcoming fixture remains
    expect(screen.getAllByText("Inter Milan").length).toBeGreaterThan(0);
    // inMix upcoming fixture must be gone
    expect(screen.queryAllByText("Bayer Leverkusen")).toHaveLength(0);
  });

  it("expanding Recent Results after pool filter shows only the matching finished fixtures", () => {
    mockUseListFixtures.mockReturnValue({
      data: [finishedCore, finishedInMix, finishedNone],
      isLoading: false,
    });

    renderFixtures();

    // Activate "In the Mix" filter
    fireEvent.click(screen.getByRole("button", { name: /In the Mix/i }));

    expect(screen.getByText(/Recent Results \(1\)/i)).toBeInTheDocument();

    // Expand collapsible
    fireEvent.click(screen.getByRole("button", { name: /Recent Results/i }));

    // The inMix fixture (Arsenal vs Chelsea) should be visible
    expect(screen.getAllByText("Arsenal").length).toBeGreaterThan(0);
    // The core fixture and no-player fixture must NOT appear
    expect(screen.queryAllByText("AC Milan")).toHaveLength(0);
    expect(screen.queryAllByText("PSG")).toHaveLength(0);
  });

  it("switching back to All restores the full Recent Results count", () => {
    mockUseListFixtures.mockReturnValue({
      data: [finishedCore, finishedInMix, finishedNone],
      isLoading: false,
    });

    renderFixtures();

    // Enable Core Squad, count drops to 1
    fireEvent.click(screen.getByRole("button", { name: /Core Squad/i }));
    expect(screen.getByText(/Recent Results \(1\)/i)).toBeInTheDocument();

    // Switch back to All
    fireEvent.click(screen.getByRole("button", { name: /^All$/i }));
    expect(screen.getByText(/Recent Results \(3\)/i)).toBeInTheDocument();
  });

  it("fixture with players in multiple tiers appears under either matching tier filter and disappears only when no tier matches", () => {
    // A single finished fixture whose featuredPlayers span both core and inMix tiers.
    // Activating either tier filter alone must still include this fixture.
    // Activating a tier with no matching players (prospect) must exclude it.
    const finishedMultiTier = makeFixture("finished", {
      id: 30,
      homeTeam: "Real Madrid",
      awayTeam: "Barcelona",
      featuredPlayers: [
        { id: 3, name: "Tyler Adams", poolTier: "core" as const },
        { id: 4, name: "Ricardo Pepi", poolTier: "inMix" as const },
      ],
    });

    mockUseListFixtures.mockReturnValue({
      data: [finishedMultiTier],
      isLoading: false,
    });

    renderFixtures();

    // Unfiltered: fixture is present
    expect(screen.getByText(/Recent Results \(1\)/i)).toBeInTheDocument();

    // Activate "Core Squad" — fixture has a core player, so it must still appear
    fireEvent.click(screen.getByRole("button", { name: /Core Squad/i }));
    expect(screen.getByText(/Recent Results \(1\)/i)).toBeInTheDocument();

    // Switch to "In the Mix" — fixture has an inMix player, so it must still appear
    fireEvent.click(screen.getByRole("button", { name: /^All$/i }));
    fireEvent.click(screen.getByRole("button", { name: /In the Mix/i }));
    expect(screen.getByText(/Recent Results \(1\)/i)).toBeInTheDocument();

    // Switch to "Prospects" — fixture has NO prospect-tier player, so it must vanish
    fireEvent.click(screen.getByRole("button", { name: /^All$/i }));
    fireEvent.click(screen.getByRole("button", { name: /Prospects/i }));
    expect(screen.queryByText(/Recent Results/i)).not.toBeInTheDocument();
  });

  it("Recent Results is hidden entirely when the pool filter excludes all finished fixtures", () => {
    // Only a finished fixture with no featured players — "Core Squad" excludes it
    mockUseListFixtures.mockReturnValue({
      data: [finishedNone, upcomingCore],
      isLoading: false,
    });

    renderFixtures();

    // Unfiltered: Recent Results visible
    expect(screen.getByText(/Recent Results \(1\)/i)).toBeInTheDocument();

    // Activate Core Squad — finishedNone has no core players, so it's filtered out
    fireEvent.click(screen.getByRole("button", { name: /Core Squad/i }));

    // No finished fixtures remain → collapsible must not appear at all
    expect(screen.queryByText(/Recent Results/i)).not.toBeInTheDocument();
    // upcomingCore fixture is still visible
    expect(screen.getAllByText("Inter Milan").length).toBeGreaterThan(0);
  });
});

describe("Fixtures page — Recent Results collapsible stays open across poll updates", () => {
  it("keeps the collapsible open and shows both fixtures when a second fixture finishes mid-poll", () => {
    const firstFinished = makeFixture("finished", {
      id: 1,
      homeTeam: "Portland Timbers",
      awayTeam: "Seattle Sounders",
      homeScore: 2,
      awayScore: 0,
    });

    mockUseListFixtures.mockReturnValue({
      data: [firstFinished],
      isLoading: false,
    });

    const { updateFixtures } = renderFixtures();

    // The collapsible is present (one finished fixture)
    expect(screen.getByText(/Recent Results \(1\)/i)).toBeInTheDocument();

    // Open the collapsible — user interaction before the poll fires
    const toggleBtn = screen.getByRole("button", { name: /Recent Results/i });
    fireEvent.click(toggleBtn);

    // Confirm it is open: first fixture's teams are visible
    expect(screen.getAllByText("Portland Timbers").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Seattle Sounders").length).toBeGreaterThan(0);

    // Simulate a poll cycle delivering a second finished fixture
    const secondFinished = makeFixture("finished", {
      id: 2,
      homeTeam: "Minnesota United",
      awayTeam: "LA Galaxy",
      homeScore: 1,
      awayScore: 3,
    });
    updateFixtures([firstFinished, secondFinished]);

    // Collapsible must still be open — count badge updates
    expect(screen.getByText(/Recent Results \(2\)/i)).toBeInTheDocument();

    // Both fixtures must be visible without any additional clicks
    expect(screen.getAllByText("Portland Timbers").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Seattle Sounders").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Minnesota United").length).toBeGreaterThan(0);
    expect(screen.getAllByText("LA Galaxy").length).toBeGreaterThan(0);
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
