/**
 * MyPlayersContext — single source of truth for the "My Players" watchlist.
 *
 * Mounts once in App.tsx. All components (PlayerCard, filter chips, sidebar
 * modal) read the same followedIds and write through the same toggle function,
 * so there is never divergent state across the tree.
 *
 * Token provisioning is single-flight: the first caller kicks off one
 * POST /api/follows/users; any concurrent mounts wait on that same promise
 * rather than racing to create duplicate tokens.
 */

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

// ─── localStorage keys ────────────────────────────────────────────────────────

const ANON_TOKEN_KEY   = "usmnt_anon_token";
const LOCAL_FOLLOWS_KEY = "usmnt_my_players";

// ─── API base ─────────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Single-flight token provisioning ────────────────────────────────────────
// One Promise shared across the module so concurrent mounts don't race.

let provisioningPromise: Promise<string> | null = null;

async function ensureToken(): Promise<string> {
  const existing = localStorage.getItem(ANON_TOKEN_KEY);
  if (existing) return existing;

  if (!provisioningPromise) {
    provisioningPromise = fetch(`${API_BASE}/api/follows/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ token: string }>;
      })
      .then(({ token }) => {
        // Re-check localStorage: a concurrent recovery flow may have written a
        // token while the provisioning request was in flight. If so, honour
        // that token and discard the freshly-provisioned one (it will be
        // cleaned up later as an orphan — no follows attached to it).
        const current = localStorage.getItem(ANON_TOKEN_KEY);
        if (current) return current;
        localStorage.setItem(ANON_TOKEN_KEY, token);
        return token;
      })
      .finally(() => {
        provisioningPromise = null;
      });
  }

  return provisioningPromise;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function callFollowsApi(
  path: string,
  token: string,
  method = "GET",
): Promise<unknown> {
  const res = await fetch(`${API_BASE}/api/follows${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

function getLocalFollows(): Set<number> {
  try {
    const raw = localStorage.getItem(LOCAL_FOLLOWS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as number[]);
  } catch {
    return new Set();
  }
}

function saveLocalFollows(ids: Set<number>): void {
  localStorage.setItem(LOCAL_FOLLOWS_KEY, JSON.stringify([...ids]));
}

// ─── Context shape ────────────────────────────────────────────────────────────

export interface MyPlayersContextValue {
  followedIds: Set<number>;
  isFollowing: (playerId: number) => boolean;
  toggle: (playerId: number) => Promise<"added" | "removed">;
  generateTransferLink: () => Promise<string>;
}

export const MyPlayersContext = React.createContext<MyPlayersContextValue>({
  followedIds: new Set(),
  isFollowing: () => false,
  toggle: async () => "added",
  generateTransferLink: async () => { throw new Error("No provider"); },
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function MyPlayersProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = React.useState<string | null>(
    () => localStorage.getItem(ANON_TOKEN_KEY),
  );
  const queryClient = useQueryClient();

  // Optimistic local state — initialised from localStorage so starred players
  // appear immediately without waiting for the API.
  const [optimisticIds, setOptimisticIds] = React.useState<Set<number>>(getLocalFollows);

  // Provision anon token once on first mount.
  // Skip on the /recover page: the recovery flow is about to write its own
  // token to localStorage, and starting provisioning concurrently risks
  // clobbering it.
  React.useEffect(() => {
    if (token) return;
    if (window.location.pathname.endsWith("/recover")) return;
    ensureToken()
      .then(setToken)
      .catch(() => {
        // Backend unavailable — operate from localStorage only.
      });
  }, [token]);

  // Fetch followed IDs from the API when a token exists.
  const { data: remoteFollows } = useQuery<number[]>({
    queryKey: ["follows", token],
    queryFn: async () => {
      if (!token) return [];
      const data = (await callFollowsApi("", token)) as { playerIds: number[] };
      return data.playerIds ?? [];
    },
    enabled: !!token,
    staleTime: 60_000,
  });

  // Sync local state from API (API is source of truth when available).
  React.useEffect(() => {
    if (!remoteFollows) return;
    const ids = new Set(remoteFollows);
    setOptimisticIds(ids);
    saveLocalFollows(ids);
  }, [remoteFollows]);

  const isFollowing = React.useCallback(
    (playerId: number) => optimisticIds.has(playerId),
    [optimisticIds],
  );

  const toggle = React.useCallback(
    async (playerId: number): Promise<"added" | "removed"> => {
      const wasFollowing = optimisticIds.has(playerId);
      const next = new Set(optimisticIds);
      wasFollowing ? next.delete(playerId) : next.add(playerId);

      // Optimistic update — all components re-render immediately via context.
      setOptimisticIds(next);
      saveLocalFollows(next);

      if (token) {
        try {
          await callFollowsApi(
            `/${playerId}`,
            token,
            wasFollowing ? "DELETE" : "POST",
          );
          void queryClient.invalidateQueries({ queryKey: ["follows", token] });
        } catch {
          // API unavailable — localStorage state already updated; that's the
          // intended offline fallback.
        }
      }

      return wasFollowing ? "removed" : "added";
    },
    [optimisticIds, token, queryClient],
  );

  const generateTransferLink = React.useCallback(async (): Promise<string> => {
    if (!token) throw new Error("No auth token — sign in to generate a link");
    const data = (await callFollowsApi("/recovery-token", token, "POST")) as {
      recoveryUrl: string;
    };
    // data.recoveryUrl is a server-relative path like "/recover?token=<uuid>".
    // Prepend the app origin and base so the link works on any deployment.
    return `${window.location.origin}${API_BASE}${data.recoveryUrl}`;
  }, [token]);

  const value = React.useMemo(
    () => ({ followedIds: optimisticIds, isFollowing, toggle, generateTransferLink }),
    [optimisticIds, isFollowing, toggle, generateTransferLink],
  );

  return (
    <MyPlayersContext.Provider value={value}>
      {children}
    </MyPlayersContext.Provider>
  );
}
