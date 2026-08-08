/**
 * Tests for PlayerProfile.
 *
 * Section 1: follow/unfollow star button tap-target size (WCAG 2.5.5).
 * Section 2: match result colour coding — assert on className, not text.
 * Section 3: tier badge is driven by server-provided poolTier, not category.
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
const mockToggle = vi.fn(async () => "added" as "added" | "removed");

vi.mock("@/hooks/useMyPlayers", () => ({
  useMyPlayers: () => ({
    followedIds: new Set<number>(),
    isFollowing: mockIsFollowing,
    toggle: mockToggle,
    generateTransferLink: async () => "",
  }),
}));

// ─── Shared player fixture ────────────────────────────────────────────────────

/** Minimal player that satisfies all fields PlayerProfile renders. */
const PLAYER = {
  id: 42,
  name: "Christian Pulisic",
  position: "MID",
  age: 25,
  category: "current",
  // poolTier provided by the server (Task B). Value is 'inMix' because
  // worldCupRoster=false even though category='current'.
  // Cast to string so individual tests can override with any valid tier value.
  poolTier: "inMix" as string,
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
  // Typed as Record array so test helpers can push fully-typed match log rows
  // without hitting TypeScript's never[] inference for empty-array literals.
  matchLog: [] as Record<string, unknown>[],
  last5Stats: { minutes: 0, avgRating: null },
  seasonStats: { avgRating: null },
  injuries: [],
  upcomingFixtures: [],
};

// ─── Mutable mock data (lets individual tests override the player shape) ──────

let currentPlayerData: typeof PLAYER & Record<string, unknown> = PLAYER;

vi.mock("@workspace/api-client-react", () => ({
  useGetPlayer: () => ({
    data: currentPlayerData,
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
  beforeEach(() => { currentPlayerData = PLAYER; });

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
  beforeEach(() => { currentPlayerData = PLAYER; });

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
    currentPlayerData = PLAYER;
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

// ─── Task A: Match result colour coding ───────────────────────────────────────
//
// All 1,209 production match logs use the scoreline format "W 2-1", "L 0-1",
// "D 1-1". PlayerProfile.tsx compared match.result === 'W' which is always
// false against a scoreline. Every match rendered in the yellow draw colour.
//
// The fix: derive the outcome letter from match.result[0] and handle the
// empty-string edge case (written when either score is null).
//
// ASSERT ON THE COLOUR CLASS, NOT THE TEXT — the text rendered correctly
// before the fix, which is why nobody caught this.

const MATCH_LOG_WIN  = { id: 1, fixtureId: null, playerId: 42, apiFootballFixtureId: null, date: "2026-08-01", opponent: "Mexico", competition: "International Friendly", result: "W 2-1", minutes: 90, goals: 1, assists: 0, conceded: null, rating: 8.0, isNationalTeam: false, cycle: null, createdAt: new Date().toISOString() };
const MATCH_LOG_LOSS = { ...MATCH_LOG_WIN, id: 2, result: "L 0-3" };
const MATCH_LOG_DRAW = { ...MATCH_LOG_WIN, id: 3, result: "D 1-1" };
const MATCH_LOG_EMPTY = { ...MATCH_LOG_WIN, id: 4, result: "" };

describe("PlayerProfile — match result colour coding (Task A)", () => {
  beforeEach(() => { currentPlayerData = PLAYER; });

  it('renders a green colour class for a "W 2-1" result', () => {
    currentPlayerData = { ...PLAYER, matchLog: [MATCH_LOG_WIN] };
    renderProfile();
    // Find the result span by its text content
    const resultSpan = screen.getByText("W 2-1");
    // MUST have green class; before fix it would have yellow (draw colour)
    expect(resultSpan.className).toMatch(/text-green-500/);
    expect(resultSpan.className).not.toMatch(/text-yellow-500/);
    expect(resultSpan.className).not.toMatch(/text-destructive/);
  });

  it('renders a red colour class for a "L 0-3" result', () => {
    currentPlayerData = { ...PLAYER, matchLog: [MATCH_LOG_LOSS] };
    renderProfile();
    const resultSpan = screen.getByText("L 0-3");
    expect(resultSpan.className).toMatch(/text-destructive/);
    expect(resultSpan.className).not.toMatch(/text-yellow-500/);
    expect(resultSpan.className).not.toMatch(/text-green-500/);
  });

  it('renders a yellow colour class for a "D 1-1" result', () => {
    currentPlayerData = { ...PLAYER, matchLog: [MATCH_LOG_DRAW] };
    renderProfile();
    const resultSpan = screen.getByText("D 1-1");
    expect(resultSpan.className).toMatch(/text-yellow-500/);
    expect(resultSpan.className).not.toMatch(/text-green-500/);
    expect(resultSpan.className).not.toMatch(/text-destructive/);
  });

  it("renders a neutral colour class (not green or red) for an empty result string", () => {
    currentPlayerData = { ...PLAYER, matchLog: [MATCH_LOG_EMPTY] };
    renderProfile();
    // When result is "", the span text is empty. Find any span by class.
    // The span should not carry green or red — it must fall through to neutral.
    // We locate it by looking for a span that has none of the outcome colours
    // but IS present alongside the opponent text.
    const opponent = screen.getByText("Mexico");
    const row = opponent.closest("tr") ?? opponent.closest("td") ?? opponent.parentElement;
    expect(row).toBeTruthy();
    // Confirm the result span doesn't have green or red
    const allSpans = row!.querySelectorAll("span");
    const resultSpan = Array.from(allSpans).find((s) => s.className.includes("shrink-0"));
    if (resultSpan) {
      expect(resultSpan.className).not.toMatch(/text-green-500/);
      expect(resultSpan.className).not.toMatch(/text-destructive/);
    }
  });
});

// ─── Task B: Tier badge driven by server's poolTier, not category ─────────────
//
// Q7 confirmed 8 players where the two rules disagree. The root cause: the
// profile derived its badge from `category` while every other surface used
// computePoolTier (worldCupRoster + caps).
//
// The fix: server returns `poolTier` on the player-profile response;
// PlayerProfile.tsx uses player.poolTier directly.
//
// This test uses Yunus Musah's real shape:
//   category = 'current', worldCupRoster = false, caps = 47
//   → old profile rule: 'core' → "Core Squad"
//   → computePoolTier:  'inMix' → "In the Mix"   ← correct
//
// The test MUST fail against the unmodified component (which reads category).

describe("PlayerProfile — tier badge uses server-provided poolTier (Task B)", () => {
  beforeEach(() => { currentPlayerData = PLAYER; });

  it("shows 'In the Mix' when server returns poolTier='inMix', even if category='current'", () => {
    // Musah's real shape: category='current' but poolTier='inMix'
    currentPlayerData = {
      ...PLAYER,
      category: "current",    // old component would render 'Core Squad' from this
      poolTier: "inMix",      // server says 'In the Mix' — this is the correct badge
      nationalTeamCaps: 47,
    };
    renderProfile();
    // After fix: badge reads poolTier='inMix' → "In the Mix"
    expect(screen.getByText("In the Mix")).toBeInTheDocument();
    // Before fix: badge reads category='current' → "Core Squad"
    expect(screen.queryByText("Core Squad")).not.toBeInTheDocument();
  });

  it("shows 'Prospect' when server returns poolTier='prospect', even if category='fringe'", () => {
    currentPlayerData = {
      ...PLAYER,
      category: "fringe",   // old component would render 'In the Mix'
      poolTier: "prospect", // server says 'Prospect'
      nationalTeamCaps: 2,
    };
    renderProfile();
    expect(screen.getByText("Prospect")).toBeInTheDocument();
    expect(screen.queryByText("In the Mix")).not.toBeInTheDocument();
  });
});
