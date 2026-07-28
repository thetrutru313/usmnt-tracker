/**
 * Tests for PlayerProfile — follow/unfollow star button tap-target size.
 *
 * The player profile page (/players/:id) exposes its own follow/unfollow button
 * alongside the player name in the hero section. Like the PlayerCard star, it
 * must meet the WCAG 2.5.5 / Apple HIG 44×44 px minimum tap target.
 *
 * These tests guard the min-h-[44px] and min-w-[44px] classes on that button
 * so the same padding regression cannot silently reappear on this surface.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import PlayerProfile from "@/pages/PlayerProfile";

// ─── Mock wouter ──────────────────────────────────────────────────────────────

vi.mock("wouter", () => ({
  useParams: () => ({ id: "42" }),
  useLocation: () => ["/players/42", vi.fn()],
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

// ─── Mock sonner ──────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({ toast: vi.fn() }));

// ─── Mock My Players hook ─────────────────────────────────────────────────────

const mockIsFollowing = vi.fn(() => false);
const mockToggle = vi.fn(async () => "added" as const);

vi.mock("@/hooks/useMyPlayers", () => ({
  useMyPlayers: () => ({
    followedIds: new Set<number>(),
    isFollowing: mockIsFollowing,
    toggle: mockToggle,
    generateTransferLink: async () => "",
  }),
}));

// ─── Mock API hooks ───────────────────────────────────────────────────────────

/** Minimal player fixture that satisfies all fields PlayerProfile renders. */
const PLAYER = {
  id: 42,
  name: "Christian Pulisic",
  position: "MID",
  age: 25,
  category: "current",
  performanceTrend: "good",
  clubName: "AC Milan",
  clubLogoUrl: null,
  league: "Serie A",
  marketValueUsd: null,
  nationalTeamCaps: 70,
  nationalTeamGoals: 26,
  photoUrl: null,
  bio: null,
  availableClubSeasons: [],
  availableCycles: [],
  clubSeasonStats: {
    season: "2024",
    goals: 5,
    assists: 8,
    appearances: 20,
    starts: 18,
    minutes: 1620,
    shots: 40,
    keyPasses: 30,
    avgRating: 7.2,
  },
  nationalTeamStats: {
    season: "2024",
    goals: 3,
    assists: 2,
    appearances: 8,
    starts: 8,
    minutes: 0,
    avgRating: null,
  },
  matchLog: [],
  last5Stats: { minutes: 0, avgRating: null },
  seasonStats: { avgRating: null },
  injuries: [],
  upcomingFixtures: [],
};

vi.mock("@workspace/api-client-react", () => ({
  useGetPlayer: () => ({
    data: PLAYER,
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useListNews: () => ({ data: [] }),
}));

// ─── Render helper ────────────────────────────────────────────────────────────

function renderProfile() {
  return render(<PlayerProfile />);
}

/** Locate the follow/unfollow button by its aria-label. */
function followBtn() {
  return screen.getByRole("button", { name: /my players/i });
}

// ─── Star tap-target size (WCAG 2.5.5 / Apple HIG) ───────────────────────────

describe("PlayerProfile — follow button tap-target size", () => {
  /**
   * WCAG 2.5.5 and Apple HIG both mandate a minimum 44×44 px interactive area.
   * The button enforces this via Tailwind's min-h-[44px] and min-w-[44px]
   * utility classes. These tests guard those classes so padding regressions are
   * caught before they reach users on small phone screens.
   */

  it("follow button className includes min-h-[44px] (WCAG 2.5.5 tap-target floor)", () => {
    renderProfile();
    expect(followBtn().className).toMatch(/min-h-\[44px\]/);
  });

  it("follow button className includes min-w-[44px] (WCAG 2.5.5 tap-target floor)", () => {
    renderProfile();
    expect(followBtn().className).toMatch(/min-w-\[44px\]/);
  });

  it("follow button tap target stays ≥44px when the player is already followed (star filled)", () => {
    mockIsFollowing.mockReturnValueOnce(true);
    renderProfile();
    const cls = followBtn().className;
    expect(cls).toMatch(/min-h-\[44px\]/);
    expect(cls).toMatch(/min-w-\[44px\]/);
  });
});

// ─── Star aria-label reflects follow state ────────────────────────────────────

describe("PlayerProfile — follow button aria-label reflects follow state", () => {
  it('shows "Add to My Players" label when the player is not followed', () => {
    mockIsFollowing.mockReturnValue(false);
    renderProfile();
    expect(
      screen.getByRole("button", { name: "Add to My Players" }),
    ).toBeInTheDocument();
  });

  it('shows "Remove from My Players" label when the player is already followed', () => {
    mockIsFollowing.mockReturnValue(true);
    renderProfile();
    expect(
      screen.getByRole("button", { name: "Remove from My Players" }),
    ).toBeInTheDocument();
  });
});

// ─── Toast notifications ───────────────────────────────────────────────────────

describe("PlayerProfile — follow button fires toast notifications", () => {
  beforeEach(() => {
    vi.mocked(toast).mockClear();
    mockToggle.mockClear();
    mockIsFollowing.mockReset();
  });

  it('shows "Added to My Players" toast when the player is not yet followed', async () => {
    mockIsFollowing.mockReturnValue(false);
    mockToggle.mockResolvedValue("added");
    const user = userEvent.setup();
    renderProfile();
    await user.click(screen.getByRole("button", { name: "Add to My Players" }));
    expect(toast).toHaveBeenCalledWith("Added to My Players");
  });

  it('shows "Removed from My Players" toast when the player is already followed', async () => {
    mockIsFollowing.mockReturnValue(true);
    mockToggle.mockResolvedValue("removed");
    const user = userEvent.setup();
    renderProfile();
    await user.click(screen.getByRole("button", { name: "Remove from My Players" }));
    expect(toast).toHaveBeenCalledWith("Removed from My Players");
  });
});
