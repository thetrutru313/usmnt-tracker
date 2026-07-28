/**
 * Tests for MyPlayersContext — watchlist protection against malformed API responses.
 *
 * ## Why this matters
 * The sync effect in MyPlayersProvider overwrites optimisticIds from remoteFollows.
 * If the follows GET returns a 200 with a missing or null playerIds field, the
 * previous code would fall back to [] and silently clear the watchlist.
 *
 * ## What is tested
 * 1. A 200 response with playerIds missing entirely → optimisticIds preserved
 * 2. A 200 response with playerIds: null → optimisticIds preserved
 * 3. A 200 response with playerIds: "not-an-array" → optimisticIds preserved
 * 4. localStorage values are unchanged after a bad-shape response
 * 5. A well-formed response still syncs correctly (regression guard)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MyPlayersContext, MyPlayersProvider } from "@/context/MyPlayersContext";

// ---------------------------------------------------------------------------
// Constants matching the ones used inside MyPlayersContext
// ---------------------------------------------------------------------------

const ANON_TOKEN_KEY = "usmnt_anon_token";
const LOCAL_FOLLOWS_KEY = "usmnt_my_players";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seed localStorage with a token and a set of followed player IDs. */
function seedLocalStorage(playerIds: number[]) {
  localStorage.setItem(ANON_TOKEN_KEY, "test-token-abc");
  localStorage.setItem(LOCAL_FOLLOWS_KEY, JSON.stringify(playerIds));
}

/**
 * A consumer component that reads followedIds from context and renders each ID
 * into the DOM so we can assert on them without reaching into React internals.
 */
function WatchlistDisplay() {
  const { followedIds } = React.useContext(MyPlayersContext);
  return (
    <ul data-testid="watchlist">
      {[...followedIds].map((id) => (
        <li key={id} data-testid={`player-${id}`}>
          {id}
        </li>
      ))}
    </ul>
  );
}

/** Wrap WatchlistDisplay in the required providers. */
function renderWithProviders(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MyPlayersProvider>
        <WatchlistDisplay />
      </MyPlayersProvider>
    </QueryClientProvider>,
  );
}

/** Build a fetch mock that returns a 200 with the given body. */
function stubFetch200(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Malformed response — playerIds missing
// ---------------------------------------------------------------------------

describe("MyPlayersContext — malformed follows response (missing playerIds)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    seedLocalStorage([1, 2, 3]);
    // Return a 200 with no playerIds field at all
    stubFetch200({ status: "ok" });
  });

  it("does not overwrite optimisticIds when playerIds is absent from the response", async () => {
    renderWithProviders(qc);

    // Allow the query to settle
    await waitFor(() => {
      // The query should have errored (shape validation), so the watchlist
      // must still contain the original seeded IDs.
      expect(screen.getByTestId("player-1")).toBeInTheDocument();
      expect(screen.getByTestId("player-2")).toBeInTheDocument();
      expect(screen.getByTestId("player-3")).toBeInTheDocument();
    });
  });

  it("preserves localStorage when playerIds is absent from the response", async () => {
    renderWithProviders(qc);

    await waitFor(() => {
      expect(screen.getByTestId("player-1")).toBeInTheDocument();
    });

    const stored = JSON.parse(localStorage.getItem(LOCAL_FOLLOWS_KEY) ?? "[]");
    expect(stored).toContain(1);
    expect(stored).toContain(2);
    expect(stored).toContain(3);
  });
});

// ---------------------------------------------------------------------------
// Malformed response — playerIds: null
// ---------------------------------------------------------------------------

describe("MyPlayersContext — malformed follows response (playerIds: null)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    seedLocalStorage([10, 20]);
    stubFetch200({ playerIds: null });
  });

  it("does not overwrite optimisticIds when playerIds is null", async () => {
    renderWithProviders(qc);

    await waitFor(() => {
      expect(screen.getByTestId("player-10")).toBeInTheDocument();
      expect(screen.getByTestId("player-20")).toBeInTheDocument();
    });
  });

  it("preserves localStorage when playerIds is null", async () => {
    renderWithProviders(qc);

    await waitFor(() => {
      expect(screen.getByTestId("player-10")).toBeInTheDocument();
    });

    const stored = JSON.parse(localStorage.getItem(LOCAL_FOLLOWS_KEY) ?? "[]");
    expect(stored).toContain(10);
    expect(stored).toContain(20);
  });
});

// ---------------------------------------------------------------------------
// Malformed response — playerIds is a non-array value
// ---------------------------------------------------------------------------

describe("MyPlayersContext — malformed follows response (playerIds: string)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    seedLocalStorage([99]);
    stubFetch200({ playerIds: "not-an-array" });
  });

  it("does not overwrite optimisticIds when playerIds is a non-array", async () => {
    renderWithProviders(qc);

    await waitFor(() => {
      expect(screen.getByTestId("player-99")).toBeInTheDocument();
    });
  });

  it("preserves localStorage when playerIds is a non-array", async () => {
    renderWithProviders(qc);

    await waitFor(() => {
      expect(screen.getByTestId("player-99")).toBeInTheDocument();
    });

    const stored = JSON.parse(localStorage.getItem(LOCAL_FOLLOWS_KEY) ?? "[]");
    expect(stored).toContain(99);
  });
});

// ---------------------------------------------------------------------------
// Happy path — well-formed response still syncs correctly
// ---------------------------------------------------------------------------

describe("MyPlayersContext — well-formed follows response (regression guard)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // Seed localStorage with an ID that the server doesn't know about
    seedLocalStorage([5]);
    // Server returns two different IDs
    stubFetch200({ playerIds: [7, 8] });
  });

  it("syncs optimisticIds from a valid response", async () => {
    renderWithProviders(qc);

    await waitFor(() => {
      expect(screen.getByTestId("player-7")).toBeInTheDocument();
      expect(screen.getByTestId("player-8")).toBeInTheDocument();
    });

    // The old local-only ID should no longer be present after the sync
    expect(screen.queryByTestId("player-5")).not.toBeInTheDocument();
  });

  it("updates localStorage from a valid response", async () => {
    renderWithProviders(qc);

    await waitFor(() => {
      expect(screen.getByTestId("player-7")).toBeInTheDocument();
    });

    const stored = JSON.parse(localStorage.getItem(LOCAL_FOLLOWS_KEY) ?? "[]");
    expect(stored).toContain(7);
    expect(stored).toContain(8);
  });
});
