import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import Fixtures from "@/pages/Fixtures";
import { dayGroups } from "@/lib/stickyHeading";
import type { FixtureCardFixture } from "@/components/FixtureCard";

vi.mock("@/hooks/useMyPlayers", () => ({
  useMyPlayers: () => ({
    followedIds: new Set<number>(),
    isFollowing: () => false,
    toggle: async () => "added" as const,
    generateTransferLink: async () => "",
  }),
}));

const mockUseListFixtures = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useListFixtures: (...args: unknown[]) => mockUseListFixtures(...args),
  getListFixturesQueryKey: () => ["fixtures", { scope: "all" }],
}));

vi.mock("@/lib/livePolling", () => ({
  fixturesRefetchInterval: () => false,
  useLiveElapsedMinute: (elapsedMinute: number | null | undefined) => elapsedMinute ?? null,
}));

// Controllable stand-in for the virtualizer: every row is rendered, and the
// row positions come from `virtualState`.
const virtualState = vi.hoisted(() => ({
  measurementsCache: [] as { index: number; key: string; start: number; size: number; end: number; lane: number }[],
}));
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 142,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ key: index, index, start: index * 142 })),
    measureElement: () => {},
    measurementsCache: virtualState.measurementsCache,
  }),
}));

function makeFixture(id: number, kickoff: string, homeTeam: string): FixtureCardFixture {
  return {
    id, isNationalTeam: false, competition: "MLS", kickoff: new Date(kickoff),
    venue: "Test Park", homeTeam, awayTeam: "Visitors FC",
    homeLogoUrl: null, awayLogoUrl: null, homeScore: null, awayScore: null,
    status: "scheduled", elapsedMinute: null, tvNetwork: null, streamingService: null,
    broadcastLink: null, featuredPlayers: [],
  } as FixtureCardFixture;
}

function row(index: number, start: number, size: number) {
  return { index, key: String(index), start, size, end: start + size, lane: 0 };
}

afterEach(() => {
  vi.useRealTimers();
  virtualState.measurementsCache = [];
});

describe("dayGroups", () => {
  const headings = [{ index: 0, top: 0 }, { index: 3, top: 400 }, { index: 7, top: 900 }];

  it("1: each day's box runs from its heading down to the next day's heading", () => {
    const groups = dayGroups(headings, 1500);
    expect(groups[0]).toEqual({ index: 0, top: 0, height: 400 });
    expect(groups[1]).toEqual({ index: 3, top: 400, height: 500 });
  });

  it("2: the last day's box runs to the bottom of the list", () => {
    expect(dayGroups(headings, 1500)[2]).toEqual({ index: 7, top: 900, height: 600 });
  });
});

describe("Fixtures page — pinned date headings", () => {
  function renderTwoDays() {
    vi.useFakeTimers({ now: new Date("2026-07-17T10:00:00Z") });
    mockUseListFixtures.mockReturnValue({
      data: [
        makeFixture(1, "2026-07-17T20:00:00Z", "Today United"),
        makeFixture(2, "2026-07-18T20:00:00Z", "Tomorrow City"),
      ],
      isLoading: false,
    });
    // Rows: [heading Today, card, heading Tomorrow, card]; the mocked list is
    // 4 × 142 = 568px tall. The Tomorrow heading's own top is 194 + 32 (mt-8).
    virtualState.measurementsCache = [row(0, 0, 52), row(1, 52, 142), row(2, 194, 84), row(3, 278, 142)];
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Router><Fixtures /></Router>
      </QueryClientProvider>,
    );
    return screen.getAllByTestId("date-heading-group");
  }

  it("3: draws each day's heading in a box spanning that day", () => {
    const [today, tomorrow] = renderTwoDays();
    expect(today).toHaveStyle({ top: "0px", height: "226px" });
    expect(within(today!).getByText(/Today/i)).toBeInTheDocument();
    expect(tomorrow).toHaveStyle({ top: "226px", height: "342px" });
    expect(within(tomorrow!).getByText(/Tomorrow/i)).toBeInTheDocument();
  });

  it("4: the headings inside the boxes are sticky", () => {
    const groups = renderTwoDays();
    for (const g of groups) {
      expect(within(g).getByRole("heading")).toHaveClass("sticky", "top-0");
    }
  });
});
