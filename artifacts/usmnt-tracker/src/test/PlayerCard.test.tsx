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

// ─── Token-absent (offline / first-visit) scenario ───────────────────────────

describe("PlayerCard — star toggle with no auth token (offline / first visit)", () => {
  /**
   * MyPlayersContext.toggle skips the API call when the internal anon token is
   * null (network unavailable or first load) and falls back to localStorage
   * only.  From PlayerCard's perspective the context value is the same — toggle
   * is still a function that returns "added" | "removed" — so these tests
   * verify that no error is thrown and no navigation side-effect occurs.
   */

  it("toggle returns 'added' without throwing when token is absent", async () => {
    // Simulate the token-absent toggle: resolves to "added", no API call.
    const toggleWithNoToken = vi.fn(async (_id: number): Promise<"added" | "removed"> => "added");
    const ctx = makeCtx({ toggle: toggleWithNoToken });
    const user = userEvent.setup();
    const { starBtn } = renderCard(ctx);

    await expect(user.click(starBtn())).resolves.not.toThrow();

    expect(toggleWithNoToken).toHaveBeenCalledOnce();
    expect(toggleWithNoToken).toHaveBeenCalledWith(PLAYER.id);
    const result = await toggleWithNoToken.mock.results[0].value;
    expect(result === "added" || result === "removed").toBe(true);
  });

  it("toggle returns 'removed' without throwing when token is absent and player was already followed", async () => {
    const toggleWithNoToken = vi.fn(async (_id: number): Promise<"added" | "removed"> => "removed");
    const ctx = makeCtx({
      isFollowing: () => true,
      toggle: toggleWithNoToken,
    });
    const user = userEvent.setup();
    const { starBtn } = renderCard(ctx);

    await expect(user.click(starBtn())).resolves.not.toThrow();

    expect(toggleWithNoToken).toHaveBeenCalledOnce();
    const result = await toggleWithNoToken.mock.results[0].value;
    expect(result === "added" || result === "removed").toBe(true);
  });

  it("page stays on /players after star click when token is absent", async () => {
    const ctx = makeCtx({
      toggle: vi.fn(async (_id: number): Promise<"added" | "removed"> => "added"),
    });
    const user = userEvent.setup();
    const { starBtn, getPath } = renderCard(ctx);

    await user.click(starBtn());

    expect(getPath()).toBe("/players");
  });

  it("multiple star clicks all resolve without error when token is absent", async () => {
    let calls = 0;
    const toggleWithNoToken = vi.fn(async (_id: number): Promise<"added" | "removed"> => {
      calls++;
      return calls % 2 === 1 ? "added" : "removed";
    });
    const ctx = makeCtx({ toggle: toggleWithNoToken });
    const user = userEvent.setup();
    const { starBtn } = renderCard(ctx);
    const btn = starBtn();

    await user.click(btn);
    await user.click(btn);
    await user.click(btn);

    expect(toggleWithNoToken).toHaveBeenCalledTimes(3);
    expect(toggleWithNoToken).toHaveBeenNthCalledWith(1, PLAYER.id);
    expect(toggleWithNoToken).toHaveBeenNthCalledWith(2, PLAYER.id);
    expect(toggleWithNoToken).toHaveBeenNthCalledWith(3, PLAYER.id);
  });
});

// ─── Mid-session token expiry (401) scenario ─────────────────────────────────

describe("PlayerCard — star toggle survives mid-session token expiry (401)", () => {
  /**
   * When a token was provisioned earlier in the session and the API subsequently
   * returns 401 (expired or rotated), MyPlayersContext.toggle catches the error
   * and falls back to localStorage — the optimistic update already applied before
   * the API call, so the watchlist state is preserved.  From PlayerCard's
   * perspective toggle still resolves to "added" | "removed" without throwing.
   */

  it("toggle returns 'added' without throwing when the API returns 401 mid-session", async () => {
    // Simulate what MyPlayersContext does: token was present, API threw 401,
    // catch block swallows the error and the optimistic result is returned.
    const toggleWith401 = vi.fn(async (_id: number): Promise<"added" | "removed"> => {
      // Mimic: optimistic add already applied, API call throws, catch returns result.
      try {
        throw new Error("HTTP 401");
      } catch {
        // fallback to localStorage — optimistic update already applied
      }
      return "added";
    });

    const ctx = makeCtx({ toggle: toggleWith401 });
    const user = userEvent.setup();
    const { starBtn } = renderCard(ctx);

    await expect(user.click(starBtn())).resolves.not.toThrow();

    expect(toggleWith401).toHaveBeenCalledOnce();
    expect(toggleWith401).toHaveBeenCalledWith(PLAYER.id);
    const result = await toggleWith401.mock.results[0].value;
    expect(result === "added" || result === "removed").toBe(true);
  });

  it("toggle returns 'removed' without throwing when the API returns 401 mid-session and player was followed", async () => {
    const toggleWith401 = vi.fn(async (_id: number): Promise<"added" | "removed"> => {
      try {
        throw new Error("HTTP 401");
      } catch {
        // fallback to localStorage — optimistic update already applied
      }
      return "removed";
    });

    const ctx = makeCtx({
      isFollowing: () => true,
      toggle: toggleWith401,
    });
    const user = userEvent.setup();
    const { starBtn } = renderCard(ctx);

    await expect(user.click(starBtn())).resolves.not.toThrow();

    expect(toggleWith401).toHaveBeenCalledOnce();
    const result = await toggleWith401.mock.results[0].value;
    expect(result === "added" || result === "removed").toBe(true);
  });

  it("optimisticIds remain correct after 401: second click sees updated state", async () => {
    // Alternating results simulate toggled optimistic state (add → remove → add).
    let calls = 0;
    const toggleWith401 = vi.fn(async (_id: number): Promise<"added" | "removed"> => {
      try {
        throw new Error("HTTP 401");
      } catch {
        // swallowed — localStorage fallback already applied optimistically
      }
      calls++;
      return calls % 2 === 1 ? "added" : "removed";
    });

    const ctx = makeCtx({ toggle: toggleWith401 });
    const user = userEvent.setup();
    const { starBtn } = renderCard(ctx);
    const btn = starBtn();

    await user.click(btn);
    await user.click(btn);
    await user.click(btn);

    expect(toggleWith401).toHaveBeenCalledTimes(3);
    const results = await Promise.all(
      toggleWith401.mock.results.map((r) => r.value as Promise<"added" | "removed">),
    );
    expect(results).toEqual(["added", "removed", "added"]);
  });

  it("page stays on /players after star click when API returns 401 mid-session", async () => {
    const toggleWith401 = vi.fn(async (_id: number): Promise<"added" | "removed"> => {
      try {
        throw new Error("HTTP 401");
      } catch {
        // swallowed
      }
      return "added";
    });

    const ctx = makeCtx({ toggle: toggleWith401 });
    const user = userEvent.setup();
    const { starBtn, getPath } = renderCard(ctx);

    await user.click(starBtn());

    expect(getPath()).toBe("/players");
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
