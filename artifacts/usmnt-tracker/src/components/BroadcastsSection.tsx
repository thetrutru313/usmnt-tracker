/**
 * Admin: where to watch. Per-match TV / streaming / link for the next three
 * weeks (a match set here is never overwritten by the syncs), and each
 * competition's usual US broadcaster, which new matches get automatically.
 */
import * as React from "react";
import { Pencil, Trash2, Tv } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SessionExpiredError, apiFetch } from "@/lib/adminSession";
import { formatDate, formatKickoff } from "@/lib/formatTime";
import { displayTeamName } from "@/lib/teamNames";

const INPUT_CLASS =
  "w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";
const SMALL_BUTTON = "px-2.5 py-1 rounded text-xs font-semibold disabled:opacity-50";

interface BroadcastFixture {
  id: number;
  kickoff: string;
  kickoffTimeTbd: boolean;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  isNationalTeam: boolean;
  tvNetwork: string | null;
  streamingService: string | null;
  broadcastLink: string | null;
  broadcastSetByAdmin: boolean;
}

interface LeagueBroadcast {
  league: string;
  tvNetwork: string | null;
  streamingService: string | null;
}

interface BroadcastData {
  leagues: LeagueBroadcast[];
  fixtures: BroadcastFixture[];
  unmappedCompetitions: string[];
}

const QUERY_KEY = ["admin-broadcasts"];

function hasBroadcast(f: { tvNetwork: string | null; streamingService: string | null; broadcastLink?: string | null }) {
  return Boolean(f.tvNetwork || f.streamingService || f.broadcastLink);
}

function broadcastSummary(f: { tvNetwork: string | null; streamingService: string | null }) {
  return [f.tvNetwork, f.streamingService].filter(Boolean).join(" · ") || "—";
}

function useAdminWrite(token: string, onUnauthorized: () => void, setMessage: (m: string | null) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ path, method, body }: { path: string; method: "PUT" | "DELETE"; body?: unknown }) =>
      apiFetch(path, token, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (err) => {
      if (err instanceof SessionExpiredError) onUnauthorized();
      else setMessage(err instanceof Error ? err.message : "Saving failed.");
    },
  });
}

function MatchRow({
  fixture,
  editing,
  onEdit,
  onDone,
  write,
}: {
  fixture: BroadcastFixture;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  write: ReturnType<typeof useAdminWrite>;
}) {
  const [tv, setTv] = React.useState(fixture.tvNetwork ?? "");
  const [streaming, setStreaming] = React.useState(fixture.streamingService ?? "");
  const [link, setLink] = React.useState(fixture.broadcastLink ?? "");
  const title = `${displayTeamName(fixture.homeTeam)} vs ${displayTeamName(fixture.awayTeam)}`;
  const when = fixture.kickoffTimeTbd ? `${formatDate(fixture.kickoff)} · Time TBD` : formatKickoff(fixture.kickoff);

  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${hasBroadcast(fixture) ? "border-border bg-card" : "border-amber-500/40 bg-amber-500/5"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 basis-48">
          <span className="font-medium block truncate">{title}</span>
          <span className="text-xs text-muted-foreground">
            {when} · {fixture.competition}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-xs">
          {hasBroadcast(fixture) ? (
            <span>{broadcastSummary(fixture)}{fixture.broadcastLink ? " · link" : ""}</span>
          ) : (
            <span className="text-amber-500">No broadcast info</span>
          )}
          {fixture.broadcastSetByAdmin && (
            <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">set by you</span>
          )}
          {!editing && (
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Edit broadcast for ${title}`}
              className="p-1.5 rounded-md hover:bg-sidebar-accent text-muted-foreground hover:text-foreground"
            >
              <Pencil size={13} />
            </button>
          )}
        </div>
      </div>
      {editing && (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <label className="space-y-1">
            <span className="block text-xs font-medium text-muted-foreground">TV channel</span>
            <input value={tv} onChange={(e) => setTv(e.target.value)} maxLength={80} placeholder="FS1" className={INPUT_CLASS} />
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-medium text-muted-foreground">Streaming</span>
            <input value={streaming} onChange={(e) => setStreaming(e.target.value)} maxLength={80} placeholder="Fox One" className={INPUT_CLASS} />
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-medium text-muted-foreground">Watch link (optional)</span>
            <input value={link} onChange={(e) => setLink(e.target.value)} maxLength={300} placeholder="https://…" className={INPUT_CLASS} />
          </label>
          <div className="sm:col-span-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={write.isPending}
              onClick={() =>
                write.mutate(
                  {
                    path: `/admin/broadcasts/fixtures/${fixture.id}`,
                    method: "PUT",
                    body: { tvNetwork: tv, streamingService: streaming, broadcastLink: link },
                  },
                  { onSuccess: onDone },
                )
              }
              className={`${SMALL_BUTTON} bg-primary text-primary-foreground`}
            >
              Save
            </button>
            {fixture.broadcastSetByAdmin && (
              <button
                type="button"
                disabled={write.isPending}
                onClick={() =>
                  write.mutate({ path: `/admin/broadcasts/fixtures/${fixture.id}`, method: "DELETE" }, { onSuccess: onDone })
                }
                className={`${SMALL_BUTTON} bg-muted text-foreground`}
              >
                Use league default
              </button>
            )}
            <button type="button" onClick={onDone} className={`${SMALL_BUTTON} text-muted-foreground`}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LeagueRow({ row, write }: { row: LeagueBroadcast; write: ReturnType<typeof useAdminWrite> }) {
  const [editing, setEditing] = React.useState(false);
  const [tv, setTv] = React.useState(row.tvNetwork ?? "");
  const [streaming, setStreaming] = React.useState(row.streamingService ?? "");

  if (!editing) {
    return (
      <div className="flex items-center gap-3 px-3 py-1.5 text-sm border-b border-border/50 last:border-0">
        <span className="font-medium flex-1 min-w-0 truncate">{row.league}</span>
        <span className="text-xs text-muted-foreground text-right">{broadcastSummary(row)}</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${row.league}`}
          className="p-1.5 rounded-md hover:bg-sidebar-accent text-muted-foreground hover:text-foreground"
        >
          <Pencil size={13} />
        </button>
      </div>
    );
  }
  return (
    <div className="px-3 py-2 space-y-2 border-b border-border/50 last:border-0">
      <span className="font-medium text-sm">{row.league}</span>
      <div className="grid gap-2 sm:grid-cols-2">
        <input aria-label={`${row.league} TV channel`} value={tv} onChange={(e) => setTv(e.target.value)} maxLength={80} placeholder="TV channel" className={INPUT_CLASS} />
        <input aria-label={`${row.league} streaming`} value={streaming} onChange={(e) => setStreaming(e.target.value)} maxLength={80} placeholder="Streaming" className={INPUT_CLASS} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={write.isPending}
          onClick={() =>
            write.mutate(
              { path: "/admin/broadcasts/leagues", method: "PUT", body: { league: row.league, tvNetwork: tv, streamingService: streaming } },
              { onSuccess: () => setEditing(false) },
            )
          }
          className={`${SMALL_BUTTON} bg-primary text-primary-foreground`}
        >
          Save
        </button>
        <button
          type="button"
          disabled={write.isPending}
          onClick={() =>
            write.mutate({ path: `/admin/broadcasts/leagues?league=${encodeURIComponent(row.league)}`, method: "DELETE" })
          }
          className={`${SMALL_BUTTON} inline-flex items-center gap-1 bg-destructive/10 text-destructive`}
        >
          <Trash2 size={12} /> Remove
        </button>
        <button type="button" onClick={() => setEditing(false)} className={`${SMALL_BUTTON} text-muted-foreground`}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function BroadcastsSection({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [onlyMissing, setOnlyMissing] = React.useState(true);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [newLeague, setNewLeague] = React.useState({ league: "", tvNetwork: "", streamingService: "" });
  const write = useAdminWrite(token, onUnauthorized, setMessage);

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => (await apiFetch("/admin/broadcasts", token)) as BroadcastData,
    retry: false,
  });
  const fixtures = data?.fixtures ?? [];
  const missing = fixtures.filter((f) => !hasBroadcast(f)).length;
  const visible = onlyMissing ? fixtures.filter((f) => !hasBroadcast(f) || f.id === editingId) : fixtures;

  return (
    <section className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <Tv size={16} className="text-muted-foreground" />
          <h2 className="text-xl font-bold tracking-tight">Where to watch</h2>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">
          Set TV and streaming for a single match (kept even when the syncs run), or change a competition's usual
          broadcaster for all its upcoming club matches.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-sm">Next 3 weeks — {missing} without broadcast info</h3>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
            Only missing
          </label>
        </div>
        {isLoading && <p className="text-sm text-muted-foreground py-2 text-center">Loading…</p>}
        {!isLoading && visible.length === 0 && (
          <p className="text-sm text-muted-foreground py-2">
            {onlyMissing ? "Every upcoming match has broadcast info." : "No upcoming matches in the next 3 weeks."}
          </p>
        )}
        <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
          {visible.map((f) => (
            <MatchRow
              key={`${f.id}-${f.tvNetwork}-${f.streamingService}-${f.broadcastLink}`}
              fixture={f}
              editing={editingId === f.id}
              onEdit={() => { setEditingId(f.id); setMessage(null); }}
              onDone={() => setEditingId(null)}
              write={write}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold text-sm">Competition defaults</h3>
        <div className="rounded-xl border border-border bg-card max-h-[50vh] overflow-y-auto">
          {(data?.leagues ?? []).map((row) => (
            <LeagueRow key={`${row.league}-${row.tvNetwork}-${row.streamingService}`} row={row} write={write} />
          ))}
        </div>
        <form
          className="rounded-xl border border-border bg-card p-3 grid gap-2 sm:grid-cols-4 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            write.mutate(
              { path: "/admin/broadcasts/leagues", method: "PUT", body: newLeague },
              { onSuccess: () => setNewLeague({ league: "", tvNetwork: "", streamingService: "" }) },
            );
          }}
        >
          <label className="space-y-1 sm:col-span-2">
            <span className="block text-xs font-medium text-muted-foreground">Add a competition (exact name)</span>
            <input
              list="unmapped-competitions"
              value={newLeague.league}
              onChange={(e) => setNewLeague({ ...newLeague, league: e.target.value })}
              placeholder="e.g. Eredivisie"
              className={INPUT_CLASS}
            />
            <datalist id="unmapped-competitions">
              {(data?.unmappedCompetitions ?? []).map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
          <input aria-label="New competition TV channel" value={newLeague.tvNetwork} onChange={(e) => setNewLeague({ ...newLeague, tvNetwork: e.target.value })} maxLength={80} placeholder="TV channel" className={INPUT_CLASS} />
          <input aria-label="New competition streaming" value={newLeague.streamingService} onChange={(e) => setNewLeague({ ...newLeague, streamingService: e.target.value })} maxLength={80} placeholder="Streaming" className={INPUT_CLASS} />
          <button
            type="submit"
            disabled={!newLeague.league.trim() || write.isPending}
            className="sm:col-span-4 justify-self-start px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            Add competition
          </button>
        </form>
        {data && data.unmappedCompetitions.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Upcoming matches in competitions with no default: {data.unmappedCompetitions.join(", ")}. For one-off
            matches like friendlies, set the match itself above rather than the whole competition.
          </p>
        )}
      </div>

      {message && <p role="status" className="text-sm text-destructive">{message}</p>}
    </section>
  );
}
