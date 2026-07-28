/**
 * Tests for PlayerCard — star interaction isolation and card navigation.
 *
 * The star button lives inside a <Link> wrapper. It must:
 *   1. Toggle the follow state when tapped, without navigating away.
 *   2. Not block card-body clicks from triggering navigation.
 *
 * Both behaviours are verified in desktop and mobile viewport widths.
 * Viewport size is simulated by setting `window.innerWidth`; the underlying
 * event propagation behaviour is identical across widths so these tests serve
 * as documentation of the expected contract.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { PlayerCard, type PlayerCardPlayer } from "@/components/PlayerCard";
import {
  MyPlayersContext,
  type MyPlayersContextValue,
} from "@/context/MyPlayersContext";

vi.mock("sonner", () => ({ toast: vi.fn() }));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PLAYER: PlayerCardPlayer = {
  id: 42,
  name: "Christian Pulisic",
  position: "MID",
  clubName: "AC Milan",
  age: 25,
  nationalTeamCaps: 70,
  photoUrl: null,
  performanceTrend: "good",
  poolTier: "core",
};

// ─── Context helpers ──────────────────────────────────────────────────────────

function makeCtx(
  overrides?: Partial<MyPlayersContextValue>,
): MyPlayersContextValue {
  return {
    followedIds: new Set(),
    isFollowing: vi.fn(() => false),
    toggle: vi.fn(async () => "added" as const),
    generateTransferLink: vi.fn(async () => ""),
    ...overrides,
  };
}

// ─── Location tracker component ───────────────────────────────────────────────

/** Renders the current wouter path into a testid so assertions can read it. */
function LocationReader() {
  const [loc] = useLocation();
  return <div data-testid="location">{loc}</div>;
}

// ─── Render helper ────────────────────────────────────────────────────────────

/**
 * Renders a PlayerCard inside a wouter Router backed by an in-memory location
 * so that navigation calls are captured without touching the real browser URL.
 *
 * @param ctx  - MyPlayersContext value to inject.
 * @param opts - Optional starting path (default "/players").
 */
function renderCard(
  ctx: MyPlayersContextValue,
  { startPath = "/players" }: { startPath?: string } = {},
) {
  const { hook } = memoryLocation({ path: startPath, record: true });

  render(
    <MyPlayersContext.Provider value={ctx}>
      <Router hook={hook}>
        <LocationReader />
        <PlayerCard player={PLAYER} />
      </Router>
    </MyPlayersContext.Provider>,
  );

  const getPath = () => screen.getByTestId("location").textContent ?? "";

  /** The star toggle button. */
  const starBtn = () =>
    screen.getByRole("button", { name: /my players/i });

  /**
   * The anchor element wrapping the entire card, used to test body-click
   * navigation (clicking the <a> directly triggers wouter's onClick handler).
   */
  const cardAnchor = () => screen.getByText(PLAYER.name).closest("a")!;

  return { getPath, starBtn, cardAnchor };
}

// ─── Star click must not navigate ─────────────────────────────────────────────

describe("PlayerCard — star click isolation", () => {
  let ctx: MyPlayersContextValue;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it("calls toggle with the player id when the star is clicked", async () => {
    const user = userEvent.setup();
    const { starBtn } = renderCard(ctx);

    await user.click(starBtn());

    expect(ctx.toggle).toHaveBeenCalledOnce();
    expect(ctx.toggle).toHaveBeenCalledWith(PLAYER.id);
  });

  it("does not navigate when the star is clicked (desktop 1280×800)", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1280, writable: true });
    const user = userEvent.setup();
    const { starBtn, getPath } = renderCard(ctx);

    await user.click(starBtn());

    expect(getPath()).toBe("/players");
  });

  it("does not navigate when the star is clicked (mobile 390×844)", async () => {
    Object.defineProperty(window, "innerWidth", { value: 390, writable: true });
    const user = userEvent.setup();
    const { starBtn, getPath } = renderCard(ctx);

    await user.click(starBtn());

    expect(getPath()).toBe("/players");
  });

  it("calls both preventDefault and stopPropagation on the star click event", () => {
    const { starBtn } = renderCard(ctx);
    const btn = starBtn();

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    const stopPropagationSpy = vi.spyOn(event, "stopPropagation");

    btn.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(stopPropagationSpy).toHaveBeenCalled();
  });

  it("location is still /players after multiple rapid star clicks (no double-navigation)", async () => {
    const user = userEvent.setup();
    const { starBtn, getPath } = renderCard(ctx);
    const btn = starBtn();

    await user.click(btn);
    await user.click(btn);
    await user.click(btn);

    expect(getPath()).toBe("/players");
  });
});

// ─── Card body navigates to player profile ────────────────────────────────────

describe("PlayerCard — card body navigation", () => {
  it("card anchor href points to the correct player URL", () => {
    const { cardAnchor } = renderCard(makeCtx());
    expect(cardAnchor()).toHaveAttribute("href", `/players/${PLAYER.id}`);
  });

  it("navigates to the player profile when clicking the card body (desktop 1280×800)", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1280, writable: true });
    const user = userEvent.setup();
    const { cardAnchor, getPath } = renderCard(makeCtx());

    await user.click(cardAnchor());

    expect(getPath()).toBe(`/players/${PLAYER.id}`);
  });

  it("navigates to the player profile when clicking the card body (mobile 390×844)", async () => {
    Object.defineProperty(window, "innerWidth", { value: 390, writable: true });
    const user = userEvent.setup();
    const { cardAnchor, getPath } = renderCard(makeCtx());

    await user.click(cardAnchor());

    expect(getPath()).toBe(`/players/${PLAYER.id}`);
  });

  it("card navigation fires even when the player is already followed (star filled)", async () => {
    const user = userEvent.setup();
    const ctx = makeCtx({ isFollowing: () => true });
    const { cardAnchor, getPath } = renderCard(ctx);

    await user.click(cardAnchor());

    expect(getPath()).toBe(`/players/${PLAYER.id}`);
  });
});

// ─── Star tap-target size (WCAG 2.5.5 / Apple HIG) ───────────────────────────

describe("PlayerCard — star button tap-target size", () => {
  /**
   * WCAG 2.5.5 and Apple HIG both mandate a minimum 44×44 px interactive area.
   * The button enforces this via Tailwind's min-h-[44px] and min-w-[44px]
   * utility classes. This test guards those classes so padding regressions are
   * caught before they reach users on small phone screens.
   */
  it("star button className includes min-h-[44px] (WCAG 2.5.5 tap-target floor)", () => {
    const { starBtn } = renderCard(makeCtx());
    expect(starBtn().className).toMatch(/min-h-\[44px\]/);
  });

  it("star button className includes min-w-[44px] (WCAG 2.5.5 tap-target floor)", () => {
    const { starBtn } = renderCard(makeCtx());
    expect(starBtn().className).toMatch(/min-w-\[44px\]/);
  });

  it("star button tap target stays ≥44px when the player is already followed (star filled)", () => {
    const { starBtn } = renderCard(makeCtx({ isFollowing: () => true }));
    const cls = starBtn().className;
    expect(cls).toMatch(/min-h-\[44px\]/);
    expect(cls).toMatch(/min-w-\[44px\]/);
  });
});

// ─── Star aria-label reflects follow state ────────────────────────────────────

describe("PlayerCard — star aria-label reflects follow state", () => {
  it('shows "Add to My Players" label when the player is not followed', () => {
    renderCard(makeCtx({ isFollowing: () => false }));
    expect(
      screen.getByRole("button", { name: "Add to My Players" }),
    ).toBeInTheDocument();
  });

  it('shows "Remove from My Players" label when the player is already followed', () => {
    renderCard(makeCtx({ isFollowing: () => true }));
    expect(
      screen.getByRole("button", { name: "Remove from My Players" }),
    ).toBeInTheDocument();
  });
});
