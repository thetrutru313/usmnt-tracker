import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

// ── Scroll restoration ────────────────────────────────────────────────────────
// Pages scroll inside Layout's overflow-auto div, not the window, so the
// browser's own scroll restoration never applies. Positions are remembered per
// path: Back/Forward (popstate) returns to the saved spot, and any other
// navigation starts at the top.

const scrollPositions = new Map<string, number>();
let popPending = false;
let previousPath: string | null = null;

// How long to keep re-applying a restored position while the page is still
// growing (e.g. data arriving after a cold load). Stops early on user input.
const RESTORE_MAX_FRAMES = 120;

/** Path of the in-app page shown before the current one, or null. */
export function getPreviousPath(): string | null {
  return previousPath;
}

/**
 * For "Back to X" links: when the previous page was `path`, go back in
 * history (so its scroll position is restored) instead of pushing a new entry.
 * Returns true when it handled the click.
 */
export function goBackIfCameFrom(path: string, event: { preventDefault(): void }): boolean {
  if (previousPath !== path) return false;
  event.preventDefault();
  window.history.back();
  return true;
}

/** Test-only: forget all saved state. */
export function resetScrollRestoration(): void {
  scrollPositions.clear();
  popPending = false;
  previousPath = null;
}

export function useScrollRestoration(
  scrollRef: RefObject<HTMLElement | null>,
  location: string,
): void {
  const locationRef = useRef<string | null>(null);

  useEffect(() => {
    // Cleared shortly after, so a popstate that doesn't change the path can't
    // turn the next ordinary navigation into a "restore".
    const onPop = () => {
      popPending = true;
      setTimeout(() => { popPending = false; }, 500);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (locationRef.current !== null) scrollPositions.set(locationRef.current, el.scrollTop);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollRef]);

  useLayoutEffect(() => {
    if (locationRef.current !== null && locationRef.current !== location) {
      previousPath = locationRef.current;
    }
    const isFirst = locationRef.current === null;
    locationRef.current = location;
    const isPop = popPending;
    popPending = false;

    const el = scrollRef.current;
    if (!el || isFirst) return;
    const target = isPop ? scrollPositions.get(location) ?? 0 : 0;

    let frame = 0;
    let frames = 0;
    const apply = () => {
      el.scrollTop = target;
      if (Math.abs(el.scrollTop - target) > 1 && frames++ < RESTORE_MAX_FRAMES) {
        frame = requestAnimationFrame(apply);
      }
    };
    const stop = () => cancelAnimationFrame(frame);
    apply();
    el.addEventListener("wheel", stop, { passive: true });
    el.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("keydown", stop);
    return () => {
      stop();
      el.removeEventListener("wheel", stop);
      el.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
    };
  }, [scrollRef, location]);
}

// ── Per-history-entry view state ──────────────────────────────────────────────
// useState that is also saved on the current history entry, so going Back to a
// page brings back its filters and toggles; a fresh visit starts from `initial`.

export function useHistoryState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = (window.history.state as Record<string, unknown> | null)?.[key];
      return saved === undefined ? initial : (saved as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      const state = (window.history.state as Record<string, unknown> | null) ?? {};
      window.history.replaceState({ ...state, [key]: value }, "");
    } catch {
      // History unavailable (sandboxed preview) — state just isn't remembered.
    }
  }, [key, value]);
  return [value, setValue] as const;
}
