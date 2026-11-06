export type DayGroup = { index: number; top: number; height: number };

/**
 * Boxes for the pinned date headings. Each day's heading is drawn inside a
 * box that runs from the heading down to the next day's heading; the heading
 * is `position: sticky` inside it, so the browser pins it while that day is
 * on screen and lets the next heading push it off. No JavaScript runs per
 * scroll frame, which keeps the movement smooth.
 *   headings — each heading's row index and the top of the heading itself
 *              (below its mt-8 gap), measured from the top of the list
 *   end      — bottom of the list
 */
export function dayGroups(headings: { index: number; top: number }[], end: number): DayGroup[] {
  return headings.map((h, i) => {
    const bottom = headings[i + 1]?.top ?? end;
    return { index: h.index, top: h.top, height: Math.max(0, bottom - h.top) };
  });
}
