import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CallupsSection, matchRoster } from "@/components/CallupsSection";

const PLAYERS = [
  { id: 1, name: "Chris Richards", position: "DF", clubName: "Crystal Palace" },
  { id: 2, name: "Adri Mehmeti", position: "MF", clubName: "New York Red Bulls" },
  { id: 3, name: "Tyler Adams", position: "MF", clubName: "Bournemouth" },
  { id: 4, name: "Santiago Castañeda", position: "MF", clubName: "Test FC" },
];
const FIXTURES = [
  { id: 10, kickoff: "2026-11-15T00:00:00Z", kickoffTimeTbd: true, homeTeam: "Haiti", awayTeam: "USA", competition: "CONCACAF Nations League", playerIds: [1] },
  { id: 11, kickoff: "2026-11-18T00:00:00Z", kickoffTimeTbd: false, homeTeam: "USA", awayTeam: "Haiti", competition: "CONCACAF Nations League", playerIds: [1] },
];

function setup(data: unknown = { fixtures: FIXTURES, players: PLAYERS }) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (!init?.method || init.method === "GET") return new Response(JSON.stringify(data), { status: 200 });
    return new Response(JSON.stringify({ ok: true, added: 2, removed: 0 }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CallupsSection token="admin-token" onUnauthorized={() => {}} />
    </QueryClientProvider>,
  );
  const putBody = () => {
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    return put ? JSON.parse(put[1]!.body as string) : undefined;
  };
  return { putBody };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Admin — USMNT call-ups", () => {
  it("1: matches a pasted US Soccer roster to tracked players, accents and clubs included", () => {
    const text = "DEFENDERS (2): Chris Richards (Crystal Palace; ENG), Adri Mehmeti (New York Red Bulls)\n" +
      "MIDFIELDERS (2): Santiago Castaneda (Test FC; ESP), Jack Nobody (Nowhere FC)";
    expect(matchRoster(text, PLAYERS)).toEqual({ matched: [1, 2, 4], unmatched: ["Jack Nobody"] });
  });

  it("2: picking a window starts from its current call-ups; saving sends the window's matches and the roster", async () => {
    const { putBody } = setup();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Haiti vs USA/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /USA vs Haiti/ }));
    expect(screen.getByRole("checkbox", { name: "Chris Richards" })).toBeChecked();
    fireEvent.change(screen.getByPlaceholderText(/DEFENDERS/), { target: { value: "MIDFIELDERS: Adri Mehmeti (New York Red Bulls)" } });
    fireEvent.click(screen.getByRole("button", { name: "Match names" }));
    expect(screen.getByRole("checkbox", { name: "Adri Mehmeti" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save roster for 2 matches" }));
    await waitFor(() => expect(putBody()).toEqual({ fixtureIds: [10, 11], playerIds: [1, 2] }));
  });

  it("3: says when there are no upcoming senior matches", async () => {
    setup({});
    expect(await screen.findByText("No upcoming senior USMNT matches.")).toBeInTheDocument();
  });
});
