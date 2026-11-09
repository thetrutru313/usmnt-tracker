import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MarketValuesSection } from "@/components/MarketValuesSection";

const ROWS = [
  {
    id: 1, name: "Tyler Adams", position: "MF", clubName: "Bournemouth",
    marketValueEur: 25_000_000, marketValueUsd: 27_000_000, marketValueAsOf: "2026-08-01",
    transfermarktUrl: "https://www.transfermarkt.com/tyler-adams/profil/spieler/1", bio: "Midfielder.",
  },
  {
    id: 2, name: "New Prospect", position: "FW", clubName: "Test FC",
    marketValueEur: null, marketValueUsd: 1_000_000, marketValueAsOf: null,
    transfermarktUrl: null, bio: "",
  },
];

function setup() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/admin/market-values") && init?.method === "PUT") {
      const body = JSON.parse(init.body as string) as { players: unknown[] };
      return new Response(JSON.stringify({ updated: body.players.length, eurUsd: { rate: 1.08, date: "2026-11-06" } }), { status: 200 });
    }
    if (url.endsWith("/api/admin/market-values")) {
      return new Response(JSON.stringify({ eurUsd: { rate: 1.08, date: "2026-11-06" }, players: ROWS }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MarketValuesSection token="admin-token" onUnauthorized={() => {}} />
    </QueryClientProvider>,
  );
  const putBody = () => {
    const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
    return put ? JSON.parse((put[1] as RequestInit).body as string) : undefined;
  };
  return { fetchMock, putBody };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Admin — Market values & bios", () => {
  it("1: lists stored values and links to Transfermarkt (profile if saved, else a search)", async () => {
    setup();
    expect(await screen.findByLabelText("Tyler Adams value in € millions")).toHaveValue("25");
    expect(screen.getByLabelText("New Prospect value in € millions")).toHaveValue("");
    expect(screen.getByText("no value yet")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "TM ↗" });
    expect(links[0]).toHaveAttribute("href", "https://www.transfermarkt.com/tyler-adams/profil/spieler/1");
    expect(links[1]!.getAttribute("href")).toContain("schnellsuche?query=New%20Prospect");
  });

  it("2: saves only changed rows, with the as-of date; 'Same' re-dates an unchanged value", async () => {
    const { putBody } = setup();
    fireEvent.change(await screen.findByLabelText("New Prospect value in € millions"), { target: { value: "0,8" } });
    fireEvent.click(screen.getByRole("button", { name: "Same" }));
    fireEvent.change(screen.getByLabelText("Values as of"), { target: { value: "2026-11-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Save 2 changes" }));

    expect(await screen.findByText("Saved 2 players.")).toBeInTheDocument();
    expect(putBody()).toEqual({
      asOf: "2026-11-02",
      players: [{ id: 1, valueEurM: 25 }, { id: 2, valueEurM: 0.8 }],
    });
  });

  it("3: edits a player's link and bio without touching the value", async () => {
    const { putBody } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "New Prospect link and bio" }));
    fireEvent.change(screen.getByPlaceholderText(/transfermarkt\.com/), { target: { value: "https://www.transfermarkt.com/new-prospect/profil/spieler/2" } });
    fireEvent.change(screen.getByLabelText("Bio"), { target: { value: "Fast winger." } });
    fireEvent.click(screen.getByRole("button", { name: "Save 1 change" }));

    await waitFor(() => expect(putBody()).toBeDefined());
    expect(putBody().players).toEqual([
      { id: 2, transfermarktUrl: "https://www.transfermarkt.com/new-prospect/profil/spieler/2", bio: "Fast winger." },
    ]);
  });

  it("4: won't save a value that isn't € millions", async () => {
    setup();
    fireEvent.change(await screen.findByLabelText("New Prospect value in € millions"), { target: { value: "25000000" } });
    expect(screen.getByRole("button", { name: "Save 1 change" })).toBeDisabled();
    expect(screen.getByText(/between 0 and 500/)).toBeInTheDocument();
  });
});
