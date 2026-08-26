import * as React from "react";
import { ChevronDown, ChevronRight, CheckCircle, XCircle, AlertCircle, Lock, Loader2, ThumbsUp, Clock, Calendar } from "lucide-react";
import { toast } from "sonner";
import {
  STORAGE_KEY,
  saveSession,
  loadSession,
  clearSession,
  SessionExpiredError,
  RateLimitError,
  apiFetch,
} from "../lib/adminSession";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EligibilitySignal {
  id: number;
  signalType: string;
  signalValue: string | null;
  weight: number | null;
  source: string;
  detectedAt: string;
}

/** Persisted inputs behind `qualityScore` — see `qualityScore.ts` in the
 *  api-server. Shown so an operator can see at a glance why a candidate
 *  scored the way they did, and so a coefficient retune can be diffed
 *  against what actually drove a past score. */
interface QualityScoreInputs {
  leagueId: number | null;
  leagueName: string | null;
  // The team behind the selected primary league — used server-side to
  // correct `clubName` when the candidate's discovery-source club (e.g. a
  // youth national team roster) isn't the player's real club.
  leagueTeamId?: number | null;
  leagueTeamName?: string | null;
  coefficient: number;
  ageMultiplier: number;
  performanceSubtotal: number;
  minutes: number;
  starts: number;
  appearances: number;
  rating: number | null;
  age: number | null;
}

interface ReviewCandidate {
  id: number;
  name: string;
  /** Full first name from API-Football (e.g. "Christian"). Null for candidates discovered before this field was added. */
  firstName: string | null;
  position: string | null;
  age: number | null;
  clubName: string | null;
  usmntStatus: string | null;
  eligibilityConfidence: number | null;
  dataSources: string[] | null;
  status: string;
  needsReview: boolean | null;
  signals: EligibilitySignal[];
  /** "Is he worth my attention" — separate from eligibilityConfidence
   *  ("can he play for the US"). Null until first scored. */
  qualityScore: number | null;
  qualityScoredAt: string | null;
  qualityScoreInputs: QualityScoreInputs | null;
}

/** Returns the best display name for a candidate.
 *  When firstName is available, combines it with the surname portion of `name`
 *  (e.g. firstName="Christian", name="C. Pulisic" → "Christian Pulisic").
 *  Falls back to `name` as-is for older rows that have no firstName. */
function getDisplayName(candidate: ReviewCandidate): string {
  if (candidate.firstName) {
    const parts = candidate.name.split(" ");
    const surname = parts.length > 1 ? parts[parts.length - 1] : candidate.name;
    return `${candidate.firstName} ${surname}`;
  }
  return candidate.name;
}

/** Quality score is the review queue's default ordering — descending, with
 *  unscored candidates (null) sorted to the bottom rather than treated as
 *  zero, so a candidate simply awaiting its first rescore doesn't look like
 *  a genuinely low-quality prospect. Eligibility confidence stays visible on
 *  each card but no longer determines order. */
function sortByQualityScoreDesc(candidates: ReviewCandidate[]): ReviewCandidate[] {
  return [...candidates].sort((a, b) => {
    if (a.qualityScore == null && b.qualityScore == null) return 0;
    if (a.qualityScore == null) return 1;
    if (b.qualityScore == null) return -1;
    return b.qualityScore - a.qualityScore;
  });
}

interface RescoreStatus {
  pendingTotal: number;
  withinCap: number;
  backlog: number;
  cap: number;
  pendingRescore: number;
}

// saveSession, loadSession, clearSession, SessionExpiredError, API_BASE,
// authHeaders, apiFetch — all imported from ../lib/adminSession above.

// ─── Login form ───────────────────────────────────────────────────────────────

function LoginForm({ onSuccess }: { onSuccess: (token: string) => void }) {
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [rateLimitUntil, setRateLimitUntil] = React.useState<number | null>(null);

  // Auto-clear the rate-limit block when its window expires.
  React.useEffect(() => {
    if (!rateLimitUntil) return;
    const ms = rateLimitUntil - Date.now();
    if (ms <= 0) { setRateLimitUntil(null); return; }
    const id = setTimeout(() => setRateLimitUntil(null), ms);
    return () => clearTimeout(id);
  }, [rateLimitUntil]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await apiFetch("/admin/transparency/verify", password, { method: "POST" }) as { ok: boolean; token: string; sessionExpiryMs?: number };
      saveSession(res.token, res.sessionExpiryMs);
      onSuccess(res.token);
    } catch (err) {
      if (err instanceof RateLimitError) {
        const until = err.secsRemaining != null
          ? Date.now() + err.secsRemaining * 1000
          : Date.now() + 15 * 60 * 1000;
        setRateLimitUntil(until);
      } else {
        setError("Incorrect password.");
      }
    } finally {
      setLoading(false);
    }
  }

  const rateLimitMinsLeft = rateLimitUntil
    ? Math.max(1, Math.ceil((rateLimitUntil - Date.now()) / 60_000))
    : 0;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-2">
            <Lock size={22} className="text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Review Queue</h1>
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
          {rateLimitUntil ? (
            <p className="text-sm text-destructive">
              Too many attempts — please wait {rateLimitMinsLeft} minute{rateLimitMinsLeft !== 1 ? "s" : ""} before trying again.
            </p>
          ) : (
            error && <p className="text-sm text-destructive">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading || !password || !!rateLimitUntil}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? "Checking…" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Confidence bar ───────────────────────────────────────────────────────────

function ConfidenceBar({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wide">Confidence</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            Unscored
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden" />
      </div>
    );
  }
  const color = value >= 80 ? "bg-emerald-500" : value >= 50 ? "bg-yellow-400" : "bg-red-500";
  const label = value >= 80 ? "text-emerald-600" : value >= 50 ? "text-yellow-600" : "text-red-500";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wide">Confidence</span>
        <span className={`text-xs font-bold tabular-nums ${label}`}>{value}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

// ─── Quality score ────────────────────────────────────────────────────────────

/** Separate from `ConfidenceBar` (eligibility) — this answers "is he worth
 *  my attention", not "can he play for the US". Shows the league and
 *  coefficient that drove the number so an operator can see at a glance why
 *  a candidate scored the way they did. */
function QualityScoreBar({ value, inputs }: { value: number | null; inputs: QualityScoreInputs | null }) {
  if (value === null) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wide">Quality</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            Unscored
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden" />
      </div>
    );
  }
  const color = value >= 65 ? "bg-violet-500" : value >= 35 ? "bg-sky-400" : "bg-slate-400";
  const label = value >= 65 ? "text-violet-600" : value >= 35 ? "text-sky-600" : "text-slate-500";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wide">Quality</span>
        <span className={`text-xs font-bold tabular-nums ${label}`}>{value}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${value}%` }}
        />
      </div>
      {inputs && inputs.leagueName && (
        <p className="text-[11px] text-muted-foreground/80 font-mono truncate">
          {inputs.leagueName} (×{inputs.coefficient.toFixed(2)}) · age ×{inputs.ageMultiplier.toFixed(2)} · {inputs.minutes}min
        </p>
      )}
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  US_ELIGIBLE_PROSPECT: { label: "US Eligible", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" },
  DUAL_NATIONAL: { label: "Dual National", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
  DECLARED_OTHER: { label: "Declared Other", className: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" },
  UNKNOWN: { label: "Unknown", className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
};

function StatusBadge({ status }: { status: string | null }) {
  const info = status ? STATUS_LABELS[status] : null;
  if (!info) return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">Unknown</span>;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${info.className}`}>
      {info.label}
    </span>
  );
}

// ─── Override form ────────────────────────────────────────────────────────────

const USMNT_STATUSES = [
  { value: "US_ELIGIBLE_PROSPECT", label: "US Eligible Prospect" },
  { value: "DUAL_NATIONAL", label: "Dual National" },
  { value: "DECLARED_OTHER", label: "Declared Other" },
  { value: "UNKNOWN", label: "Unknown" },
];

function OverrideForm({
  onSubmit,
  onCancel,
  loading,
}: {
  onSubmit: (usmntStatus: string, reason: string) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [usmntStatus, setUsmntStatus] = React.useState("US_ELIGIBLE_PROSPECT");
  const [reason, setReason] = React.useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    onSubmit(usmntStatus, reason.trim());
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 pt-3 border-t border-border space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Override Status</p>
      <select
        value={usmntStatus}
        onChange={(e) => setUsmntStatus(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
      >
        {USMNT_STATUSES.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
      <textarea
        placeholder="Required: reason for override…"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading || !reason.trim()}
          className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {loading ? "Saving…" : "Save Override"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-2 rounded-lg border border-border text-xs hover:bg-sidebar-accent transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Candidate card ───────────────────────────────────────────────────────────

function CandidateReviewCard({
  candidate,
  token,
  onRemove,
  onSessionExpired,
}: {
  candidate: ReviewCandidate;
  token: string;
  onRemove: (id: number) => void;
  onSessionExpired: () => void;
}) {
  const [signalsOpen, setSignalsOpen] = React.useState(false);
  const [overrideOpen, setOverrideOpen] = React.useState(false);
  const [actionLoading, setActionLoading] = React.useState<"approve" | "reject" | "override" | null>(null);

  async function handleAction(action: "approve" | "reject") {
    setActionLoading(action);
    try {
      const path = action === "approve"
        ? `/admin/review-queue/${candidate.id}/approve`
        : `/admin/review-queue/${candidate.id}/reject`;
      await apiFetch(path, token, { method: "POST" });
      toast.success(action === "approve" ? `${getDisplayName(candidate)} approved and added to player pool.` : `${getDisplayName(candidate)} rejected.`);
      onRemove(candidate.id);
    } catch (err) {
      if (err instanceof SessionExpiredError) { onSessionExpired(); return; }
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleOverride(usmntStatus: string, reason: string) {
    setActionLoading("override");
    try {
      await apiFetch(`/admin/review-queue/${candidate.id}/override-status`, token, {
        method: "POST",
        body: JSON.stringify({ usmnt_status: usmntStatus, reason }),
      });
      toast.success(`Status overridden for ${getDisplayName(candidate)}.`);
      setOverrideOpen(false);
      // Refresh by removing (the queue re-fetch will re-add if still pending)
      // We keep it visible since override leaves status=pending
      // Just close the form and show success
    } catch (err) {
      if (err instanceof SessionExpiredError) { onSessionExpired(); return; }
      toast.error(err instanceof Error ? err.message : "Override failed");
    } finally {
      setActionLoading(null);
    }
  }

  const hasSignals = candidate.signals.length > 0;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm truncate">{getDisplayName(candidate)}</h3>
            {candidate.needsReview && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
                <AlertCircle size={10} />
                Needs Review
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {[candidate.clubName, candidate.position, candidate.age ? `Age ${candidate.age}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <StatusBadge status={candidate.usmntStatus} />
      </div>

      {/* Quality score (default sort order) and eligibility confidence — two
          different questions, shown side by side but never blended. */}
      <div className="grid grid-cols-2 gap-3">
        <QualityScoreBar value={candidate.qualityScore} inputs={candidate.qualityScoreInputs} />
        <ConfidenceBar value={candidate.eligibilityConfidence} />
      </div>

      {/* Data sources */}
      {candidate.dataSources && candidate.dataSources.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {candidate.dataSources.map((src) => (
            <span key={src} className="px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground font-mono">
              {src}
            </span>
          ))}
        </div>
      )}

      {/* Signals (collapsible) */}
      {hasSignals && (
        <div>
          <button
            onClick={() => setSignalsOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {signalsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {candidate.signals.length} signal{candidate.signals.length !== 1 ? "s" : ""}
          </button>
          {signalsOpen && (
            <div className="mt-2 rounded-lg border border-border overflow-hidden divide-y divide-border">
              {candidate.signals.map((sig) => (
                <div key={sig.id} className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <span className="font-mono font-medium text-foreground">{sig.signalType}</span>
                    {sig.signalValue && (
                      <span className="ml-2 text-muted-foreground">{sig.signalValue}</span>
                    )}
                    <span className="ml-2 text-muted-foreground/60">via {sig.source}</span>
                  </div>
                  {sig.weight !== null && (
                    <span className={`shrink-0 font-mono font-bold tabular-nums ${sig.weight >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                      {sig.weight > 0 ? "+" : ""}{sig.weight}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Override form */}
      {overrideOpen && (
        <OverrideForm
          onSubmit={handleOverride}
          onCancel={() => setOverrideOpen(false)}
          loading={actionLoading === "override"}
        />
      )}

      {/* Action buttons */}
      {!overrideOpen && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => handleAction("approve")}
            disabled={actionLoading !== null}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {actionLoading === "approve" ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <CheckCircle size={12} />
            )}
            Approve
          </button>
          <button
            onClick={() => handleAction("reject")}
            disabled={actionLoading !== null}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-destructive/10 text-destructive text-xs font-semibold hover:bg-destructive/20 disabled:opacity-50 transition-colors"
          >
            {actionLoading === "reject" ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <XCircle size={12} />
            )}
            Reject
          </button>
          <button
            onClick={() => setOverrideOpen(true)}
            disabled={actionLoading !== null}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-xs font-semibold hover:bg-sidebar-accent disabled:opacity-50 transition-colors"
          >
            <AlertCircle size={12} />
            Override
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Review queue panel ───────────────────────────────────────────────────────

function ReviewQueuePanel({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [candidates, setCandidates] = React.useState<ReviewCandidate[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [bulkLoading, setBulkLoading] = React.useState(false);
  const [rescoreLoading, setRescoreLoading] = React.useState(false);
  const [rescoreStatus, setRescoreStatus] = React.useState<RescoreStatus | null>(null);
  const [dobBackfillLoading, setDobBackfillLoading] = React.useState(false);

  function handleSessionExpired() {
    clearSession();
    onLogout();
    toast.error("Session expired — please log in again.");
  }

  async function fetchQueue() {
    setLoading(true);
    setError(null);
    try {
      const [queueData, statusData] = await Promise.all([
        apiFetch("/admin/review-queue", token) as Promise<{ candidates: ReviewCandidate[]; pendingRescore: number }>,
        apiFetch("/admin/rescore-status", token) as Promise<RescoreStatus>,
      ]);
      setCandidates(sortByQualityScoreDesc(queueData.candidates));
      setRescoreStatus(statusData);
    } catch (err) {
      if (err instanceof SessionExpiredError) { handleSessionExpired(); return; }
      setError(err instanceof Error ? err.message : "Failed to load queue");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void fetchQueue();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRescore() {
    setRescoreLoading(true);
    try {
      await apiFetch("/admin/trigger-eligibility-rescore", token, { method: "POST" });
      toast.success("Rescore started — refreshing queue in a moment…");
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await fetchQueue();
    } catch (err) {
      if (err instanceof SessionExpiredError) { handleSessionExpired(); return; }
      toast.error(err instanceof Error ? err.message : "Rescore failed");
    } finally {
      setRescoreLoading(false);
    }
  }

  async function handleDobBackfill() {
    const confirmed = window.confirm(
      "This will fetch birth dates from API-Football for every candidate without one. May take several minutes and consumes API quota. Continue?",
    );
    if (!confirmed) return;

    setDobBackfillLoading(true);
    try {
      // POST /admin/backfill-candidate-dob queues the backfill and returns
      // immediately (same fire-and-forget pattern as trigger-eligibility-rescore);
      // it does not wait for or return per-candidate updated/notFound/failed
      // counts — those are only visible in server logs.
      await apiFetch("/admin/backfill-candidate-dob", token, { method: "POST" });
      toast.success("Birth date backfill started — this can take several minutes. Refreshing queue in a moment…");
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await fetchQueue();
    } catch (err) {
      if (err instanceof SessionExpiredError) { handleSessionExpired(); return; }
      toast.error(err instanceof Error ? err.message : "Birth date backfill failed");
    } finally {
      setDobBackfillLoading(false);
    }
  }

  async function handleBulkApprove() {
    setBulkLoading(true);
    try {
      const data = await apiFetch("/admin/review-queue/bulk-approve", token, { method: "POST" }) as {
        promoted: number;
        skipped: number;
        skippedDetails?: Array<{ id: number; name: string; reason: string }>;
      };
      const successMsg = `Bulk approved ${data.promoted} high-confidence candidate${data.promoted !== 1 ? "s" : ""}.`;
      toast.success(successMsg);
      if (data.skipped > 0 && data.skippedDetails && data.skippedDetails.length > 0) {
        const names = data.skippedDetails.map((s) => s.name).join(", ");
        toast.warning(
          `${data.skipped} candidate${data.skipped !== 1 ? "s" : ""} skipped (slug collision): ${names}. Rename one before re-promoting.`,
          { duration: 8000 },
        );
      }
      await fetchQueue();
    } catch (err) {
      if (err instanceof SessionExpiredError) { handleSessionExpired(); return; }
      toast.error(err instanceof Error ? err.message : "Bulk approve failed");
    } finally {
      setBulkLoading(false);
    }
  }

  function removeCandidate(id: number) {
    setCandidates((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-card/80 backdrop-blur border-b border-border px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <a href="/admin" className="text-xs text-muted-foreground hover:text-foreground transition-colors">← Admin Panel</a>
          <h1 className="font-bold text-base">Review Queue</h1>
          <p className="text-xs text-muted-foreground">
            {loading ? "Loading…" : `${candidates.length} candidate${candidates.length !== 1 ? "s" : ""} pending review`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRescore}
            disabled={rescoreLoading || loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-semibold hover:bg-sidebar-accent disabled:opacity-50 transition-colors"
          >
            {rescoreLoading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Clock size={13} />
            )}
            Rescore All
          </button>
          <button
            onClick={handleDobBackfill}
            disabled={dobBackfillLoading || loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-semibold hover:bg-sidebar-accent disabled:opacity-50 transition-colors"
          >
            {dobBackfillLoading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Calendar size={13} />
            )}
            Backfill Birth Dates
          </button>
          <button
            onClick={handleBulkApprove}
            disabled={bulkLoading || loading || candidates.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {bulkLoading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <ThumbsUp size={13} />
            )}
            Approve All High-Confidence
          </button>
          <button
            onClick={onLogout}
            className="px-3 py-2 rounded-lg border border-border text-xs hover:bg-sidebar-accent transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Rescore backlog banner */}
      {!loading && rescoreStatus && (rescoreStatus.backlog > 0 || rescoreStatus.pendingRescore > 0) && (
        <div className={`border-b px-4 py-2.5 flex items-start gap-2.5 text-sm ${
          rescoreStatus.backlog > 0
            ? "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400"
            : "bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-400"
        }`}>
          {rescoreStatus.backlog > 0 ? (
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
          ) : (
            <Clock size={15} className="mt-0.5 shrink-0" />
          )}
          <div className="space-y-0.5">
            {rescoreStatus.backlog > 0 && (
              <p className="font-medium">
                Rescore backlog: {rescoreStatus.backlog.toLocaleString()} candidate{rescoreStatus.backlog !== 1 ? "s" : ""} deferred beyond the {rescoreStatus.cap}-candidate cap
              </p>
            )}
            {rescoreStatus.pendingRescore > 0 && (
              <p className={rescoreStatus.backlog > 0 ? "text-xs opacity-80" : "font-medium"}>
                {rescoreStatus.pendingRescore.toLocaleString()} candidate{rescoreStatus.pendingRescore !== 1 ? "s" : ""} {rescoreStatus.pendingRescore !== 1 ? "have" : "has"} not been scored in the last 7 days
              </p>
            )}
            {rescoreStatus.backlog > 0 && (
              <p className="text-xs opacity-80">
                Next run will score {rescoreStatus.withinCap} of {rescoreStatus.pendingTotal} pending. Raise <code className="font-mono bg-black/10 rounded px-1">RESCORE_MAX_CANDIDATES</code> or trigger a manual rescore with a higher cap to clear the backlog.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Body */}
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {loading && (
          <div className="flex justify-center py-20">
            <Loader2 size={24} className="animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
            <button onClick={fetchQueue} className="ml-3 underline text-xs">Retry</button>
          </div>
        )}

        {!loading && !error && candidates.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center space-y-3">
            <CheckCircle size={40} className="text-emerald-500" />
            <h2 className="font-semibold text-lg">Queue is clear</h2>
            <p className="text-sm text-muted-foreground max-w-xs">
              No candidates are currently pending review. New candidates will appear here after the next discovery pass.
            </p>
          </div>
        )}

        {!loading && !error && candidates.map((candidate) => (
          <CandidateReviewCard
            key={candidate.id}
            candidate={candidate}
            token={token}
            onRemove={removeCandidate}
            onSessionExpired={handleSessionExpired}
          />
        ))}
      </main>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function AdminReviewQueue() {
  const [token, setToken] = React.useState<string | null>(loadSession);

  function handleLogout() {
    clearSession();
    setToken(null);
  }

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

  return <ReviewQueuePanel token={token} onLogout={handleLogout} />;
}
