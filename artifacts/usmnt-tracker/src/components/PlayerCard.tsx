import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { FormBadge } from "@/components/FormBadge";
import { useMyPlayers } from "@/hooks/useMyPlayers";

export interface PlayerCardPlayer {
  id: number;
  name: string;
  position: string;
  clubName: string;
  age: number;
  nationalTeamCaps: number;
  photoUrl?: string | null;
  performanceTrend?: string | null;
  poolTier: string;
}

export function PlayerCard({ player }: { player: PlayerCardPlayer }) {
  const { isFollowing, toggle } = useMyPlayers();
  const following = isFollowing(player.id);
  const [animating, setAnimating] = useState(false);
  const animationTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = animationTimers.current;
    return () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  async function handleStarClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    setAnimating(true);
    const timer = setTimeout(() => {
      animationTimers.current.delete(timer);
      setAnimating(false);
    }, 300);
    animationTimers.current.add(timer);

    const result = await toggle(player.id);
    if (result === "added") {
      toast("Added to My Players");
    } else {
      toast("Removed from My Players");
    }
  }

  return (
    <Link href={`/players/${player.id}`}>
      <Card className="group hover:border-secondary hover:shadow-lg transition-all cursor-pointer overflow-hidden relative">
        <div
          className={`absolute top-0 right-0 w-16 h-16 rounded-bl-full -mr-8 -mt-8 transition-colors ${
            player.poolTier === "core"
              ? "bg-primary/20 group-hover:bg-primary/40"
              : player.poolTier === "inMix"
                ? "bg-secondary/20 group-hover:bg-secondary/40"
                : "bg-muted-foreground/20 group-hover:bg-muted-foreground/40"
          }`}
        />
        <CardContent className="p-5">
          <div className="flex items-start justify-between mb-4 relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded bg-muted flex items-center justify-center overflow-hidden border border-border">
                {player.photoUrl ? (
                  <img
                    src={player.photoUrl}
                    alt={player.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="font-mono text-muted-foreground font-bold">
                    {player.name.substring(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
              <div>
                <h3 className="font-bold text-lg leading-tight group-hover:text-secondary transition-colors">
                  {player.name}
                </h3>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                  <span className="font-medium uppercase tracking-wider">
                    {player.position}
                  </span>
                  <span>•</span>
                  <span className="truncate max-w-[100px]">{player.clubName}</span>
                </div>
              </div>
            </div>

            {/* Star / follow button
                ── Tap-target constraint ────────────────────────────────────
                WCAG 2.5.5 and Apple HIG require a minimum 44×44 px tap target.
                The min-h-[44px] min-w-[44px] classes enforce this floor.
                Do NOT reduce these values — a Vitest test guards this threshold.
                ──────────────────────────────────────────────────────────── */}
            <button
              onClick={handleStarClick}
              aria-label={following ? "Remove from My Players" : "Add to My Players"}
              className={`relative z-20 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md transition-colors text-muted-foreground hover:text-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                following ? "text-amber-400" : ""
              } ${animating ? "scale-125" : "scale-100"} transition-transform`}
            >
              <Star
                size={16}
                className={following ? "fill-amber-400 stroke-amber-400" : ""}
              />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-4 border-t border-border/50 items-end">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wide">
                Age
              </span>
              <span className="font-bold data-value text-sm">{player.age}</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wide leading-tight text-center">
                <span className="sm:hidden">NT Caps</span>
                <span className="hidden sm:inline">National Team Caps</span>
              </span>
              <span className="font-bold data-value text-sm">
                {player.nationalTeamCaps}
              </span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wide leading-tight text-center">
                Club Form
              </span>
              <FormBadge trend={player.performanceTrend ?? "steady"} />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
