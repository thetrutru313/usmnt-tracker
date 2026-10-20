import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import Dashboard from "@/pages/Dashboard";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("6: the actual dashboard request includes the browser's zone", async () => {
  // Use a non-default zone and the real generated hook + HTTP serializer.
  const resolved = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...resolved.call(this), timeZone: "America/Denver" };
  });
  const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    todaysGames: [], upcomingGames: [], latestNews: [], injuries: [], transfers: [],
    topPerformers: [], trending: [], recentlyReturned: [],
  }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchSpy);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    render(<QueryClientProvider client={client}><Router><Dashboard /></Router></QueryClientProvider>);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const input = fetchSpy.mock.calls[0][0] as string;
    const url = new URL(input, "http://localhost");
    expect(url.pathname).toBe("/api/dashboard");
    expect(url.searchParams.get("tz")).toBe("America/Denver");
    expect(client.getQueryCache().getAll()[0]?.queryKey).toContainEqual({ tz: "America/Denver" });
  } finally {
    cleanup();
    client.clear();
  }
});
