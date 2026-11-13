/**
 * Component timers are cleared (review C7).
 *
 * Change-verifying:
 * 1. /recover doesn't redirect after the page has unmounted.
 * 2. "Copied!" in Sync My Players lasts 2 s from the latest copy; an earlier
 *    copy's timer no longer cuts it short.
 * 3. Sync My Players clears its "Copied!" timer on unmount.
 * Regression guard: /recover still stores the new token when the page
 * unmounts before the server answers (the recovery link is single-use).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Recover from "@/pages/Recover";
import { SyncMyPlayersModal } from "@/components/SyncMyPlayersModal";
import { MyPlayersContext, type MyPlayersContextValue } from "@/context/MyPlayersContext";

const RECOVER_URL = "http://localhost/recover?token=timer-token";

function atRecoverUrl() {
  Object.defineProperty(window, "location", {
    writable: true,
    value: { ...window.location, search: "?token=timer-token", href: RECOVER_URL, origin: "http://localhost" },
  });
}

function renderModal() {
  const ctx = {
    followedIds: [],
    isFollowing: () => false,
    toggle: () => {},
    generateTransferLink: async () => "http://localhost/recover?token=new-link",
  } as unknown as MyPlayersContextValue;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  return render(
    <MyPlayersContext.Provider value={ctx}>
      <SyncMyPlayersModal open onOpenChange={() => {}} />
    </MyPlayersContext.Provider>,
  );
}

async function generateAndCopy() {
  fireEvent.click(screen.getByRole("button", { name: /generate transfer link/i }));
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: /copy link/i }));
  await act(async () => {});
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  delete (navigator as unknown as Record<string, unknown>).clipboard;
});

describe("Recover page timers", () => {
  it("1: does not redirect after the page unmounts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve({ token: "fresh-token" }),
    }));
    atRecoverUrl();
    const { unmount } = render(<Recover />);
    await waitFor(() => expect(screen.getByText("Watchlist restored!")).toBeInTheDocument());
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 1700));
    expect(window.location.href).toBe(RECOVER_URL);
  }, 10_000);

  it("guard: still stores the new token when unmounted before the server answers", async () => {
    let answer: (value: unknown) => void = () => {};
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise((resolve) => { answer = resolve; })));
    atRecoverUrl();
    const { unmount } = render(<Recover />);
    unmount();
    await act(async () => {
      answer({ ok: true, status: 200, json: () => Promise.resolve({ token: "late-token" }) });
    });
    await waitFor(() => expect(localStorage.getItem("usmnt_anon_token")).toBe("late-token"));
  });
});

describe("Sync My Players copy timer", () => {
  it("2: a second copy restarts the 2 s 'Copied!' timer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    renderModal();
    await generateAndCopy();
    expect(screen.getByRole("button", { name: /copied!/i })).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1500); });
    fireEvent.click(screen.getByRole("button", { name: /copied!/i }));
    await act(async () => {});

    // 2.5 s after the first copy, 1 s after the second: still "Copied!".
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole("button", { name: /copied!/i })).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole("button", { name: /copy link/i })).toBeInTheDocument();
  });

  it("3: clears the 'Copied!' timer on unmount", async () => {
    const setSpy = vi.spyOn(globalThis, "setTimeout");
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const { unmount } = renderModal();
    await generateAndCopy();
    const call = setSpy.mock.calls.findIndex((args) => args[1] === 2000);
    expect(call).toBeGreaterThanOrEqual(0);
    const timerId = setSpy.mock.results[call]!.value;
    unmount();
    expect(clearSpy).toHaveBeenCalledWith(timerId);
  });
});
