/**
 * Regression guards for two admin session bugs.
 *
 * FIX A — ReAuthModal token propagation:
 *   After a successful re-auth, onSuccess must be called with the new token.
 *   Pre-fix: onSuccess() was called with no argument; root token state was never
 *   updated so every subsequent request still carried the old token → 401 loop.
 *
 * FIX B — validate race guard:
 *   A stale in-flight validate that resolves 401 AFTER a new login has saved a
 *   fresh token must NOT clear the session. Pre-fix: handleUnauthorized() fired
 *   unconditionally, wiping the new token and re-showing the login form.
 *
 * Both tests FAIL against the pre-fix code and PASS after.
 * The ordering of events is explicit — no timing dependency.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ReAuthModal is exported so it can be tested in isolation (Fix A).
// Admin is the root component used to exercise the validate race (Fix B).
import { ReAuthModal } from "../pages/Admin";
import Admin from "../pages/Admin";
import { saveSession, loadSession } from "../lib/adminSession";

// ─── Shared helpers ────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Fix A: ReAuthModal token propagation ─────────────────────────────────────

describe("ReAuthModal — Fix A: token propagation", () => {
  it("calls onSuccess with the new token after a successful re-auth submit", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, token: "new-session-token", sessionExpiryMs: 86400000 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const onSuccess = vi.fn();
    const user = userEvent.setup();

    render(<ReAuthModal onSuccess={onSuccess} onCancel={() => {}} />);

    await user.type(screen.getByPlaceholderText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: /extend session/i }));

    // Before fix — onSuccess() called with no argument: this assertion FAILS.
    // After fix  — onSuccess("new-session-token") called:  this assertion PASSES.
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith("new-session-token");
    });
  });
});

// ─── Fix B: validate race guard ────────────────────────────────────────────────

describe("Admin — Fix B: stale validate 401 must not evict a freshly issued token", () => {
  it("keeps the session when a slow validate 401 resolves after a new login succeeds", async () => {
    // Start with old-token in localStorage so Admin renders AdminPanel immediately.
    saveSession("old-token");

    // A deferred promise that stands in for the in-flight validate request.
    // We resolve it manually AFTER the new login has saved its token.
    let resolveOldValidate!: (r: Response) => void;
    const oldValidatePromise = new Promise<Response>((resolve) => {
      resolveOldValidate = resolve;
    });

    vi.spyOn(global, "fetch").mockImplementation(
      async (url: RequestInfo | URL, opts?: RequestInit) => {
        const urlStr =
          url instanceof URL
            ? url.toString()
            : typeof url === "string"
              ? url
              : (url as Request).url;
        const auth =
          (opts?.headers as Record<string, string> | undefined)?.["Authorization"] ?? "";

        // Block the old-token validate — we'll resolve it manually below.
        if (urlStr.includes("/admin/session") && auth.includes("old-token")) {
          return oldValidatePromise;
        }

        // Return safe minimal data for every other admin endpoint so child
        // components don't crash or trigger unrelated session-expiry paths.
        let body: unknown = {};
        if (urlStr.includes("/admin/review-queue")) body = { candidates: [], pendingRescore: 0 };
        else if (urlStr.includes("/api/transparency")) body = { months: [] };
        else if (urlStr.includes("/admin/config")) body = { signals: [] };
        else if (urlStr.includes("/admin/players")) body = { players: [] };
        else if (urlStr.includes("/admin/clubs")) body = { clubs: [] };
        else if (urlStr.includes("/admin/rescore-status")) {
          body = { pendingTotal: 0, withinCap: 0, backlog: 0, cap: 100, pendingRescore: 0 };
        }

        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );

    const qc = makeQueryClient();
    render(
      <QueryClientProvider client={qc}>
        <Admin />
      </QueryClientProvider>,
    );

    // AdminPanel is now mounted and its validate is in-flight (blocked above).
    // Simulate a concurrent successful login: write the fresh token to localStorage,
    // exactly as LoginForm.handleSubmit does after verify returns 200.
    saveSession("new-token");

    // Now resolve the stale validate with 401 — this is the race condition.
    // Inside act() so React flushes all resulting state updates synchronously.
    await act(async () => {
      resolveOldValidate(
        new Response(JSON.stringify({}), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      );
      // Drain the microtask queue so the apiFetch → catch → guard chain runs.
      await new Promise<void>((r) => setTimeout(r, 0));
    });

    // Before fix: handleUnauthorized() fires unconditionally →
    //   clearSession() wipes new-token, setToken(null) → LoginForm renders →
    //   password input appears in the DOM → assertion below FAILS.
    //
    // After fix: guard detects loadSession() ("new-token") ≠ token ("old-token")
    //   → handleUnauthorized() skipped → AdminPanel stays mounted →
    //   no LoginForm → no password input → assertion PASSES.
    expect(
      screen.queryByPlaceholderText("Password"),
      "Login form must not reappear after a stale validate 401 races with a fresh login",
    ).not.toBeInTheDocument();

    // The new token must still be in localStorage, not wiped by the stale 401.
    expect(loadSession()).toBe("new-token");
  });
});
