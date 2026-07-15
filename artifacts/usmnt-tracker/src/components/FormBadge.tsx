import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type PerformanceTrend = "on_fire" | "rising" | "steady" | "falling" | "ice_cold";

const TREND_CONFIG: Record<
  string,
  { label: string; emoji: string; className: string }
> = {
  on_fire:  { label: "On Fire",  emoji: "🔥", className: "bg-orange-500/20 text-orange-500 border-orange-500/30 hover:bg-orange-500/30" },
  rising:   { label: "Rising",   emoji: "📈", className: "bg-green-500/20  text-green-500  border-green-500/30  hover:bg-green-500/30"  },
  steady:   { label: "Steady",   emoji: "➖", className: "bg-muted         text-muted-foreground border-border"                          },
  falling:  { label: "Falling",  emoji: "📉", className: "bg-yellow-500/20 text-yellow-600 border-yellow-500/30 hover:bg-yellow-500/30" },
  ice_cold: { label: "Ice Cold", emoji: "🥶", className: "bg-blue-500/20   text-blue-500   border-blue-500/30   hover:bg-blue-500/30"   },
};

interface FormBadgeProps {
  trend: string;
  /** Show the emoji prefix. Defaults to true. */
  showEmoji?: boolean;
  className?: string;
}

/**
 * Renders a player's 5-tier form label (On Fire / Rising / Steady / Falling /
 * Ice Cold) as a colour-coded badge.  The `trend` prop accepts any of the five
 * canonical values; unknown values fall back to "Steady" styling.
 */
export function FormBadge({ trend, showEmoji = true, className }: FormBadgeProps) {
  const cfg = TREND_CONFIG[trend] ?? TREND_CONFIG["steady"]!;
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded px-1.5 h-5 text-[10px] uppercase font-mono mt-0.5 gap-0.5 border",
        cfg.className,
        className,
      )}
    >
      {showEmoji && <span aria-hidden="true">{cfg.emoji}</span>}
      {cfg.label}
    </Badge>
  );
}
