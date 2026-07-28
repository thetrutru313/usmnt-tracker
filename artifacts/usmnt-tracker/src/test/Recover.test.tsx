/**
 * Tests for the /recover page — confirms that used, expired, superseded, and
 * invalid recovery tokens all render a clear error state with a "Go to home"
 * button, and that no path leaves the page stuck on the loading spinner.
 *
 * ## Why this matters
 * The /recover page is the only recovery path for users who lose their
 * watchlist. A regression that turns error responses into a blank or
 * spinner-stuck page silently breaks recovery with no visible explanation.
 *
 * ## What is tested
 * 1. A used token (400 "Recovery token has already been used") → error state
 * 2. An expired token (400 "Recovery token has expired") → error state
 * 3. A superseded token (400 "…replaced when a newer one was generated") → error state
 * 4. An invalid/unknown token (400 "Invalid recovery token") → error state
 * 5. Missing token in the URL (no fetch at all) → error state
 * 6. Every error case renders the "Go to home" button — no blank/stuck page
 * 7. A valid token → success state (confirm the happy path still works)
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Recover from "@/pages/Recover";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Render <Recover /> after injecting `?token=<value>` into location.search. */
function renderWithToken(token: string | null) {
  const search = token !== null ? `?token=${token}` : "";
  // jsdom sets window.location.href but treats the object as read-only for
  // individual properties, so we use Object.defineProperty on the getter that
  // Recover reads directly.
  Object.defineProperty(window, "location", {
    writable: true,
    value: {
      ...window.location,
      search,
      href: `http://localhost/recover${search}`,
      origin: "http://localhost",
    },
  });
  return render(<Recover />);
}

/** Stub global fetch to return a 400 JSON error response. */
function stubFetchError(errorMessage: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: errorMessage }),
    }),
  );
}

/** Stub global fetch to return a 200 JSON success response. */
function stubFetchSuccess(newToken = "fresh-auth-token-abc") {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ token: newToken }),
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe("Recover page — used token", () => {
  it("renders the error state when the token has already been used", async () => {
    stubFetchError("Recovery token has already been used");
    renderWithToken("used-token-abc123");

    await waitFor(() => {
      expect(
        screen.getByText("Couldn't restore your watchlist"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText("Recovery token has already been used"),
    ).toBeInTheDocument();
  });

  it("shows the 'Go to home' button for a used token", async () => {
    stubFetchError("Recovery token has already been used");
    renderWithToken("used-token-abc123");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /go to home/i })).toBeInTheDocument();
    });
  });

  it("does not stay stuck on the loading spinner after a used-token error", async () => {
    stubFetchError("Recovery token has already been used");
    renderWithToken("used-token-abc123");

    await waitFor(() => {
      expect(screen.queryByText(/restoring your watchlist/i)).not.toBeInTheDocument();
    });
  });
});

describe("Recover page — expired token", () => {
  it("renders the error state when the token has expired", async () => {
    stubFetchError("Recovery token has expired");
    renderWithToken("expired-token-xyz");

    await waitFor(() => {
      expect(
        screen.getByText("Couldn't restore your watchlist"),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("Recovery token has expired")).toBeInTheDocument();
  });

  it("shows the 'Go to home' button for an expired token", async () => {
    stubFetchError("Recovery token has expired");
    renderWithToken("expired-token-xyz");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /go to home/i })).toBeInTheDocument();
    });
  });

  it("does not stay stuck on the loading spinner after an expired-token error", async () => {
    stubFetchError("Recovery token has expired");
    renderWithToken("expired-token-xyz");

    await waitFor(() => {
      expect(screen.queryByText(/restoring your watchlist/i)).not.toBeInTheDocument();
    });
  });
});

describe("Recover page — superseded token", () => {
  it("renders the error state when the token was replaced by a newer one", async () => {
    stubFetchError(
      "This recovery token was replaced when a newer one was generated",
    );
    renderWithToken("superseded-token-old");

    await waitFor(() => {
      expect(
        screen.getByText("Couldn't restore your watchlist"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        "This recovery token was replaced when a newer one was generated",
      ),
    ).toBeInTheDocument();
  });

  it("shows the 'Go to home' button for a superseded token", async () => {
    stubFetchError(
      "This recovery token was replaced when a newer one was generated",
    );
    renderWithToken("superseded-token-old");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /go to home/i })).toBeInTheDocument();
    });
  });
});

describe("Recover page — invalid/unknown token", () => {
  it("renders the error state for an unrecognised token", async () => {
    stubFetchError("Invalid recovery token");
    renderWithToken("not-a-real-token");

    await waitFor(() => {
      expect(
        screen.getByText("Couldn't restore your watchlist"),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("Invalid recovery token")).toBeInTheDocument();
  });

  it("shows the 'Go to home' button for an invalid token", async () => {
    stubFetchError("Invalid recovery token");
    renderWithToken("not-a-real-token");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /go to home/i })).toBeInTheDocument();
    });
  });

  it("does not stay stuck on the loading spinner for an invalid token", async () => {
    stubFetchError("Invalid recovery token");
    renderWithToken("not-a-real-token");

    await waitFor(() => {
      expect(screen.queryByText(/restoring your watchlist/i)).not.toBeInTheDocument();
    });
  });
});

describe("Recover page — missing token in URL", () => {
  it("renders the error state immediately when no token is present in the URL", async () => {
    // No fetch stub needed — the component bails out before any network call
    vi.stubGlobal("fetch", vi.fn());
    renderWithToken(null);

    await waitFor(() => {
      expect(
        screen.getByText("Couldn't restore your watchlist"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText("No recovery token found in the URL."),
    ).toBeInTheDocument();
  });

  it("shows the 'Go to home' button when no token is in the URL", async () => {
    vi.stubGlobal("fetch", vi.fn());
    renderWithToken(null);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /go to home/i })).toBeInTheDocument();
    });
  });

  it("never calls fetch when the token is missing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderWithToken(null);

    // Wait for the component to settle (error state shown)
    await waitFor(() => {
      expect(screen.getByText("No recovery token found in the URL.")).toBeInTheDocument();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Happy path — confirm the success state still works
// ---------------------------------------------------------------------------

describe("Recover page — valid token (happy path)", () => {
  it("renders the success state when the token is accepted", async () => {
    stubFetchSuccess("brand-new-token-999");
    renderWithToken("valid-token-abc");

    await waitFor(() => {
      expect(screen.getByText("Watchlist restored!")).toBeInTheDocument();
    });

    // Should NOT show the error heading
    expect(
      screen.queryByText("Couldn't restore your watchlist"),
    ).not.toBeInTheDocument();

    // Should NOT show the "Go to home" button (the page auto-redirects instead)
    expect(
      screen.queryByRole("button", { name: /go to home/i }),
    ).not.toBeInTheDocument();
  });

  it("stores the new auth token in localStorage on success", async () => {
    stubFetchSuccess("brand-new-token-999");
    renderWithToken("valid-token-abc");

    await waitFor(() => {
      expect(screen.getByText("Watchlist restored!")).toBeInTheDocument();
    });

    expect(localStorage.getItem("usmnt_anon_token")).toBe("brand-new-token-999");
  });
});
