import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Alerts from "@/pages/Alerts";
import { DEFAULT_PREFS, urlBase64ToUint8Array } from "@/lib/push";

const ENDPOINT = "https://web.push.apple.com/test-device";
const fakeSubscription = {
  endpoint: ENDPOINT,
  toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: "p256dh-key", auth: "auth-key" } }),
  unsubscribe: vi.fn().mockResolvedValue(true),
};

let pushManager: { getSubscription: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> };
let requestPermission: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

function setNavigator(key: string, value: unknown) {
  Object.defineProperty(navigator, key, { configurable: true, value });
}

/** A browser with push support, no subscription yet, and a server with a key. */
function supportedBrowser() {
  pushManager = {
    getSubscription: vi.fn().mockResolvedValue(null),
    subscribe: vi.fn().mockResolvedValue(fakeSubscription),
  };
  setNavigator("serviceWorker", {
    ready: Promise.resolve({ pushManager }),
    getRegistration: vi.fn().mockResolvedValue({ pushManager }),
  });
  requestPermission = vi.fn().mockResolvedValue("granted");
  vi.stubGlobal("PushManager", function PushManager() {});
  vi.stubGlobal("Notification", { permission: "default", requestPermission });
  fetchMock = vi.fn();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/push/config")) {
      return new Response(JSON.stringify({ publicKey: "BAAA" }), { status: 200 });
    }
    if (url.endsWith("/api/push/subscription") && init?.method === "PUT") {
      return new Response(JSON.stringify({ prefs: JSON.parse(init.body as string).prefs }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
}

function putBodies() {
  return fetchMock.mock.calls
    .filter(([url, init]) => String(url).endsWith("/api/push/subscription") && (init as RequestInit)?.method === "PUT")
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

beforeEach(() => {
  // An existing anon token, so no account is provisioned during the tests.
  localStorage.setItem("usmnt_anon_token", "test-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (navigator as unknown as Record<string, unknown>)["serviceWorker"];
  delete (navigator as unknown as Record<string, unknown>)["userAgent"];
  localStorage.clear();
});

describe("Alerts page", () => {
  it("1: on iPhone Safari, explains that alerts need the Home Screen app", async () => {
    setNavigator("userAgent", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1");
    render(<Alerts />);
    expect(await screen.findByText(/Add USMNT Tracker to your Home Screen first/i)).toBeInTheDocument();
  });

  it("2: Enable asks for permission, subscribes with the server key, and saves the default choices", async () => {
    supportedBrowser();
    render(<Alerts />);
    fireEvent.click(await screen.findByRole("button", { name: /Enable alerts/i }));

    expect(await screen.findByText("Alert types")).toBeInTheDocument();
    expect(requestPermission).toHaveBeenCalled();
    expect(pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) }),
    );
    expect(putBodies()[0]).toEqual({
      subscription: { endpoint: ENDPOINT, keys: { p256dh: "p256dh-key", auth: "auth-key" } },
      prefs: DEFAULT_PREFS,
    });
  });

  it("3: switching an alert type off saves the change", async () => {
    supportedBrowser();
    render(<Alerts />);
    fireEvent.click(await screen.findByRole("button", { name: /Enable alerts/i }));
    fireEvent.click(await screen.findByRole("switch", { name: "Goals & assists" }));

    await waitFor(() => expect(putBodies()).toHaveLength(2));
    expect(putBodies()[1].prefs).toEqual({ ...DEFAULT_PREFS, goals: false });
  });

  it("4: shows a blocked message when notifications were denied", async () => {
    supportedBrowser();
    vi.stubGlobal("Notification", { permission: "denied", requestPermission });
    render(<Alerts />);
    expect(await screen.findByText(/Notifications are blocked/i)).toBeInTheDocument();
  });
});

describe("urlBase64ToUint8Array", () => {
  it("5: decodes a base64url key to bytes", () => {
    expect(Array.from(urlBase64ToUint8Array("AQID_-8"))).toEqual([1, 2, 3, 255, 239]);
  });
});
