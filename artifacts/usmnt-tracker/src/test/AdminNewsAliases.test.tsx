/**
 * Admin — "Also called in the news" (review D10): the other names RSS tagging
 * matches for a player, edited in Market values & bios.
 *
 * Change-verifying:
 * 1. Shows a player's saved news names and saves an edited list on its own.
 * 2. Won't save a news name under 5 characters.
 * Regression guard: a row with no newsAliases field (older API) still renders
 * and saves nothing for it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MarketValuesSection } from "@/components/MarketValuesSection";

const ROWS = [
  {
    id: 7, name: "Giovanni Reyna", position: "MF", clubName: "Gladbach",
    marketValueEur: 15_000_000, marketValueUsd: 16_000_000, marketValueAsOf: "2026-11-09",
    transfermarktUrl: null, bio: "", newsAliases: ["Gio Reyna"],
  },
  {
    id: 8, name: "Old Row", position: "DF", clubName: "Test FC",
    marketValueEur: null, marketValueUsd: null, marketValueAsOf: null,
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
  return { putBody };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Admin — news names", () => {
  it("1: shows saved news names and saves an edited list on its own", async () => {
    const { putBody } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Giovanni Reyna link and bio" }));
    const field = screen.getByLabelText("Also called in the news");
    expect(field).toHaveValue("Gio Reyna");
    fireEvent.change(field, { target: { value: "Gio Reyna,  Giovanni A. Reyna , Gio Reyna" } });
    fireEvent.click(screen.getByRole("button", { name: "Save 1 change" }));

    await waitFor(() => expect(putBody()).toBeDefined());
    expect(putBody().players).toEqual([{ id: 7, newsAliases: ["Gio Reyna", "Giovanni A. Reyna"] }]);
  });

  it("2: won't save a news name under 5 characters", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Giovanni Reyna link and bio" }));
    fireEvent.change(screen.getByLabelText("Also called in the news"), { target: { value: "Gio" } });
    expect(screen.getByRole("button", { name: "Save 1 change" })).toBeDisabled();
    expect(screen.getByText(/full names \(5\+ characters\)/)).toBeInTheDocument();
  });

  it("guard: a row without newsAliases renders empty and saves nothing for it", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Old Row link and bio" }));
    const field = screen.getByLabelText("Also called in the news");
    expect(field).toHaveValue("");
    fireEvent.change(field, { target: { value: "" } });
    expect(screen.getByRole("button", { name: /Save 0 changes/ })).toBeDisabled();
  });
});
