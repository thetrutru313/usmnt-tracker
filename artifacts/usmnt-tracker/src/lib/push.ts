import { ensureToken } from "@/context/MyPlayersContext";

// ─── Alert choices ────────────────────────────────────────────────────────────

export const ALERT_KINDS = [
  { key: "kickoff", label: "Kickoff reminders", description: "Before your players' matches start" },
  { key: "lineups", label: "Starting lineups", description: "When your players are named in the starting XI" },
  { key: "goals", label: "Goals & assists", description: "As they happen, within a few minutes" },
  { key: "ratings", label: "Post-match ratings", description: "Your players' ratings after the final whistle" },
  { key: "announcements", label: "USMNT announcements", description: "Roster calls and team news" },
  { key: "injuries", label: "Injuries", description: "New injuries" },
  { key: "transfers", label: "Transfers", description: "Completed moves" },
] as const;

export type AlertKind = (typeof ALERT_KINDS)[number]["key"];
export type AlertPrefs = Record<AlertKind, boolean> & { scope: "mine" | "all" };

export const DEFAULT_PREFS: AlertPrefs = {
  kickoff: true,
  lineups: true,
  goals: true,
  ratings: true,
  announcements: true,
  injuries: true,
  transfers: true,
  scope: "mine",
};

// ─── Capability checks ────────────────────────────────────────────────────────

export type PushSupport = "supported" | "needs-install" | "unsupported";

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch support gives it away.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** iPhone/iPad only allow alerts from the Home Screen app, not a Safari tab. */
export function pushSupport(): PushSupport {
  if (isIos() && !isStandalone()) return "needs-install";
  const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  return ok ? "supported" : "unsupported";
}

/** Base64url (as VAPID keys are written) → bytes for pushManager.subscribe. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// ─── API ──────────────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const SERVICE_WORKER_TIMEOUT_MS = 10_000;

async function pushApi(path: string, method: string, body?: unknown): Promise<Response> {
  const token = await ensureToken();
  return fetch(`${API_BASE}/api/push${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The server's public key, or null when alerts aren't set up there yet. */
export async function fetchPublicKey(): Promise<string | null> {
  const res = await fetch(`${API_BASE}/api/push/config`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { publicKey } = (await res.json()) as { publicKey: string | null };
  return publicKey;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Saved choices for this device, or null when the server doesn't know it. */
export async function loadPrefs(sub: PushSubscription): Promise<AlertPrefs | null> {
  const res = await pushApi(`/subscription?endpoint=${encodeURIComponent(sub.endpoint)}`, "GET");
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { prefs: AlertPrefs }).prefs;
}

export async function savePrefs(sub: PushSubscription, prefs: AlertPrefs): Promise<void> {
  const json = sub.toJSON();
  const res = await pushApi("/subscription", "PUT", {
    subscription: { endpoint: json.endpoint, keys: json.keys },
    prefs,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/**
 * Ask for permission and subscribe. Call straight from a tap: iOS only shows
 * the permission prompt in direct response to one, so nothing is awaited
 * before requestPermission (the public key is fetched when the page loads).
 */
export async function enableAlerts(
  publicKey: string,
  prefs: AlertPrefs,
): Promise<{ status: "enabled"; subscription: PushSubscription } | { status: "denied" }> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { status: "denied" };
  // `ready` never settles when no service worker is registered (e.g. the dev
  // preview, where it's switched off), so give up after a few seconds.
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Service worker not available")), SERVICE_WORKER_TIMEOUT_MS),
    ),
  ]);
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));
  await savePrefs(subscription, prefs);
  return { status: "enabled", subscription };
}

export async function disableAlerts(sub: PushSubscription): Promise<void> {
  await pushApi("/subscription", "DELETE", { endpoint: sub.endpoint });
  await sub.unsubscribe();
}

export async function sendTestAlert(sub: PushSubscription): Promise<boolean> {
  const res = await pushApi("/test", "POST", { endpoint: sub.endpoint });
  return res.ok;
}
