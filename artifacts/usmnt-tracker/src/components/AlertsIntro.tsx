import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Bell } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { isIos, isStandalone, pushSupport } from "@/lib/push";

export const ALERTS_INTRO_SEEN_KEY = "usmnt_alerts_intro_seen";
const SHOW_DELAY_MS = 1000;
const SKIP_PATHS = ["/alerts", "/admin", "/recover"];

function isMobileDevice(): boolean {
  return isIos() || /Android/i.test(navigator.userAgent);
}

/**
 * Whether to show the one-time "New: alerts" popup: only in the installed
 * Home Screen app on a phone or tablet, where alerts work and aren't already
 * allowed, and only if this device can remember that it was shown (otherwise
 * it could appear again, so it isn't shown at all).
 */
function shouldShow(path: string): boolean {
  if (SKIP_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return false;
  if (!isStandalone() || !isMobileDevice()) return false;
  if (pushSupport() !== "supported") return false;
  if (Notification.permission !== "default") return false;
  try {
    if (localStorage.getItem(ALERTS_INTRO_SEEN_KEY)) return false;
    // Marked as seen the moment it's shown, so closing the app without
    // tapping anything still counts.
    localStorage.setItem(ALERTS_INTRO_SEEN_KEY, new Date().toISOString());
    return localStorage.getItem(ALERTS_INTRO_SEEN_KEY) !== null;
  } catch {
    return false;
  }
}

/** One-time popup introducing push alerts to people using the installed app. */
export function AlertsIntro() {
  const [location, navigate] = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Decided once per app launch, for the page the app opened on.
    const openedOn = location;
    const timer = setTimeout(() => {
      if (shouldShow(openedOn)) setOpen(true);
    }, SHOW_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Navigating to the Alerts page some other way closes it.
  useEffect(() => {
    if (location === "/alerts") setOpen(false);
  }, [location]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="mx-auto mb-2 inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary">
            <Bell size={22} />
          </div>
          <DialogTitle className="text-center">New: alerts</DialogTitle>
          <DialogDescription className="text-center">
            Get notified about kickoffs, ratings, injuries and transfers for the players you follow, plus USMNT roster news.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            onClick={() => {
              setOpen(false);
              navigate("/alerts");
            }}
          >
            Set up alerts
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Not now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
