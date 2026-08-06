import * as React from "react";
import {
  Lock,
  Plus,
  Pencil,
  Trash2,
  FileUp,
  X,
  ShieldCheck,
  AlertTriangle,
  ClipboardList,
  SlidersHorizontal,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  STORAGE_KEY,
  STORAGE_TS_KEY,
  getSessionExpiryMs,
  saveSession,
  loadSession,
  clearSession,
  SessionExpiredError,
  API_BASE,
  apiFetch,
} from "../lib/adminSession";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InvoiceEntry {
  label: string;
  url: string;
}

interface TransparencyMonth {
  id: number;
  periodYear: number;
  periodMonth: number;
  expensesCents: number;
  donationsCents: number;
  goalFoundationCents: number;
  invoiceUrls: InvoiceEntry[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MonthFormState {
  periodYear: string;
  periodMonth: string;
  expensesCents: string;
  donationsCents: string;
  goalFoundationCents: string;
  notes: string;
  invoices: InvoiceEntry[];
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// STORAGE_KEY, STORAGE_TS_KEY, STORAGE_EXPIRY_KEY, DEFAULT_SESSION_EXPIRY_MS,
// getSessionExpiryMs, saveSession, loadSession, clearSession, SessionExpiredError,
// API_BASE, authHeaders, apiFetch — all imported from ../lib/adminSession above.

/** Show the expiry warning banner when this many milliseconds remain. */
const WARN_BEFORE_MS = 30 * 60 * 1000; // 30 minutes

// ─── Session expiry hook ───────────────────────────────────────────────────────

/**
 * Returns the number of minutes remaining in the current session, or null if
 * there is no active session. Recalculates every 60 seconds.
 */
function useSessionExpiry(): number | null {
  const [minutesLeft, setMinutesLeft] = React.useState<number | null>(null);

  React.useEffect(() => {
    function check() {
      const ts = localStorage.getItem(STORAGE_TS_KEY);
      if (!ts) { setMinutesLeft(null); return; }
      const remaining = getSessionExpiryMs() - (Date.now() - parseInt(ts, 10));
      setMinutesLeft(Math.max(0, Math.floor(remaining / 60_000)));
    }
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, []);

  return minutesLeft;
}

// ─── Re-auth modal ─────────────────────────────────────────────────────────────

function ReAuthModal({
  onSuccess,
  onCancel,
}: {
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await apiFetch("/admin/transparency/verify", password, { method: "POST" }) as { ok: boolean; token: string; sessionExpiryMs?: number };
      saveSession(res.token, res.sessionExpiryMs);
      onSuccess();
    } catch {
      setError("Incorrect password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-xl p-6 w-full max-w-sm space-y-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm">Re-authenticate</h2>
          <button
            onClick={onCancel}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          Enter your admin password to extend your session by 24 hours.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            autoFocus
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading || !password}
              className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {loading ? "Checking…" : "Extend Session"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-sidebar-accent transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function cents(val: string): number {
  return Math.round(parseFloat(val || "0") * 100);
}
function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

// ─── Login screen ─────────────────────────────────────────────────────────────

function LoginForm({ onSuccess }: { onSuccess: (token: string) => void }) {
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await apiFetch("/admin/transparency/verify", password, { method: "POST" }) as { ok: boolean; token: string; sessionExpiryMs?: number };
      saveSession(res.token, res.sessionExpiryMs);
      onSuccess(res.token);
    } catch {
      setError("Incorrect password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-2">
            <Lock size={22} className="text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Admin Panel</h1>
          <p className="text-sm text-muted-foreground">Enter your admin password to continue.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            autoFocus
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2.5 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? "Checking…" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Month form ───────────────────────────────────────────────────────────────

const emptyForm = (): MonthFormState => ({
  periodYear: String(new Date().getFullYear()),
  periodMonth: String(new Date().getMonth() + 1),
  expensesCents: "",
  donationsCents: "",
  goalFoundationCents: "",
  notes: "",
  invoices: [],
});

function fromMonth(m: TransparencyMonth): MonthFormState {
  return {
    periodYear: String(m.periodYear),
    periodMonth: String(m.periodMonth),
    expensesCents: dollars(m.expensesCents),
    donationsCents: dollars(m.donationsCents),
    goalFoundationCents: dollars(m.goalFoundationCents),
    notes: m.notes ?? "",
    invoices: m.invoiceUrls ?? [],
  };
}

interface MonthFormProps {
  initial: MonthFormState;
  token: string;
  onSave: (data: MonthFormState) => void;
  onCancel: () => void;
  onUnauthorized: () => void;
  isNew: boolean;
  isSaving: boolean;
}

function MonthForm({ initial, token, onSave, onCancel, onUnauthorized, isNew, isSaving }: MonthFormProps) {
  const [form, setForm] = React.useState<MonthFormState>(initial);
  const [addingInvoice, setAddingInvoice] = React.useState(false);
  const [pendingLabel, setPendingLabel] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState("");

  function set(key: keyof MonthFormState, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function removeInvoice(index: number) {
    setForm((f) => ({ ...f, invoices: f.invoices.filter((_, i) => i !== index) }));
  }

  function updateInvoiceLabel(index: number, label: string) {
    setForm((f) => ({
      ...f,
      invoices: f.invoices.map((inv, i) => (i === index ? { ...inv, label } : inv)),
    }));
  }

  async function handleAddInvoiceFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError("");
    try {
      const { uploadUrl, objectPath } = await apiFetch("/admin/transparency/upload-url", token, {
        method: "POST",
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      }) as { uploadUrl: string; objectPath: string };
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error("Upload to GCS failed");
      const label = pendingLabel.trim() || file.name;
      setForm((f) => ({ ...f, invoices: [...f.invoices, { label, url: objectPath }] }));
      setAddingInvoice(false);
      setPendingLabel("");
      e.target.value = "";
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        clearSession();
        onUnauthorized();
        return;
      }
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave(form);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-5 rounded-xl border border-primary/20 bg-primary/5">
      <h3 className="font-semibold text-sm">{isNew ? "Add Month" : "Edit Month"}</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Year</label>
          <input
            type="number"
            required
            min={2024}
            max={2035}
            value={form.periodYear}
            onChange={(e) => set("periodYear", e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Month</label>
          <select
            required
            value={form.periodMonth}
            onChange={(e) => set("periodMonth", e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {MONTH_NAMES.map((name, i) => (
              <option key={i + 1} value={i + 1}>{name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {(["expensesCents", "donationsCents", "goalFoundationCents"] as const).map((key) => {
          const labels = { expensesCents: "Expenses ($)", donationsCents: "Donations ($)", goalFoundationCents: "Goal Foundation ($)" };
          return (
            <div key={key} className="space-y-1">
              <label className="text-xs text-muted-foreground">{labels[key]}</label>
              <input
                type="number"
                min={0}
                step={0.01}
                placeholder="0.00"
                value={form[key] as string}
                onChange={(e) => set(key, e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          );
        })}
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Notes (optional)</label>
        <textarea
          rows={2}
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="Any context for this month..."
          className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
        />
      </div>
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">Invoices (optional)</label>
        {form.invoices.map((inv, i) => (
          <div key={i} className="flex items-center gap-2 p-2 rounded-lg border border-border bg-card/50">
            <input
              type="text"
              value={inv.label}
              onChange={(e) => updateInvoiceLabel(i, e.target.value)}
              className="flex-1 min-w-0 px-2 py-1 rounded border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
              placeholder="Label"
            />
            <a
              href={`${API_BASE}/api/transparency/invoice${inv.url.replace(/^\/objects/, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-xs text-primary hover:text-primary/80 transition-colors"
            >
              View ↗
            </a>
            <button
              type="button"
              onClick={() => removeInvoice(i)}
              className="shrink-0 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
              title="Remove"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        {addingInvoice ? (
          <div className="flex items-center gap-2 p-2 rounded-lg border border-primary/30 bg-primary/5">
            <input
              list="invoice-label-suggestions"
              type="text"
              value={pendingLabel}
              onChange={(e) => setPendingLabel(e.target.value)}
              placeholder="Label (e.g. API costs, Replit…)"
              className="flex-1 min-w-0 px-2 py-1 rounded border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
              autoFocus
            />
            <datalist id="invoice-label-suggestions">
              <option value="API costs" />
              <option value="Replit" />
              <option value="BMAC donations" />
              <option value="Goal Foundation" />
            </datalist>
            <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-medium cursor-pointer hover:bg-sidebar-accent transition-colors shrink-0 ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
              <FileUp size={12} />
              {uploading ? "Uploading…" : "Choose file"}
              <input type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={handleAddInvoiceFile} />
            </label>
            <button
              type="button"
              onClick={() => { setAddingInvoice(false); setPendingLabel(""); setUploadError(""); }}
              className="shrink-0 p-1 rounded hover:bg-sidebar-accent text-muted-foreground transition-colors"
              title="Cancel"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingInvoice(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors"
          >
            <Plus size={12} />
            Add invoice
          </button>
        )}
        {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={isSaving || uploading}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {isSaving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-sidebar-accent transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Eligibility config ───────────────────────────────────────────────────────

interface SignalConfigRow {
  signalType: string;
  label: string;
  defaultWeight: number;
  maxContribution: number;
  activeWeight: number;
  overriddenBy: string | null;
}

function EligibilityConfigSection({ token }: { token: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-eligibility-config"],
    queryFn: async () => {
      const res = await apiFetch("/admin/config", token) as { signals: SignalConfigRow[] };
      return res.signals;
    },
    retry: false,
  });

  return (
    <section className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={16} className="text-muted-foreground" />
          <h2 className="text-xl font-bold tracking-tight">Eligibility Config</h2>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">
          Active signal weights. Override via <code className="font-mono text-xs bg-muted px-1 rounded">ELIGIBILITY_WEIGHT_&lt;SIGNAL_TYPE&gt;</code> env vars; UI is read-only.
        </p>
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
      )}
      {error && (
        <p className="text-sm text-destructive py-2">Failed to load config.</p>
      )}

      {data && (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Signal</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">Default</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">Active</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">Max Cap</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Override</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr
                  key={row.signalType}
                  className={i % 2 === 0 ? "bg-card" : "bg-muted/20"}
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-sm leading-tight">{row.label}</p>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">{row.signalType}</p>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{row.defaultWeight}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span className={row.overriddenBy ? "text-amber-400 font-semibold" : "text-foreground"}>
                      {row.activeWeight}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{row.maxContribution}</td>
                  <td className="px-4 py-3">
                    {row.overriddenBy ? (
                      <code className="text-xs font-mono bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded">
                        {row.overriddenBy}
                      </code>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Club Override Section ────────────────────────────────────────────────────

interface PlayerWithClub {
  id: number;
  name: string;
  clubId: number | null;
  clubName: string | null;
  clubOverrideId: number | null;
  clubOverrideName: string | null;
  clubOverrideSetAt: string | null;
}

interface ClubOption {
  id: number;
  name: string;
}

function ClubOverrideSection({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [editingPlayerId, setEditingPlayerId] = React.useState<number | null>(null);
  const [selectedClubId, setSelectedClubId] = React.useState<string>("");

  const { data: playersData, isLoading: playersLoading } = useQuery({
    queryKey: ["admin-players-clubs"],
    queryFn: async () => {
      const res = await apiFetch("/admin/players", token) as { players: PlayerWithClub[] };
      return res.players;
    },
    retry: false,
  });

  const { data: clubsData } = useQuery({
    queryKey: ["admin-clubs-list"],
    queryFn: async () => {
      const res = await apiFetch("/admin/clubs", token) as { clubs: ClubOption[] };
      return res.clubs;
    },
    retry: false,
  });

  const overrideMutation = useMutation({
    mutationFn: async ({ playerId, clubId }: { playerId: number; clubId: number | null }) => {
      await apiFetch(`/admin/players/${playerId}/club`, token, {
        method: "PATCH",
        body: JSON.stringify({ clubId }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-players-clubs"] });
      setEditingPlayerId(null);
      setSelectedClubId("");
    },
    onError: (err) => {
      if (err instanceof SessionExpiredError) onUnauthorized();
    },
  });

  const players = playersData ?? [];
  const clubs = clubsData ?? [];

  const overriddenPlayers = players.filter((p) => p.clubOverrideId != null);
  const filteredPlayers = search.trim()
    ? players.filter((p) =>
        p.name.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : players;

  function startEdit(player: PlayerWithClub) {
    setEditingPlayerId(player.id);
    setSelectedClubId(player.clubOverrideId != null ? String(player.clubOverrideId) : "");
  }

  function cancelEdit() {
    setEditingPlayerId(null);
    setSelectedClubId("");
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Club Overrides</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manually pin a player's club when API data is lagging (e.g. after a fresh transfer). The override is preserved across syncs until cleared.
        </p>
      </div>

      {overriddenPlayers.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
          <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Active overrides</p>
          {overriddenPlayers.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">{p.name}</span>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="line-through">{p.clubName ?? "—"}</span>
                <span className="text-amber-400">→ {p.clubOverrideName ?? "Unknown"}</span>
                <button
                  onClick={() => overrideMutation.mutate({ playerId: p.id, clubId: null })}
                  disabled={overrideMutation.isPending}
                  className="px-2 py-0.5 rounded bg-destructive/10 text-destructive text-xs hover:bg-destructive/20 transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <input
          type="text"
          placeholder="Search player…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      {playersLoading && (
        <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
      )}

      {!playersLoading && filteredPlayers.length === 0 && (
        <p className="text-sm text-muted-foreground py-4 text-center">No players match.</p>
      )}

      <div className="space-y-1 max-h-96 overflow-y-auto pr-1">
        {filteredPlayers.map((player) => (
          <div
            key={player.id}
            className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border text-sm transition-colors ${
              player.clubOverrideId != null
                ? "border-amber-500/30 bg-amber-500/5"
                : "border-border bg-card"
            }`}
          >
            <div className="min-w-0 flex-1">
              <span className="font-medium truncate block">{player.name}</span>
              <span className="text-xs text-muted-foreground">
                {player.clubOverrideId != null ? (
                  <>
                    <span className="line-through">{player.clubName ?? "—"}</span>
                    {" → "}
                    <span className="text-amber-400 font-medium">{player.clubOverrideName ?? "?"}</span>
                    {" (overridden)"}
                  </>
                ) : (
                  player.clubName ?? "—"
                )}
              </span>
            </div>

            {editingPlayerId === player.id ? (
              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={selectedClubId}
                  onChange={(e) => setSelectedClubId(e.target.value)}
                  className="px-2 py-1 rounded border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 max-w-[180px]"
                  autoFocus
                >
                  <option value="">— select club —</option>
                  {clubs.map((c) => (
                    <option key={c.id} value={String(c.id)}>{c.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    const clubId = parseInt(selectedClubId, 10);
                    if (!Number.isFinite(clubId)) return;
                    overrideMutation.mutate({ playerId: player.id, clubId });
                  }}
                  disabled={!selectedClubId || overrideMutation.isPending}
                  className="px-2.5 py-1 rounded bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50 hover:bg-primary/90 transition-colors"
                >
                  Set
                </button>
                {player.clubOverrideId != null && (
                  <button
                    onClick={() => overrideMutation.mutate({ playerId: player.id, clubId: null })}
                    disabled={overrideMutation.isPending}
                    className="px-2.5 py-1 rounded bg-destructive/10 text-destructive text-xs font-semibold hover:bg-destructive/20 transition-colors"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={cancelEdit}
                  className="p-1 rounded hover:bg-sidebar-accent text-muted-foreground transition-colors"
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => startEdit(player)}
                className="shrink-0 p-1.5 rounded-md hover:bg-sidebar-accent text-muted-foreground hover:text-foreground transition-colors"
                title="Override club"
              >
                <Pencil size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Main admin panel ─────────────────────────────────────────────────────────

function AdminPanel({ token, onLogout }: { token: string; onLogout: () => void }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = React.useState(false);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = React.useState<number | null>(null);
  const [bannerDismissed, setBannerDismissed] = React.useState(false);
  const [showReAuth, setShowReAuth] = React.useState(false);

  const minutesLeft = useSessionExpiry();
  const warnThresholdMinutes = Math.ceil(WARN_BEFORE_MS / 60_000);
  const isExpiringSoon = minutesLeft !== null && minutesLeft <= warnThresholdMinutes;

  // Reset the dismissed flag whenever the session is extended (minutesLeft jumps back up).
  React.useEffect(() => {
    if (minutesLeft !== null && minutesLeft > warnThresholdMinutes) {
      setBannerDismissed(false);
    }
  // warnThresholdMinutes is a constant derived from module-level constants, safe to omit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minutesLeft]);

  /**
   * Shared 401 handler: clear the local session and return to the login screen.
   * Called whenever any authenticated request comes back with a 401 — meaning
   * the server-side password has changed and the stored token is no longer valid.
   */
  function handleUnauthorized() {
    clearSession();
    onLogout();
  }

  /**
   * Validate the stored token immediately on mount and on every tab-focus
   * event. Either path calls handleUnauthorized() on 401, ensuring that a
   * rotated ADMIN_PASSWORD is enforced regardless of how the admin reached
   * this panel (fresh page load, browser refresh, or returning to the tab).
   */
  React.useEffect(() => {
    async function validate() {
      try {
        await apiFetch("/admin/session", token);
      } catch (err) {
        if (err instanceof SessionExpiredError) {
          handleUnauthorized();
        }
        // Any other error (network offline, server down) — leave the session
        // intact so the admin isn't unexpectedly logged out by a blip.
      }
    }

    // Run once on mount to catch a stale token from a previous session.
    void validate();

    // Re-run whenever the user switches back to this tab.
    function onVisibilityChange() {
      if (document.visibilityState === "visible") void validate();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const { data: reviewData } = useQuery({
    queryKey: ["admin-review-queue-count"],
    queryFn: async () => {
      const res = await apiFetch("/admin/review-queue", token) as { candidates: { id: number }[] };
      return res.candidates.length;
    },
    retry: false,
  });

  const pendingCount = reviewData ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-transparency"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/transparency`);
      const json = await res.json() as { months: TransparencyMonth[] };
      return json.months;
    },
  });

  const months = data ?? [];

  const saveMutation = useMutation({
    mutationFn: async ({ id, form }: { id: number | null; form: MonthFormState }) => {
      const body = {
        periodYear: parseInt(form.periodYear),
        periodMonth: parseInt(form.periodMonth),
        expensesCents: cents(form.expensesCents),
        donationsCents: cents(form.donationsCents),
        goalFoundationCents: cents(form.goalFoundationCents),
        notes: form.notes || null,
        invoiceUrls: form.invoices,
      };
      if (id === null) {
        await apiFetch("/admin/transparency", token, { method: "POST", body: JSON.stringify(body) });
      } else {
        await apiFetch(`/admin/transparency/${id}`, token, { method: "PUT", body: JSON.stringify(body) });
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-transparency"] });
      void queryClient.invalidateQueries({ queryKey: ["transparency"] });
      setShowForm(false);
      setEditingId(null);
    },
    onError: (err) => {
      if (err instanceof SessionExpiredError) handleUnauthorized();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiFetch(`/admin/transparency/${id}`, token, { method: "DELETE" });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-transparency"] });
      void queryClient.invalidateQueries({ queryKey: ["transparency"] });
      setDeleteConfirmId(null);
    },
    onError: (err) => {
      if (err instanceof SessionExpiredError) handleUnauthorized();
    },
  });

  const monthsDesc = [...months].reverse();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Re-auth modal */}
      {showReAuth && (
        <ReAuthModal
          onSuccess={() => {
            setShowReAuth(false);
            setBannerDismissed(false); // banner will hide naturally since minutesLeft resets
          }}
          onCancel={() => setShowReAuth(false)}
        />
      )}

      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="h-14 flex items-center px-6">
          <div className="flex items-center gap-2 text-primary font-bold text-sm uppercase tracking-wider">
            <ShieldCheck size={16} />
            Admin Panel
          </div>
          <div className="ml-auto flex items-center gap-3">
            <a href="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors">← Back to app</a>
            <button
              onClick={() => {
                void (async () => {
                  try {
                    await apiFetch("/admin/logout", token, { method: "POST" });
                  } catch {
                    // Server-side revocation is best-effort — always clear local state.
                  }
                  clearSession();
                  onLogout();
                })();
              }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Session expiry warning banner */}
        {isExpiringSoon && !bannerDismissed && (
          <div className="flex items-center gap-3 px-6 py-2.5 bg-amber-500/10 border-t border-amber-500/20 text-amber-500 text-xs">
            <AlertTriangle size={14} className="shrink-0" />
            <span className="flex-1">
              Your session expires in{" "}
              <span className="font-semibold">
                {minutesLeft === 0 ? "less than a minute" : `${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}`}
              </span>
              . Re-authenticate to avoid losing unsaved work.
            </span>
            <button
              onClick={() => setShowReAuth(true)}
              className="shrink-0 px-3 py-1 rounded-md bg-amber-500 text-white font-semibold hover:bg-amber-400 transition-colors"
            >
              Extend session
            </button>
            <button
              onClick={() => setBannerDismissed(true)}
              className="shrink-0 p-1 rounded-md text-amber-500 hover:text-amber-400 transition-colors"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </header>

      <div className="max-w-4xl mx-auto p-6 space-y-8">
        {/* Quick navigation */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Quick Links</h2>
          <a
            href="/admin/review"
            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 hover:bg-sidebar-accent transition-colors group"
          >
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary shrink-0">
                <ClipboardList size={18} />
              </div>
              <div>
                <p className="font-semibold text-sm">Review Queue</p>
                <p className="text-xs text-muted-foreground">Approve or reject discovered prospects</p>
              </div>
            </div>
            {pendingCount !== null && pendingCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-2 rounded-full bg-primary text-primary-foreground text-xs font-bold tabular-nums shrink-0">
                {pendingCount}
              </span>
            )}
          </a>
        </section>

        {/* Eligibility config */}
        <EligibilityConfigSection token={token} />

        {/* Club overrides */}
        <ClubOverrideSection token={token} onUnauthorized={handleUnauthorized} />

        {/* Transparency section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold tracking-tight">Monthly Transparency</h2>
              <p className="text-sm text-muted-foreground mt-0.5">Log operating expenses, donations, and Goal Foundation contributions.</p>
            </div>
            {!showForm && (
              <button
                onClick={() => { setShowForm(true); setEditingId(null); }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors"
              >
                <Plus size={15} />
                Add Month
              </button>
            )}
          </div>

          {/* Add form */}
          {showForm && editingId === null && (
            <MonthForm
              initial={emptyForm()}
              token={token}
              isNew
              isSaving={saveMutation.isPending}
              onCancel={() => setShowForm(false)}
              onSave={(form) => saveMutation.mutate({ id: null, form })}
              onUnauthorized={handleUnauthorized}
            />
          )}

          {saveMutation.isError && (
            <p className="text-sm text-destructive">{saveMutation.error.message}</p>
          )}

          {/* Records table */}
          {isLoading && (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
          )}
          {error && (
            <p className="text-sm text-destructive py-4">Failed to load records.</p>
          )}

          {!isLoading && months.length === 0 && !showForm && (
            <div className="rounded-xl border border-dashed border-border p-10 text-center space-y-2">
              <p className="text-sm text-muted-foreground">No records yet. Add your first month above.</p>
            </div>
          )}

          {monthsDesc.map((m) => (
            <div key={m.id}>
              {editingId === m.id ? (
                <MonthForm
                  initial={fromMonth(m)}
                  token={token}
                  isNew={false}
                  isSaving={saveMutation.isPending}
                  onCancel={() => setEditingId(null)}
                  onSave={(form) => saveMutation.mutate({ id: m.id, form })}
                  onUnauthorized={handleUnauthorized}
                />
              ) : (
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-sm">
                        {MONTH_NAMES[m.periodMonth - 1]} {m.periodYear}
                      </p>
                      <div className="flex flex-wrap gap-4 mt-2 text-xs text-muted-foreground">
                        <span>Expenses: <span className="text-foreground font-mono">${dollars(m.expensesCents)}</span></span>
                        <span>Donations: <span className="text-green-400 font-mono">${dollars(m.donationsCents)}</span></span>
                        <span>Goal Foundation: <span className="text-primary font-mono">${dollars(m.goalFoundationCents)}</span></span>
                        {m.invoiceUrls?.map((inv, i) => (
                          <a
                            key={i}
                            href={`${API_BASE}/api/transparency/invoice${inv.url.replace(/^\/objects/, "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary underline underline-offset-2 text-xs"
                          >
                            {inv.label} ↗
                          </a>
                        ))}
                      </div>
                      {m.notes && <p className="text-xs text-muted-foreground mt-1 italic">{m.notes}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => { setEditingId(m.id); setShowForm(false); }}
                        className="p-1.5 rounded-md hover:bg-sidebar-accent text-muted-foreground hover:text-foreground transition-colors"
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                      {deleteConfirmId === m.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => deleteMutation.mutate(m.id)}
                            disabled={deleteMutation.isPending}
                            className="px-2 py-1 rounded-md bg-destructive text-destructive-foreground text-xs font-medium"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            className="p-1.5 rounded-md hover:bg-sidebar-accent text-muted-foreground"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirmId(m.id)}
                          className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function Admin() {
  const [token, setToken] = React.useState<string | null>(loadSession);

  function handleLogout() {
    clearSession();
    setToken(null);
  }

  // Cross-tab logout: when another browser tab clears the token from
  // localStorage (e.g. by calling clearSession()), the browser fires a
  // StorageEvent on every OTHER tab sharing the same origin. We listen for
  // that event and mirror the logout here so no tab silently keeps an
  // invalidated session.
  React.useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY && e.newValue === null) {
        handleLogout();
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
   
  }, []);

  if (!token) {
    return <LoginForm onSuccess={setToken} />;
  }

  return <AdminPanel token={token} onLogout={handleLogout} />;
}
