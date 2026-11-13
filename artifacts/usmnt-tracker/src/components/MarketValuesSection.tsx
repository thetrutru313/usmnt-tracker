/**
 * Admin: quarterly market values (from Transfermarkt, in € millions), player
 * bios and the other names the news uses for each player. The server stores
 * euros and converts to dollars at the daily ECB rate; see
 * artifacts/api-server/src/lib/marketValues.ts.
 */
import * as React from "react";
import { BadgeDollarSign, Pencil } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SessionExpiredError, apiFetch } from "@/lib/adminSession";
import { compactMoney, monthYear, transfermarktSearchUrl } from "@/lib/marketValue";

const INPUT_CLASS =
  "w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";

interface MarketValueRow {
  id: number;
  name: string;
  position: string;
  clubName: string | null;
  marketValueEur: number | null;
  marketValueUsd: number | null;
  marketValueAsOf: string | null;
  transfermarktUrl: string | null;
  bio: string;
  /** Other names the news uses ("Gio Reyna"); RSS tagging matches them too. */
  newsAliases?: string[];
}

interface EurUsd {
  rate: number;
  date: string;
}

/** Unsaved edits for one player, as typed. */
interface MarketValueDraft {
  valueEurM?: string;
  transfermarktUrl?: string;
  bio?: string;
  /** Comma-separated, as typed. */
  newsAliases?: string;
}

/** RSS tagging ignores news names shorter than this (see rssIngest.ts). */
const MIN_NEWS_NAME_LENGTH = 5;

/** "Gio Reyna, Giovanni A. Reyna" → ["Gio Reyna", "Giovanni A. Reyna"]. */
function parseNewsAliases(text: string): string[] {
  return [...new Set(text.split(",").map((n) => n.trim()).filter(Boolean))];
}

/** A value older than this (or missing) counts as due for this quarter's update. */
const VALUE_STALE_DAYS = 80;

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Stored euros → what the € millions box shows ("25", "0.8"). */
function eurMillions(eur: number | null): string {
  return eur == null ? "" : String(Number((eur / 1_000_000).toFixed(2)));
}

function isDue(row: MarketValueRow, today: string): boolean {
  if (!row.marketValueAsOf) return true;
  return Date.parse(`${today}T00:00:00Z`) - Date.parse(`${row.marketValueAsOf}T00:00:00Z`) > VALUE_STALE_DAYS * 86_400_000;
}

/** Only what changed, in the shape PUT /admin/market-values takes. */
function marketValueChanges(rows: MarketValueRow[], drafts: Record<number, MarketValueDraft>) {
  return rows.flatMap((row) => {
    const draft = drafts[row.id];
    if (!draft) return [];
    const change: { id: number; valueEurM?: number | null; transfermarktUrl?: string | null; bio?: string; newsAliases?: string[] } = { id: row.id };
    if (draft.valueEurM !== undefined) {
      const typed = draft.valueEurM.trim().replace(",", ".");
      // A typed value is saved even if unchanged: that re-dates it ("still €25m in November").
      if (typed === "") {
        if (row.marketValueEur != null) change.valueEurM = null;
      } else {
        change.valueEurM = Number(typed);
      }
    }
    if (draft.transfermarktUrl !== undefined && draft.transfermarktUrl.trim() !== (row.transfermarktUrl ?? "")) {
      change.transfermarktUrl = draft.transfermarktUrl.trim() || null;
    }
    if (draft.bio !== undefined && draft.bio.trim() !== row.bio.trim()) change.bio = draft.bio.trim();
    if (draft.newsAliases !== undefined) {
      const aliases = parseNewsAliases(draft.newsAliases);
      if (aliases.join("|") !== (row.newsAliases ?? []).join("|")) change.newsAliases = aliases;
    }
    return Object.keys(change).length > 1 ? [change] : [];
  });
}

/** Quarterly market values (from Transfermarkt, in €) and player bios. */
export function MarketValuesSection({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const queryClient = useQueryClient();
  const [asOf, setAsOf] = React.useState(todayIso);
  const [search, setSearch] = React.useState("");
  const [onlyDue, setOnlyDue] = React.useState(false);
  const [drafts, setDrafts] = React.useState<Record<number, MarketValueDraft>>({});
  const [openId, setOpenId] = React.useState<number | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-market-values"],
    queryFn: async () => (await apiFetch("/admin/market-values", token)) as { eurUsd: EurUsd | null; players: MarketValueRow[] },
    retry: false,
  });
  const rows = data?.players ?? [];
  const today = todayIso();
  const changes = marketValueChanges(rows, drafts);
  const invalidValue = changes.some((c) => typeof c.valueEurM === "number" && !(c.valueEurM > 0 && c.valueEurM <= 500));
  const invalidAliases = changes.some((c) => c.newsAliases?.some((n) => n.length < MIN_NEWS_NAME_LENGTH));
  const invalid = invalidValue || invalidAliases;
  const dueCount = rows.filter((r) => isDue(r, today)).length;

  const query = search.trim().toLowerCase();
  const visible = rows.filter(
    (r) => (!query || r.name.toLowerCase().includes(query)) && (!onlyDue || isDue(r, today) || drafts[r.id]),
  );

  function edit(id: number, patch: MarketValueDraft) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
    setMessage(null);
  }

  const save = useMutation({
    mutationFn: async () =>
      (await apiFetch("/admin/market-values", token, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asOf, players: changes }),
      })) as { updated: number; eurUsd: EurUsd | null },
    onSuccess: (r) => {
      setDrafts({});
      setOpenId(null);
      setMessage(
        `Saved ${r.updated} player${r.updated === 1 ? "" : "s"}.` +
          (r.eurUsd ? "" : " The exchange rate isn't available yet; dollar values will fill in automatically."),
      );
      void queryClient.invalidateQueries({ queryKey: ["admin-market-values"] });
    },
    onError: (err) => {
      if (err instanceof SessionExpiredError) onUnauthorized();
      else setMessage(err instanceof Error ? err.message : "Saving failed.");
    },
  });

  return (
    <section className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <BadgeDollarSign size={16} className="text-muted-foreground" />
          <h2 className="text-xl font-bold tracking-tight">Market values &amp; bios</h2>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">
          Enter each player's Transfermarkt value in € millions. Profiles show it in dollars at the daily ECB rate
          {data?.eurUsd ? ` (now €1 = $${data.eurUsd.rate.toFixed(4)}, ${data.eurUsd.date})` : ""}, with the date below.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-xs font-medium text-muted-foreground">Values as of</span>
          <input type="date" value={asOf} max={today} onChange={(e) => setAsOf(e.target.value)} className={INPUT_CLASS} />
        </label>
        <label className="space-y-1 flex-1 min-w-[10rem]">
          <span className="block text-xs font-medium text-muted-foreground">Search</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Player name…" className={INPUT_CLASS} />
        </label>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} />
          Only due ({dueCount})
        </label>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>}

      <div className="space-y-1 max-h-[70vh] overflow-y-auto pr-1">
        {visible.map((row) => {
          const draft = drafts[row.id] ?? {};
          const tmUrl = (draft.transfermarktUrl ?? row.transfermarktUrl ?? "").trim();
          const open = openId === row.id;
          return (
            <div key={row.id} className={`rounded-lg border px-3 py-2 text-sm ${drafts[row.id] ? "border-primary/50 bg-primary/5" : "border-border bg-card"}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1 basis-40">
                  <span className="font-medium block truncate">{row.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {row.clubName ?? "—"} · {row.position} ·{" "}
                    {row.marketValueAsOf && row.marketValueEur != null ? (
                      <span className={isDue(row, today) ? "text-amber-500" : ""}>
                        {compactMoney(row.marketValueEur, "€")}, {monthYear(row.marketValueAsOf)}
                      </span>
                    ) : (
                      <span className="text-amber-500">no value yet</span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-xs text-muted-foreground">€</span>
                  <input
                    aria-label={`${row.name} value in € millions`}
                    inputMode="decimal"
                    value={draft.valueEurM ?? eurMillions(row.marketValueEur)}
                    onChange={(e) => edit(row.id, { valueEurM: e.target.value })}
                    className="w-20 px-2 py-1 rounded border border-border bg-background text-sm text-right"
                  />
                  <span className="text-xs text-muted-foreground">M</span>
                  {row.marketValueEur != null && draft.valueEurM === undefined && (
                    <button
                      type="button"
                      onClick={() => edit(row.id, { valueEurM: eurMillions(row.marketValueEur) })}
                      className="px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
                      title="Value unchanged on Transfermarkt: re-date it"
                    >
                      Same
                    </button>
                  )}
                  <a
                    href={tmUrl || transfermarktSearchUrl(row.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
                    title={tmUrl ? "Open Transfermarkt profile" : "Search Transfermarkt"}
                  >
                    TM ↗
                  </a>
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : row.id)}
                    aria-expanded={open}
                    aria-label={`${row.name} link and bio`}
                    className="p-1.5 rounded-md hover:bg-sidebar-accent text-muted-foreground hover:text-foreground"
                  >
                    <Pencil size={13} />
                  </button>
                </div>
              </div>
              {open && (
                <div className="mt-3 space-y-2">
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">Transfermarkt profile link</span>
                    <input
                      value={draft.transfermarktUrl ?? row.transfermarktUrl ?? ""}
                      onChange={(e) => edit(row.id, { transfermarktUrl: e.target.value })}
                      placeholder="https://www.transfermarkt.com/…/profil/spieler/…"
                      className={INPUT_CLASS}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">Also called in the news</span>
                    <input
                      value={draft.newsAliases ?? (row.newsAliases ?? []).join(", ")}
                      onChange={(e) => edit(row.id, { newsAliases: e.target.value })}
                      placeholder="e.g. Gio Reyna (comma-separated full names)"
                      className={INPUT_CLASS}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">Bio</span>
                    <textarea
                      value={draft.bio ?? row.bio}
                      maxLength={2000}
                      rows={4}
                      onChange={(e) => edit(row.id, { bio: e.target.value })}
                      className={INPUT_CLASS}
                    />
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={changes.length === 0 || invalid || !asOf || save.isPending}
          onClick={() => save.mutate()}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : `Save ${changes.length} change${changes.length === 1 ? "" : "s"}`}
        </button>
        {changes.length > 0 && (
          <button type="button" onClick={() => { setDrafts({}); setMessage(null); }} className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground">
            Discard
          </button>
        )}
        {invalidValue && <span className="text-sm text-destructive">Values are € millions between 0 and 500.</span>}
        {invalidAliases && (
          <span className="text-sm text-destructive">News names must be full names ({MIN_NEWS_NAME_LENGTH}+ characters).</span>
        )}
        {message && <span role="status" className="text-sm text-muted-foreground">{message}</span>}
      </div>
    </section>
  );
}
