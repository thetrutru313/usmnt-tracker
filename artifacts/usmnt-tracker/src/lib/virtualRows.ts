/**
 * Settings for the Fixtures page's virtualized list, so a row that changes
 * size on screen (a fixture card's player list opening or closing) moves the
 * rows below it smoothly.
 */
import { useCallback, useReducer, useRef } from "react";
import { flushSync } from "react-dom";
import type { VirtualItem, Virtualizer } from "@tanstack/react-virtual";

/**
 * The virtualizer re-renders a frame after a row resizes, so for one frame
 * the rows below sit in their old place: the growing card overlaps them, or a
 * gap opens. Returns an `onChange` that re-renders before that frame is
 * painted instead. Skipped while scrolling, where the normal path is fine and
 * cheaper.
 */
export function useSameFrameRowUpdates() {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const pending = useRef(false);
  return useCallback((instance: Virtualizer<HTMLElement, Element>) => {
    if (instance.isScrolling || pending.current) return;
    pending.current = true;
    // A microtask still runs before the paint when called from the resize observer.
    queueMicrotask(() => {
      pending.current = false;
      flushSync(rerender);
    });
  }, []);
}

/**
 * When a row changes size, shift the scroll position (so the screen stays
 * still) only for rows above the screen. A row on screen, even one starting
 * above it, grows or shrinks in place and the rows below move instead.
 * Rows measured for the first time keep the library's usual rule (any row
 * starting above the screen), which avoids jumps when scrolling back up.
 */
export function adjustScrollForRowsAbove(item: VirtualItem, _delta: number, instance: Virtualizer<HTMLElement, Element>): boolean {
  const internals = instance as unknown as {
    getScrollOffset?: () => number;
    scrollOffset?: number | null;
    scrollAdjustments?: number;
    itemSizeCache?: Map<unknown, number>;
  };
  const top = (internals.getScrollOffset?.() ?? internals.scrollOffset ?? 0) + (internals.scrollAdjustments ?? 0);
  const firstMeasure = !internals.itemSizeCache?.has(item.key);
  return firstMeasure ? item.start < top : item.end <= top;
}
