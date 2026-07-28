import { useContext } from "react";
import { MyPlayersContext } from "@/context/MyPlayersContext";

/**
 * Consume the shared My Players watchlist context.
 *
 * State lives in MyPlayersProvider (mounted once in App.tsx), so every
 * component that calls this hook reads and writes the same followedIds and
 * token — no divergent per-instance copies, no token provisioning races.
 */
export function useMyPlayers() {
  return useContext(MyPlayersContext);
}
