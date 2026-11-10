import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

const DURATION_MS = 240;
const EASING = "cubic-bezier(0.2, 0, 0, 1)";

/**
 * Expand/collapse a block with its height animated, e.g. a card's "+N more"
 * list. Put `ref` on the block and render its long or short content from
 * `expanded`.
 *
 * Expanding shows the full content at once and grows the block over it.
 * Collapsing shrinks the block over the full content and only switches to
 * the short content at the end, at the same height, so nothing jumps.
 * Without animation support (tests) or with reduced motion, it toggles at once.
 */
export function useAnimatedExpand<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [expanded, setExpanded] = useState(false);
  // Height of the collapsed block, and the width it was measured at.
  const collapsedSize = useRef<{ width: number; height: number } | null>(null);
  const running = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !expanded && !running.current) collapsedSize.current = { width: el.clientWidth, height: el.offsetHeight };
  });

  useEffect(() => () => running.current?.cancel(), []);

  const toggle = useCallback(() => {
    const el = ref.current;
    if (running.current) return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!el || typeof el.animate !== "function" || reduced) {
      setExpanded((v) => !v);
      return;
    }

    const animate = (from: number, to: number, done?: () => void) => {
      if (from === to) {
        done?.();
        return;
      }
      el.style.overflow = "hidden";
      const anim = el.animate([{ boxSizing: "border-box", height: `${from}px` }, { boxSizing: "border-box", height: `${to}px` }], { duration: DURATION_MS, easing: EASING, fill: "forwards" });
      running.current = anim;
      anim.onfinish = () => {
        done?.();
        anim.cancel();
        el.style.overflow = "";
        running.current = null;
      };
    };

    const from = el.offsetHeight;
    if (!expanded) {
      flushSync(() => setExpanded(true));
      animate(from, el.offsetHeight);
      return;
    }
    const collapsed = collapsedSize.current;
    if (collapsed && collapsed.width === el.clientWidth) {
      animate(from, collapsed.height, () => flushSync(() => setExpanded(false)));
    } else {
      // Width changed since it was last collapsed (e.g. rotated): switch first, then shrink.
      flushSync(() => setExpanded(false));
      animate(from, el.offsetHeight);
    }
  }, [expanded]);

  return { ref, expanded, toggle };
}
