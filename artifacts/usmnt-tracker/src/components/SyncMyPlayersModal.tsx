import { useState } from "react";
import { Copy, Link2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useMyPlayers } from "@/hooks/useMyPlayers";

interface SyncMyPlayersModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SyncMyPlayersModal({ open, onOpenChange }: SyncMyPlayersModalProps) {
  const { generateTransferLink } = useMyPlayers();
  const [link, setLink] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const url = await generateTransferLink();
      setLink(url);
    } catch {
      setError(
        "Couldn't generate a transfer link right now. The sync service may be unavailable — try again later.",
      );
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — show link text as fallback
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setLink(null);
      setError(null);
      setCopied(false);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 size={18} className="text-primary" />
            Sync My Players
          </DialogTitle>
          <DialogDescription>
            Your watchlist is stored on this device. Generate a one-time transfer link to
            move your saved players to another browser or device.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground space-y-2">
            <p>
              <span className="font-semibold text-foreground">How it works:</span> Click
              "Generate Transfer Link" to get a private URL. Open that URL on another
              device within 30 days to restore your list there.
            </p>
            <p>Each link can only be used once and expires after 30 days.</p>
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {link && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-xs font-mono break-all text-foreground select-all">
              {link}
            </div>
          )}

          <div className="flex gap-2">
            {!link ? (
              <Button
                onClick={handleGenerate}
                disabled={generating}
                className="flex-1"
              >
                {generating ? (
                  <>
                    <Loader2 size={14} className="mr-2 animate-spin" />
                    Generating…
                  </>
                ) : (
                  "Generate Transfer Link"
                )}
              </Button>
            ) : (
              <Button onClick={handleCopy} variant="outline" className="flex-1 gap-2">
                <Copy size={14} />
                {copied ? "Copied!" : "Copy Link"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
