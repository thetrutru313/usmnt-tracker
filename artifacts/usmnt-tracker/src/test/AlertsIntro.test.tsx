import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { AlertsIntro, ALERTS_INTRO_SEEN_KEY } from "@/components/AlertsIntro";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";

function setNavigator(key: string, value: unknown) {
  Object.defineProperty(navigator, key, { configurable: true, value });
}

/** A device with push support; `installed` = opened from the Home Screen. */
function device({ ua = IPHONE_UA, installed = true, permission = "default" } = {}) {
  setNavigator("userAgent", ua);
  setNavigator("maxTouchPoints", ua === IPHONE_UA ? 5 : 0);
  setNavigator("serviceWorker", {});
  vi.stubGlobal("PushManager", function PushManager() {});
  vi.stubGlobal("Notification", { permission });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: installed && query.includes("standalone"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function open(path = "/") {
  const location = memoryLocation({ path });
  render(
    <Router hook={location.hook}>
      <AlertsIntro />
      <Route path="/alerts"><p>Alerts page</p></Route>
    </Router>,
  );
  act(() => { vi.advanceTimersByTime(1000); });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const key of ["userAgent", "maxTouchPoints", "serviceWorker"]) {
    delete (navigator as unknown as Record<string, unknown>)[key];
  }
  localStorage.clear();
});

describe("Alerts intro popup", () => {
  it("1: shows in the installed iPhone app and remembers that it was shown", () => {
    device();
    open();
    expect(screen.getByText("New: alerts")).toBeInTheDocument();
    expect(localStorage.getItem(ALERTS_INTRO_SEEN_KEY)).not.toBeNull();
  });

  it("2: never shows a second time, even if the first one was never tapped", () => {
    device();
    open();
    expect(screen.getByText("New: alerts")).toBeInTheDocument();
    cleanup(); // the app is closed without tapping anything
    open();
    expect(screen.queryByText("New: alerts")).not.toBeInTheDocument();
  });

  it("3: doesn't show in a normal Safari tab", () => {
    device({ installed: false });
    open();
    expect(screen.queryByText("New: alerts")).not.toBeInTheDocument();
  });

  it("4: doesn't show on desktop, even as an installed app", () => {
    device({ ua: DESKTOP_UA });
    open();
    expect(screen.queryByText("New: alerts")).not.toBeInTheDocument();
  });

  it("5: doesn't show when alerts are already allowed", () => {
    device({ permission: "granted" });
    open();
    expect(screen.queryByText("New: alerts")).not.toBeInTheDocument();
  });

  it("6: doesn't show when the app opens on the Alerts page", () => {
    device();
    open("/alerts");
    expect(screen.queryByText("New: alerts")).not.toBeInTheDocument();
  });

  it("7: Set up alerts opens the Alerts page", () => {
    device();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Set up alerts" }));
    expect(screen.getByText("Alerts page")).toBeInTheDocument();
    expect(screen.queryByText("New: alerts")).not.toBeInTheDocument();
  });
});
