import { describe, it, expect } from "vitest";
import type { VirtualItem, Virtualizer } from "@tanstack/react-virtual";
import { adjustScrollForRowsAbove } from "@/lib/virtualRows";

/** A list scrolled to 1000px whose row "a" has been measured before. */
function list(scrollOffset = 1000) {
  return { scrollOffset, scrollAdjustments: 0, itemSizeCache: new Map([["a", 300]]) } as unknown as Virtualizer<HTMLElement, Element>;
}
const row = (key: string, start: number, size: number): VirtualItem => ({ key, index: 0, start, size, end: start + size, lane: 0 });

describe("adjustScrollForRowsAbove", () => {
  it("keeps the screen still when a row entirely above it changes size", () => {
    expect(adjustScrollForRowsAbove(row("a", 600, 300), -100, list())).toBe(true);
  });

  it("lets a row on screen grow or shrink in place, even one that starts above the screen", () => {
    expect(adjustScrollForRowsAbove(row("a", 900, 300), -100, list())).toBe(false);
    expect(adjustScrollForRowsAbove(row("a", 1100, 300), 100, list())).toBe(false);
  });

  it("corrects a row measured for the first time that starts above the screen (scrolling back up)", () => {
    expect(adjustScrollForRowsAbove(row("new", 900, 300), 40, list())).toBe(true);
  });
});
