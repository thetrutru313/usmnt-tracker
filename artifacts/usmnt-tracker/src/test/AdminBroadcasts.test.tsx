import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BroadcastsSection } from "@/components/BroadcastsSection";

const DATA = {
  leagues: [{ league: "Premier League", tvNetwork: "NBC", streamingService: "Peacock" }],
  fixtures: [
    {
      id: 5, kickoff: "2026-11-15T13:00:00Z", kickoffTimeTbd: false, homeTeam: "Scotland U21", awayTeam: "USA U21",
      competition: "Friendlies", isNationalTeam: true, tvNetwork: null, streamingService: null,
      broadcastLink: null, broadcastSetByAdmin: false,
    },
    {
      id: 6, kickoff: "2026-11-16T15:00:00Z", kickoffTimeTbd: false, homeTeam: "Arsenal", awayTeam: "Fulham",
      competition: "Premier League", isNationalTeam: false, tvNetwork: "NBC", streamingService: "Peacock",
      broadcastLink: null, broadcastSetByAdmin: false,
    },
  ],
  unmappedCompetitions: ["Friendlies"],
};

function setup() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (!init?.method || init.method === "GET") return new Response(JSON.stringify(DATA), { status: 200 });
    return new Response(JSON.stringify({ ok: true, fixturesUpdated: 0 }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BroadcastsSection token="admin-token" onUnauthorized={() => {}} />
    </QueryClientProvider>,
  );
  const writes = () => fetchMock.mock.calls
    .filter(([, init]) => init?.method === "PUT" || init?.method === "DELETE")
    .map(([url, init]) => ({ url: String(url), method: init!.method, body: init!.body ? JSON.parse(init!.body as string) : undefined }));
  return { writes };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Admin — Where to watch", () => {
  it("1: lists matches without broadcast info first, under their app names", async () => {
    setup();
    expect(await screen.findByText("Scotland U21 vs USA Olympic Team")).toBeInTheDocument();
    expect(screen.getByText(/1 without broadcast info/)).toBeInTheDocument();
    expect(screen.queryByText("Arsenal vs Fulham")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Only missing"));
    expect(screen.getByText("Arsenal vs Fulham")).toBeInTheDocument();
  });

  it("2: sets one match's TV, streaming and link", async () => {
    const { writes } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Edit broadcast for Scotland U21 vs USA Olympic Team" }));
    fireEvent.change(screen.getByLabelText("Streaming"), { target: { value: "YouTube" } });
    fireEvent.change(screen.getByLabelText("Watch link (optional)"), { target: { value: "https://www.youtube.com/@ussoccer" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: "PUT",
      body: { tvNetwork: "", streamingService: "YouTube", broadcastLink: "https://www.youtube.com/@ussoccer" },
    });
    expect(writes()[0]!.url).toMatch(/\/api\/admin\/broadcasts\/fixtures\/5$/);
  });

  it("3: adds a competition default", async () => {
    const { writes } = setup();
    await screen.findByText("Premier League");
    fireEvent.change(screen.getByPlaceholderText("e.g. Eredivisie"), { target: { value: "Eredivisie" } });
    fireEvent.change(screen.getByLabelText("New competition streaming"), { target: { value: "ESPN+" } });
    fireEvent.click(screen.getByRole("button", { name: "Add competition" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: "PUT",
      body: { league: "Eredivisie", tvNetwork: "", streamingService: "ESPN+" },
    });
    expect(writes()[0]!.url).toMatch(/\/api\/admin\/broadcasts\/leagues$/);
  });
});
