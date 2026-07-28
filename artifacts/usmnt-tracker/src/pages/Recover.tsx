/**
 * /recover page — consumes a recovery token from the URL and restores the
 * user's watchlist on this device.
 *
 * URL shape produced by the backend:  /recover?token=<uuid>
 *
 * Flow:
 *  1. Read `?token=` from the query string.
 *  2. POST /api/follows/recover with { token }.
 *  3. On success the server returns a fresh auth token for the same account —
 *     store it in localStorage so MyPlayersContext picks it up immediately.
 *  4. Redirect to home; the watchlist is now active on this device.
 */

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const ANON_TOKEN_KEY = "usmnt_anon_token";

type Status = "loading" | "success" | "error";

export default function Recover() {
  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (!token) {
      setErrorMessage("No recovery token found in the URL.");
      setStatus("error");
      return;
    }

    fetch(`${API_BASE}/api/follows/recover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<{ token: string }>;
      })
      .then(({ token: newToken }) => {
        localStorage.setItem(ANON_TOKEN_KEY, newToken);
        setStatus("success");
        // Full page reload (not router navigate) so MyPlayersProvider re-mounts
        // cleanly from localStorage — this avoids any race with a concurrent
        // auto-provisioning request that may have started before recovery wrote
        // the token.
        setTimeout(() => {
          window.location.href = `${window.location.origin}${API_BASE}/`;
        }, 1500);
      })
      .catch((err: unknown) => {
        const msg =
          err instanceof Error ? err.message : "An unexpected error occurred.";
        setErrorMessage(msg);
        setStatus("error");
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 text-center shadow-sm space-y-5">
        {status === "loading" && (
          <>
            <Loader2 size={40} className="mx-auto animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Restoring your watchlist…
            </p>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle2 size={40} className="mx-auto text-green-500" />
            <div className="space-y-1">
              <p className="font-semibold text-foreground">Watchlist restored!</p>
              <p className="text-sm text-muted-foreground">
                Redirecting you to the app…
              </p>
            </div>
          </>
        )}

        {status === "error" && (
          <>
            <XCircle size={40} className="mx-auto text-destructive" />
            <div className="space-y-2">
              <p className="font-semibold text-foreground">Couldn't restore your watchlist</p>
              <p className="text-sm text-muted-foreground">{errorMessage}</p>
              <p className="text-xs text-muted-foreground">
                Transfer links can only be used once and expire after 30 days.
                Generate a new one from the Sync My Players menu.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                window.location.href = `${window.location.origin}${API_BASE}/`;
              }}
            >
              Go to home
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
