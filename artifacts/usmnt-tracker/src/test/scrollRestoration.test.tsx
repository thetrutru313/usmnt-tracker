import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef, type ReactElement } from "react";
import {
  goBackIfCameFrom,
  resetScrollRestoration,
  useHistoryState,
  useScrollRestoration,
} from "@/lib/scrollRestoration";

// jsdom has no layout, so give the scroller a writable scrollTop.
function fakeScrollTop(el: HTMLElement) {
  let value = 0;
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => value,
    set: (v: number) => { value = v; },
  });
}

function Harness({ path }: { path: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollRestoration(ref, path);
  return <div ref={ref} data-testid="scroller" />;
}

function scrollTo(el: HTMLElement, top: number) {
  el.scrollTop = top;
  fireEvent.scroll(el);
}

// Start each test on `path` with nothing remembered.
function start(path: string) {
  window.history.replaceState(null, "", path);
  resetScrollRestoration();
  const utils = render(<Harness path={path} />);
  const el = screen.getByTestId("scroller");
  fakeScrollTop(el);
  return { ...utils, el };
}

// An in-app link: the router calls pushState, then re-renders.
function link(rerender: (ui: ReactElement) => void, path: string) {
  act(() => { window.history.pushState(null, "", path); });
  rerender(<Harness path={path} />);
}

// Back/Forward as the app sees it: the router re-renders for the new path
// straight away, with no pushState and before any popstate handler of ours
// could run (the order that broke the first version).
function back(rerender: (ui: ReactElement) => void, path: string) {
  rerender(<Harness path={path} />);
}

afterEach(() => vi.restoreAllMocks());

describe("useScrollRestoration", () => {
  it("1: Back to a page returns to where it was scrolled", () => {
    const { rerender, el } = start("/fixtures");
    scrollTo(el, 1200);

    link(rerender, "/matches/7");
    expect(el.scrollTop).toBe(0);

    back(rerender, "/fixtures");
    expect(el.scrollTop).toBe(1200);
  });

  it("2 guard: an ordinary link to a page visited before starts at the top", () => {
    const { rerender, el } = start("/fixtures");
    scrollTo(el, 1200);

    link(rerender, "/matches/7");
    link(rerender, "/fixtures");
    expect(el.scrollTop).toBe(0);
  });

  it("3 guard: moving to a new page resets the scroll to the top", () => {
    const { rerender, el } = start("/");
    scrollTo(el, 800);

    link(rerender, "/players/12");
    expect(el.scrollTop).toBe(0);
  });

  it("4: a page saving its view state on the history entry doesn't count as a link", () => {
    const { rerender, el } = start("/fixtures");
    scrollTo(el, 1200);

    link(rerender, "/matches/7");
    act(() => { window.history.replaceState({ saved: true }, ""); });
    back(rerender, "/fixtures");
    expect(el.scrollTop).toBe(1200);
  });
});

describe("goBackIfCameFrom", () => {
  it("5: goes back in history when the previous page was the named one", () => {
    const historyBack = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { rerender } = render(<Harness path="/fixtures" />);
    rerender(<Harness path="/matches/7" />);
    const event = { preventDefault: vi.fn() };
    expect(goBackIfCameFrom("/fixtures", event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(historyBack).toHaveBeenCalled();
  });

  it("6: leaves the link alone when the previous page was something else", () => {
    const historyBack = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { rerender } = render(<Harness path="/" />);
    rerender(<Harness path="/matches/7" />);
    const event = { preventDefault: vi.fn() };
    expect(goBackIfCameFrom("/fixtures", event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(historyBack).not.toHaveBeenCalled();
  });
});

function HistoryStateHarness() {
  const [value, setValue] = useHistoryState<string[]>("testFilter", ["all"]);
  return <button onClick={() => setValue(["core"])}>{value.join(",")}</button>;
}

describe("useHistoryState", () => {
  it("7: starts from the value saved on the current history entry", () => {
    window.history.replaceState({ testFilter: ["prospect"] }, "");
    render(<HistoryStateHarness />);
    expect(screen.getByRole("button")).toHaveTextContent("prospect");
  });

  it("8: saves changes onto the current history entry", () => {
    render(<HistoryStateHarness />);
    expect(screen.getByRole("button")).toHaveTextContent("all");
    fireEvent.click(screen.getByRole("button"));
    expect((window.history.state as { testFilter: string[] }).testFilter).toEqual(["core"]);
  });
});
