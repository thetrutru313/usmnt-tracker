/**
 * Admin: senior USMNT call-ups. When US Soccer announces a roster, pick the
 * window's matches and the players (or paste the announcement). Called-up
 * players get those matches on their profile and the match-day alerts.
 * After each match, the real matchday squad replaces the call-ups.
 */
import * as React from "react";
import { Users } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SessionExpiredError, apiFetch } from "@/lib/adminSession";
import { formatDate, formatKickoff } from "@/lib/formatTime";

const INPUT_CLASS =
  "w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";

interface CallupFixture {
  id: number;
  kickoff: string;
  kickoffTimeTbd: boolean;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  playerIds: number[];
}

interface CallupPlayer {
  id: number;
  name: string;
  position: string;
  clubName: string | null;
}

const QUERY_KEY = ["admin-callups"];

function normalize(name: string): string {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Match a pasted roster ("DEFENDERS (8): Chris Richards (Crystal Palace; ENG), …")
 * to tracked players: exact name first, then a unique surname with the same
 * first initial.
 */
export function matchRoster(text: string, players: CallupPlayer[]): { matched: number[]; unmatched: string[] } {
  const byName = new Map(players.map((p) => [normalize(p.name), p.id]));
  const matched = new Set<number>();
  const unmatched: string[] = [];
  const tokens = text
    .replace(/\([^)]*\)/g, " ")
    .split(/[,;\n]/)
    .map((t) => t.split(":").pop()!.trim())
    .filter((t) => normalize(t).includes(" "));
  for (const token of tokens) {
    const n = normalize(token);
    let id = byName.get(n);
    if (id === undefined) {
      const words = n.split(" ");
      const last = words[words.length - 1];
      const first = words[0]![0];
      const candidates = players.filter((p) => {
        const pw = normalize(p.name).split(" ");
        return pw[pw.length - 1] === last && pw[0]![0] === first;
      });
      if (candidates.length === 1) id = candidates[0]!.id;
    }
    if (id === undefined) unmatched.push(token);
    else matched.add(id);
  }
  return { matched: [...matched], unmatched };
}

export function CallupsSection({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const queryClient = useQueryClient();
  const [fixtureIds, setFixtureIds] = React.useState<number[]>([]);
  const [playerIds, setPlayerIds] = React.useState<Set<number>>(new Set());
  const [search, setSearch] = React.useState("");
  const [paste, setPaste] = React.useState("");
  const [message, setMessage] = React.useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => (await apiFetch("/admin/callups", token)) as { fixtures?: CallupFixture[]; players?: CallupPlayer[] },
    retry: false,
  });
  const fixtures = data?.fixtures ?? [];
  const players = data?.players ?? [];
  const nameById = new Map(players.map((p) => [p.id, p.name]));

  function toggleFixture(id: number) {
    const next = fixtureIds.includes(id) ? fixtureIds.filter((f) => f !== id) : [...fixtureIds, id];
    setFixtureIds(next);
    // Start from the current call-ups of the picked matches.
    setPlayerIds(new Set(fixtures.filter((f) => next.includes(f.id)).flatMap((f) => f.playerIds)));
    setMessage(null);
  }

  function togglePlayer(id: number) {
    setPlayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applyPaste() {
    const { matched, unmatched } = matchRoster(paste, players);
    setPlayerIds((prev) => new Set([...prev, ...matched]));
    setMessage(
      `Matched ${matched.length} player${matched.length === 1 ? "" : "s"}.` +
        (unmatched.length ? ` Not tracked or not found: ${unmatched.join(", ")}.` : ""),
    );
  }

  const save = useMutation({
    mutationFn: async () =>
      (await apiFetch("/admin/callups", token, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixtureIds: [...fixtureIds].sort((a, b) => a - b), playerIds: [...playerIds].sort((a, b) => a - b) }),
      })) as { added: number; removed: number },
    onSuccess: () => {
      setMessage(`Saved ${playerIds.size} player${playerIds.size === 1 ? "" : "s"} for ${fixtureIds.length} match${fixtureIds.length === 1 ? "" : "es"}.`);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (err) => {
      if (err instanceof SessionExpiredError) onUnauthorized();
      else setMessage(err instanceof Error ? err.message : "Saving failed.");
    },
  });

  const query = search.trim().toLowerCase();
  const shown = players.filter((p) => !query || p.name.toLowerCase().includes(query));

  return (
    <section className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <Users size={16} className="text-muted-foreground" />
          <h2 className="text-xl font-bold tracking-tight">USMNT call-ups</h2>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">
          When a roster is announced, pick the window's matches and the players. They'll see those matches on their
          profile and get the match-day alerts. After each match the real matchday squad replaces this list.
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground py-2 text-center">Loading…</p>}
      {!isLoading && fixtures.length === 0 && (
        <p className="text-sm text-muted-foreground">No upcoming senior USMNT matches.</p>
      )}

      {fixtures.length > 0 && (
        <div className="rounded-xl border border-border bg-card divide-y divide-border/50">
          {fixtures.map((f) => (
            <label key={f.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer">
              <input type="checkbox" checked={fixtureIds.includes(f.id)} onChange={() => toggleFixture(f.id)} />
              <span className="flex-1 min-w-0">
                <span className="font-medium">{f.homeTeam} vs {f.awayTeam}</span>
                <span className="block text-xs text-muted-foreground">
                  {f.kickoffTimeTbd ? `${formatDate(f.kickoff)} · Time TBD` : formatKickoff(f.kickoff)} · {f.competition}
                </span>
              </span>
              <span className="text-xs text-muted-foreground shrink-0">{f.playerIds.length} called up</span>
            </label>
          ))}
        </div>
      )}

      {fixtureIds.length > 0 && (
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Paste the roster announcement (optional)</span>
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={4}
              placeholder="DEFENDERS (8): Chris Richards (Crystal Palace; ENG), …"
              className={INPUT_CLASS}
            />
          </label>
          <button
            type="button"
            disabled={!paste.trim()}
            onClick={applyPaste}
            className="px-3 py-1.5 rounded-lg bg-muted text-sm font-medium disabled:opacity-50"
          >
            Match names
          </button>

          <div className="text-sm">
            <span className="font-semibold">{playerIds.size} selected</span>
            {playerIds.size > 0 && (
              <span className="text-muted-foreground">: {[...playerIds].map((id) => nameById.get(id) ?? `#${id}`).join(", ")}</span>
            )}
          </div>

          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search players…" className={INPUT_CLASS} />
          <div className="rounded-xl border border-border bg-card max-h-72 overflow-y-auto divide-y divide-border/50">
            {shown.map((p) => (
              <label key={p.id} className="flex items-center gap-3 px-3 py-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={playerIds.has(p.id)} onChange={() => togglePlayer(p.id)} aria-label={p.name} />
                <span className="flex-1 min-w-0 truncate">{p.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">{p.position} · {p.clubName ?? "—"}</span>
              </label>
            ))}
          </div>

          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate()}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : `Save roster for ${fixtureIds.length} match${fixtureIds.length === 1 ? "" : "es"}`}
          </button>
        </div>
      )}

      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </section>
  );
}
