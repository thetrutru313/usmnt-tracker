export type PoolTier = "core" | "inMix" | "prospect";

export const POOL_TIER_LABELS: Record<PoolTier, string> = {
  core: "Core Squad — 2026 World Cup roster",
  inMix: "In the Mix — 5+ national team caps",
  prospect: "Prospect — fewer than 5 national team caps",
};

export const POOL_TIER_STYLES: Record<PoolTier, string> = {
  core: "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 hover:border-primary/40",
  inMix: "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 hover:border-primary/40",
  prospect: "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 hover:border-primary/40",
};
