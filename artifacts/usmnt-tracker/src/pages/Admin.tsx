import * as React from "react";
import {
  Lock,
  Plus,
  Pencil,
  Trash2,
  FileUp,
  ChevronDown,
  ChevronUp,
  X,
  Check,
  ShieldCheck,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TransparencyMonth {
  id: number;
  periodYear: number;
  periodMonth: number;
  expensesCents: number;
  donationsCents: number;
  goalFoundationCents: number;
  invoiceUrl: string | null;
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
  invoiceFile: File | null;
  invoiceUrl: string | null;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const STORAGE_KEY = "usmnt_admin_token";
const STORAGE_TS_KEY = "usmnt_admin_token_ts";
/** How long a saved session stays valid. Adjust as needed. */
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Session helpers ───────────────────────────────────────────────────────────

function saveSession(token: string): void {
  localStorage.setItem(STORAGE_KEY, token);
  localStorage.setItem(STORAGE_TS_KEY, String(Date.now()));
}

function loadSession(): string | null {
  const token = localStorage.getItem(STORAGE_KEY);
  const ts = localStorage.getItem(STORAGE_TS_KEY);
  if (!token || !ts) return null;
  if (Date.now() - parseInt(ts, 10) > SESSION_EXPIRY_MS) {
    clearSession();
    return null;
  }
  return token;
}

function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_TS_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
}

function cents(val: string): number {
  return Math.round(parseFloat(val || "0") * 100);
}
function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

// ─── API helpers ──────────────────────────────────────────────────────────────

function authHeaders(token: string) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function apiFetch(path: string, token: string, opts: RequestInit = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...opts,
    headers: { ...(opts.headers ?? {}), ...authHeaders(token) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
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
      await apiFetch("/admin/transparency/verify", password, { method: "POST" });
      saveSession(password);
      onSuccess(password);
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
  invoiceFile: null,
  invoiceUrl: null,
});

function fromMonth(m: TransparencyMonth): MonthFormState {
  return {
    periodYear: String(m.periodYear),
    periodMonth: String(m.periodMonth),
    expensesCents: dollars(m.expensesCents),
    donationsCents: dollars(m.donationsCents),
    goalFoundationCents: dollars(m.goalFoundationCents),
    notes: m.notes ?? "",
    invoiceFile: null,
    invoiceUrl: m.invoiceUrl,
  };
}

interface MonthFormProps {
  initial: MonthFormState;
  token: string;
  onSave: (data: Omit<MonthFormState, "invoiceFile">) => void;
  onCancel: () => void;
  isNew: boolean;
  isSaving: boolean;
}

function MonthForm({ initial, token, onSave, onCancel, isNew, isSaving }: MonthFormProps) {
  const [form, setForm] = React.useState<MonthFormState>(initial);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState("");

  function set(key: keyof MonthFormState, value: string | null) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError("");
    try {
      // Step 1: get presigned URL
      const { uploadUrl, objectPath } = await apiFetch("/admin/transparency/upload-url", token, {
        method: "POST",
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      }) as { uploadUrl: string; objectPath: string };
      // Step 2: PUT directly to GCS
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error("Upload to GCS failed");
      setForm((f) => ({ ...f, invoiceFile: file, invoiceUrl: objectPath }));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { invoiceFile: _unused, ...rest } = form;
    void _unused;
    onSave(rest);
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
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Invoice (optional)</label>
        <div className="flex items-center gap-3">
          <label className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card text-xs font-medium cursor-pointer hover:bg-sidebar-accent transition-colors ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
            <FileUp size={14} />
            {uploading ? "Uploading…" : form.invoiceUrl ? "Replace file" : "Upload file"}
            <input type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={handleFileChange} />
          </label>
          {form.invoiceUrl && (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <Check size={12} /> Uploaded
            </span>
          )}
        </div>
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

// ─── Main admin panel ─────────────────────────────────────────────────────────

function AdminPanel({ token, onLogout }: { token: string; onLogout: () => void }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = React.useState(false);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = React.useState<number | null>(null);

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
    mutationFn: async ({ id, form }: { id: number | null; form: Omit<MonthFormState, "invoiceFile"> }) => {
      const body = {
        periodYear: parseInt(form.periodYear),
        periodMonth: parseInt(form.periodMonth),
        expensesCents: cents(form.expensesCents),
        donationsCents: cents(form.donationsCents),
        goalFoundationCents: cents(form.goalFoundationCents),
        notes: form.notes || null,
        invoiceUrl: form.invoiceUrl,
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
  });

  const monthsDesc = [...months].reverse();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="h-14 flex items-center px-6 border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="flex items-center gap-2 text-primary font-bold text-sm uppercase tracking-wider">
          <ShieldCheck size={16} />
          Admin Panel
        </div>
        <div className="ml-auto flex items-center gap-3">
          <a href="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors">← Back to app</a>
          <button
            onClick={onLogout}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto p-6 space-y-8">
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
                        {m.invoiceUrl && (
                          <button
                            onClick={async () => {
                              try {
                                const res = await fetch(`${API_BASE}/api/storage${m.invoiceUrl}`, {
                                  headers: { Authorization: `Bearer ${token}` },
                                });
                                if (!res.ok) throw new Error("Failed to fetch invoice");
                                const blob = await res.blob();
                                const url = URL.createObjectURL(blob);
                                window.open(url, "_blank");
                                setTimeout(() => URL.revokeObjectURL(url), 10000);
                              } catch {
                                alert("Failed to open invoice.");
                              }
                            }}
                            className="text-primary underline underline-offset-2 text-xs"
                          >
                            Invoice ↗
                          </button>
                        )}
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!token) {
    return <LoginForm onSuccess={setToken} />;
  }

  return <AdminPanel token={token} onLogout={handleLogout} />;
}
