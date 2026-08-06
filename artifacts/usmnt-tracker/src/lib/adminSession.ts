/**
 * Shared admin session helpers — used by both Admin.tsx and AdminReviewQueue.tsx.
 *
 * Session token lifecycle:
 *  1. POST /admin/transparency/verify  — sends ADMIN_PASSWORD as Bearer, returns
 *     a one-time UUID token + expiry. The password is never stored locally.
 *  2. Token saved in localStorage; every subsequent request carries it as Bearer.
 *  3. POST /admin/logout               — revokes token server-side.
 *  4. 401 from any admin endpoint      — token expired or revoked; clear local state.
 */

export const STORAGE_KEY = "usmnt_admin_token";
export const STORAGE_TS_KEY = "usmnt_admin_token_ts";
export const STORAGE_EXPIRY_KEY = "usmnt_admin_session_expiry_ms";

/** Fallback session length used when the server hasn't supplied a value yet. */
export const DEFAULT_SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Returns the session expiry duration stored from the last verify call, or the default. */
export function getSessionExpiryMs(): number {
  const stored = localStorage.getItem(STORAGE_EXPIRY_KEY);
  if (stored) {
    const parsed = parseInt(stored, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_SESSION_EXPIRY_MS;
}

export function saveSession(token: string, expiryMs?: number): void {
  localStorage.setItem(STORAGE_KEY, token);
  localStorage.setItem(STORAGE_TS_KEY, String(Date.now()));
  if (expiryMs !== undefined) {
    localStorage.setItem(STORAGE_EXPIRY_KEY, String(expiryMs));
  }
}

export function loadSession(): string | null {
  const token = localStorage.getItem(STORAGE_KEY);
  const ts = localStorage.getItem(STORAGE_TS_KEY);
  if (!token || !ts) return null;
  if (Date.now() - parseInt(ts, 10) > getSessionExpiryMs()) {
    clearSession();
    return null;
  }
  return token;
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_TS_KEY);
  localStorage.removeItem(STORAGE_EXPIRY_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
}

// ── API helpers ────────────────────────────────────────────────────────────────

/** Thrown by apiFetch when the server returns 401 (token revoked or expired). */
export class SessionExpiredError extends Error {
  constructor() {
    super("Session expired — please log in again.");
    this.name = "SessionExpiredError";
  }
}

/**
 * Thrown by apiFetch when the server returns 429 (rate limited).
 * `secsRemaining` is derived from the RateLimit-Reset or Retry-After header;
 * it is null when neither header is present.
 */
export class RateLimitError extends Error {
  secsRemaining: number | null;
  constructor(secsRemaining: number | null) {
    super("Too many attempts — please wait before trying again.");
    this.name = "RateLimitError";
    this.secsRemaining = secsRemaining;
  }
}

export const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function authHeaders(token: string) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

export async function apiFetch(path: string, token: string, opts: RequestInit = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...opts,
    headers: { ...(opts.headers ?? {}), ...authHeaders(token) },
  });
  if (res.status === 401) throw new SessionExpiredError();
  if (res.status === 429) {
    // RateLimit-Reset is a Unix epoch timestamp (seconds); Retry-After is seconds
    // remaining. Values > 1 billion are epochs; smaller values are durations.
    const raw = res.headers.get("RateLimit-Reset") ?? res.headers.get("Retry-After");
    let secsRemaining: number | null = null;
    if (raw) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n)) {
        secsRemaining = n > 1_000_000_000
          ? Math.max(0, n - Math.floor(Date.now() / 1000))
          : n;
      }
    }
    throw new RateLimitError(secsRemaining);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}
