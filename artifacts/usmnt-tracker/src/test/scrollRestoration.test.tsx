import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
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

function popstate() {
  act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
}

beforeEach(() => resetScrollRestoration());
afterEach(() => vi.restoreAllMocks());

describe("useScrollRestoration", () => {
  it("1: Back to a page returns to where it was scrolled", () => {
    const { rerender } = render(<Harness path="/fixtures" />);
    const el = screen.getByTestId("scroller");
    fakeScrollTop(el);
    scrollTo(el, 1200);

    rerender(<Harness path="/matches/7" />);
    expect(el.scrollTop).toBe(0);

    popstate();
    rerender(<Harness path="/fixtures" />);
    expect(el.scrollTop).toBe(1200);
  });

  it("2: an ordinary link to a page visited before starts at the top", () => {
    const { rerender } = render(<Harness path="/fixtures" />);
    const el = screen.getByTestId("scroller");
    fakeScrollTop(el);
    scrollTo(el, 1200);

    rerender(<Harness path="/matches/7" />);
    rerender(<Harness path="/fixtures" />);
    expect(el.scrollTop).toBe(0);
  });

  it("3: moving to a new page resets the scroll to the top", () => {
    const { rerender } = render(<Harness path="/" />);
    const el = screen.getByTestId("scroller");
    fakeScrollTop(el);
    scrollTo(el, 800);

    rerender(<Harness path="/players/12" />);
    expect(el.scrollTop).toBe(0);
  });
});

describe("goBackIfCameFrom", () => {
  it("4: goes back in history when the previous page was the named one", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { rerender } = render(<Harness path="/fixtures" />);
    rerender(<Harness path="/matches/7" />);
    const event = { preventDefault: vi.fn() };
    expect(goBackIfCameFrom("/fixtures", event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(back).toHaveBeenCalled();
  });

  it("5: leaves the link alone when the previous page was something else", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { rerender } = render(<Harness path="/" />);
    rerender(<Harness path="/matches/7" />);
    const event = { preventDefault: vi.fn() };
    expect(goBackIfCameFrom("/fixtures", event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
  });
});

function HistoryStateHarness() {
  const [value, setValue] = useHistoryState<string[]>("testFilter", ["all"]);
  return <button onClick={() => setValue(["core"])}>{value.join(",")}</button>;
}

describe("useHistoryState", () => {
  it("6: starts from the value saved on the current history entry", () => {
    window.history.replaceState({ testFilter: ["prospect"] }, "");
    render(<HistoryStateHarness />);
    expect(screen.getByRole("button")).toHaveTextContent("prospect");
  });

  it("7: saves changes onto the current history entry", () => {
    render(<HistoryStateHarness />);
    expect(screen.getByRole("button")).toHaveTextContent("all");
    fireEvent.click(screen.getByRole("button"));
    expect((window.history.state as { testFilter: string[] }).testFilter).toEqual(["core"]);
  });
});
