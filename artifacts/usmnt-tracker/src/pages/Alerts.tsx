import { useEffect, useState, type ReactNode } from "react";
import { Bell, BellOff, Share, Smartphone } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  ALERT_KINDS,
  DEFAULT_PREFS,
  currentSubscription,
  disableAlerts,
  enableAlerts,
  fetchPublicKey,
  loadPrefs,
  pushSupport,
  savePrefs,
  sendTestAlert,
  type AlertKind,
  type AlertPrefs,
} from "@/lib/push";

type State =
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "needs-install" }
  | { kind: "not-configured" }
  | { kind: "denied" }
  | { kind: "off"; publicKey: string }
  | { kind: "on"; subscription: PushSubscription; prefs: AlertPrefs };

function withAlert(prefs: AlertPrefs, key: AlertKind, on: boolean): AlertPrefs {
  const next = { ...prefs };
  next[key] = on;
  return next;
}

function Notice({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="p-6 flex gap-4">
        <div className="text-muted-foreground shrink-0 mt-0.5">{icon}</div>
        <div className="space-y-1">
          <p className="font-bold">{title}</p>
          <div className="text-sm text-muted-foreground space-y-2">{children}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Alerts() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const set = (s: State) => { if (!cancelled) setState(s); };
    (async () => {
      const support = pushSupport();
      if (support !== "supported") return set({ kind: support });
      const publicKey = await fetchPublicKey();
      if (!publicKey) return set({ kind: "not-configured" });
      if (Notification.permission === "denied") return set({ kind: "denied" });
      const subscription = await currentSubscription();
      if (!subscription) return set({ kind: "off", publicKey });
      // The server may have dropped this device (e.g. it was gone for a
      // while); save it again with default choices rather than showing "off".
      let prefs = await loadPrefs(subscription);
      if (!prefs) {
        prefs = DEFAULT_PREFS;
        await savePrefs(subscription, prefs);
      }
      set({ kind: "on", subscription, prefs });
    })().catch(() => set({ kind: "unsupported" }));
    return () => { cancelled = true; };
  }, []);

  async function handleEnable(publicKey: string) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await enableAlerts(publicKey, DEFAULT_PREFS);
      if (result.status === "denied") setState({ kind: "denied" });
      else setState({ kind: "on", subscription: result.subscription, prefs: DEFAULT_PREFS });
    } catch {
      setMessage("Couldn't switch alerts on. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePrefs(subscription: PushSubscription, previous: AlertPrefs, next: AlertPrefs) {
    setState({ kind: "on", subscription, prefs: next });
    setMessage(null);
    try {
      await savePrefs(subscription, next);
    } catch {
      setState({ kind: "on", subscription, prefs: previous });
      setMessage("Couldn't save that change. Please try again.");
    }
  }

  async function handleTest(subscription: PushSubscription) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage((await sendTestAlert(subscription)) ? "Test alert sent — check your notifications." : "The test alert didn't go through.");
    } catch {
      setMessage("The test alert didn't go through.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable(subscription: PushSubscription) {
    setBusy(true);
    setMessage(null);
    try {
      await disableAlerts(subscription);
      const publicKey = await fetchPublicKey();
      setState(publicKey ? { kind: "off", publicKey } : { kind: "not-configured" });
    } catch {
      setMessage("Couldn't switch alerts off. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight uppercase mb-2">Alerts</h1>
        <p className="text-muted-foreground text-sm">Notifications on this device for the players and news you choose.</p>
      </div>

      {state.kind === "loading" && <div className="h-32 bg-card rounded-xl border border-card-border animate-pulse" />}

      {state.kind === "needs-install" && (
        <Notice icon={<Smartphone size={20} />} title="Add USMNT Tracker to your Home Screen first">
          <p>
            On iPhone and iPad, alerts only work from the Home Screen app. In Safari, tap{" "}
            <Share size={14} className="inline -mt-0.5" /> Share, then <strong>Add to Home Screen</strong>, and open
            Alerts from the new icon.
          </p>
        </Notice>
      )}

      {state.kind === "unsupported" && (
        <Notice icon={<BellOff size={20} />} title="Alerts aren't available in this browser">
          <p>Try the Home Screen app on iPhone, or a current version of Chrome, Edge, Firefox or Safari.</p>
        </Notice>
      )}

      {state.kind === "not-configured" && (
        <Notice icon={<BellOff size={20} />} title="Alerts aren't switched on yet">
          <p>They're still being set up. Check back soon.</p>
        </Notice>
      )}

      {state.kind === "denied" && (
        <Notice icon={<BellOff size={20} />} title="Notifications are blocked for this app">
          <p>Allow them in your device's settings (on iPhone: Settings → Notifications → USMNT), then come back here.</p>
        </Notice>
      )}

      {state.kind === "off" && (
        <Card>
          <CardContent className="p-6 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
            <div>
              <p className="font-bold">Alerts are off on this device</p>
              <p className="text-sm text-muted-foreground">You'll choose which alerts you want next.</p>
            </div>
            <Button onClick={() => handleEnable(state.publicKey)} disabled={busy} className="shrink-0">
              <Bell size={16} className="mr-2" /> Enable alerts
            </Button>
          </CardContent>
        </Card>
      )}

      {state.kind === "on" && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg uppercase tracking-tight">Which players</CardTitle>
              <CardDescription>
                My Players are the players you've starred in this app. USMNT announcements go to everyone who has them on.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ToggleGroup
                type="single"
                value={state.prefs.scope}
                onValueChange={(v) => {
                  if (v === "mine" || v === "all") {
                    handlePrefs(state.subscription, state.prefs, { ...state.prefs, scope: v });
                  }
                }}
                className="justify-start gap-1"
              >
                <ToggleGroupItem value="mine" className="text-xs px-3 h-8 rounded-md border border-border data-[state=on]:border-primary">
                  My Players
                </ToggleGroupItem>
                <ToggleGroupItem value="all" className="text-xs px-3 h-8 rounded-md border border-border data-[state=on]:border-primary">
                  All tracked players
                </ToggleGroupItem>
              </ToggleGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg uppercase tracking-tight">Alert types</CardTitle>
              <CardDescription>Some of these are still being switched on and will start arriving soon.</CardDescription>
            </CardHeader>
            <CardContent className="divide-y divide-border">
              {ALERT_KINDS.map(({ key, label, description }) => (
                <label key={key} className="flex items-center justify-between gap-4 py-3 cursor-pointer">
                  <span>
                    <span className="block font-medium text-sm">{label}</span>
                    <span className="block text-xs text-muted-foreground">{description}</span>
                  </span>
                  <Switch
                    aria-label={label}
                    checked={state.prefs[key]}
                    onCheckedChange={(checked) =>
                      handlePrefs(state.subscription, state.prefs, withAlert(state.prefs, key, checked))
                    }
                  />
                </label>
              ))}
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => handleTest(state.subscription)} disabled={busy}>
              Send me a test
            </Button>
            <Button variant="ghost" onClick={() => handleDisable(state.subscription)} disabled={busy}>
              Turn off alerts on this device
            </Button>
          </div>
        </>
      )}

      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
