import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { PlayerCard, type PlayerCardPlayer } from "@/components/PlayerCard";
import { MyPlayersContext, type MyPlayersContextValue } from "@/context/MyPlayersContext";

vi.mock("sonner", () => ({ toast: vi.fn() }));

const PLAYER: PlayerCardPlayer = {
  id: 7, name: "Alejandro Zendejas", position: "FW", clubName: "Club America",
  age: 28, nationalTeamCaps: 15, photoUrl: null, performanceTrend: "on_fire", poolTier: "inMix",
};

const ctx: MyPlayersContextValue = {
  followedIds: new Set(),
  isFollowing: () => false,
  toggle: async () => "added",
  generateTransferLink: async () => "",
};

function renderCard(player: PlayerCardPlayer) {
  const { hook } = memoryLocation({ path: "/players" });
  render(
    <MyPlayersContext.Provider value={ctx}>
      <Router hook={hook}>
        <PlayerCard player={player} />
      </Router>
    </MyPlayersContext.Provider>,
  );
}

describe("PlayerCard — market value line", () => {
  it("1: shows a dated value as euros (dollars) on its own line under the club", () => {
    renderCard({ ...PLAYER, marketValueEur: 8_000_000, marketValueUsd: 8_640_000, marketValueAsOf: "2026-11-01" });
    const line = screen.getByText(/€8\.0M \(\$8\.6M\)/);
    expect(line).toHaveAttribute("title", "Transfermarkt value, Nov 2026");
    // A separate line, not inside the position · club row that truncates.
    expect(line.closest(".truncate")).toBeNull();
    expect(screen.getByText("Club America").parentElement).not.toContainElement(line);
  });

  it("2: shows thousands under €1M, and euros alone until the dollar rate is in", () => {
    renderCard({ ...PLAYER, marketValueEur: 750_000, marketValueUsd: null, marketValueAsOf: "2026-11-01" });
    expect(screen.getByText("€750K")).toBeInTheDocument();
  });

  it("3: shows nothing for an undated (old seed) value or no value", () => {
    renderCard({ ...PLAYER, marketValueUsd: 9_000_000, marketValueEur: null, marketValueAsOf: null });
    expect(screen.queryByText(/\$9\.0M/)).not.toBeInTheDocument();
    expect(screen.queryByText(/€/)).not.toBeInTheDocument();
  });
});
