import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MonitorPlay, MapPin, Star } from "lucide-react";
import { formatTimeMst } from "@/lib/formatMst";
import { Link } from "wouter";

export type PoolTier = "core" | "inMix" | "prospect";

export const POOL_TIER_LABELS: Record<PoolTier, string> = {
  core: "Core Squad — 2026 World Cup roster",
  inMix: "In the Mix — 5+ national team caps",
  prospect: "Prospect — under 25",
};

export const POOL_TIER_STYLES: Record<PoolTier, string> = {
  core: "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 hover:border-primary/40",
  inMix: "bg-primary/5 text-foreground border-border hover:bg-primary/10 hover:border-primary/30",
  prospect: "bg-muted text-muted-foreground border-border hover:bg-muted/70 hover:border-border",
};

/** Small tricolor icon shown before a player's name, indicating pool tier. */
export function PoolTierIcon({ tier }: { tier: PoolTier }) {
  if (tier === "core") {
    return (
      <img
        src={`${import.meta.env.BASE_URL}badges/usmnt-crest.png`}
        alt=""
        aria-hidden="true"
        className="w-3.5 h-3.5 object-contain shrink-0"
      />
    );
  }
  if (tier === "inMix") {
    return (
      <span
        className="w-1 h-3 rounded-sm shrink-0 bg-gradient-to-b from-primary via-white to-usmnt-blue"
        aria-hidden="true"
      />
    );
  }
  return <Star size={12} strokeWidth={2} className="text-amber-500 fill-none shrink-0" aria-hidden="true" />;
}

export type FixtureCardFixture = {
  id: number;
  isNationalTeam: boolean;
  competition: string;
  kickoff: Date | string;
  venue: string;
  homeTeam: string;
  awayTeam: string;
  homeLogoUrl: string | null;
  awayLogoUrl: string | null;
  homeScore: number | null;
  awayScore: number | null;
  status: "scheduled" | "live" | "finished" | "postponed";
  tvNetwork: string | null;
  streamingService: string | null;
  broadcastLink?: string | null;
  featuredPlayers: Array<{
    id: number;
    name: string;
    poolTier: PoolTier;
  }>;
};

export function FixtureCard({ fixture }: { fixture: FixtureCardFixture }) {
  return (
    <Card className="overflow-hidden hover:border-primary/50 transition-colors">
      <div className="flex flex-col md:flex-row">
        {/* Status / Time block */}
        <div className="md:w-32 bg-muted/30 p-4 flex md:flex-col items-center md:justify-center justify-between border-b md:border-b-0 md:border-r border-border shrink-0">
          {fixture.status === "live" ? (
            <div className="flex flex-col items-center">
              <Badge variant="destructive" className="animate-pulse mb-1 rounded-sm px-2 py-0.5">
                LIVE
              </Badge>
              <span className="text-xs font-mono font-bold text-destructive mt-1">
                {fixture.homeScore} - {fixture.awayScore}
              </span>
            </div>
          ) : fixture.status === "finished" ? (
            <div className="flex flex-col items-center">
              <span className="text-[10px] text-muted-foreground font-mono uppercase mb-1">FT</span>
              <span className="text-lg font-mono font-bold">
                {fixture.homeScore} - {fixture.awayScore}
              </span>
            </div>
          ) : fixture.status === "postponed" ? (
            <Badge variant="outline" className="text-[10px] border-destructive text-destructive">
              POSTPONED
            </Badge>
          ) : (
            <div className="flex flex-col items-center">
              <span className="text-lg font-bold data-value">{formatTimeMst(fixture.kickoff)}</span>
            </div>
          )}
        </div>

        {/* Match Details */}
        <div className="flex-1 p-4 flex flex-col justify-center">
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground mb-2">
            <span className="uppercase tracking-wider font-medium text-primary">{fixture.competition}</span>
            {fixture.isNationalTeam && (
              <Badge variant="default" className="h-4 text-[9px] px-1 py-0 ml-2">
                INTERNATIONAL
              </Badge>
            )}
          </div>

          {/* Mobile: vertical stack so long names have full row width */}
          <div className="md:hidden flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                {fixture.homeLogoUrl && (
                  <img src={fixture.homeLogoUrl} alt={fixture.homeTeam} className="block w-full h-full object-contain" />
                )}
              </div>
              <span className="font-bold text-sm leading-snug">{fixture.homeTeam}</span>
            </div>
            <div className="pl-8 text-[10px] font-mono font-bold uppercase text-muted-foreground tracking-wider">vs</div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                {fixture.awayLogoUrl && (
                  <img src={fixture.awayLogoUrl} alt={fixture.awayTeam} className="block w-full h-full object-contain" />
                )}
              </div>
              <span className="font-bold text-sm leading-snug">{fixture.awayTeam}</span>
            </div>
          </div>

          {/* Desktop: side-by-side [home name →][logo] VS [logo][← away name] */}
          <div className="hidden md:flex items-center gap-2">
            <span className="flex-1 font-bold text-lg text-right leading-snug">{fixture.homeTeam}</span>
            <div className="w-7 h-7 shrink-0 flex items-center justify-center">
              {fixture.homeLogoUrl && (
                <img src={fixture.homeLogoUrl} alt={fixture.homeTeam} className="block w-full h-full object-contain" />
              )}
            </div>
            <div className="shrink-0 px-2 py-0.5 rounded-sm bg-muted text-muted-foreground text-xs font-mono font-bold uppercase">
              vs
            </div>
            <div className="w-7 h-7 shrink-0 flex items-center justify-center">
              {fixture.awayLogoUrl && (
                <img src={fixture.awayLogoUrl} alt={fixture.awayTeam} className="block w-full h-full object-contain" />
              )}
            </div>
            <span className="flex-1 font-bold text-lg leading-snug">{fixture.awayTeam}</span>
          </div>
        </div>

        {/* Broadcast Info */}
        <div className="md:w-48 bg-muted/10 p-4 border-t md:border-t-0 md:border-l border-border flex flex-row md:flex-col items-center md:items-start justify-between md:justify-center gap-2 shrink-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground w-full">
            <MapPin size={12} className="shrink-0" />
            <span className="truncate">{fixture.venue}</span>
          </div>

          {(fixture.tvNetwork || fixture.streamingService) && (
            <div className="flex flex-col gap-1 w-full">
              {fixture.tvNetwork && (
                <div className="flex items-center gap-2 text-xs font-medium">
                  <MonitorPlay size={12} className="text-primary shrink-0" />
                  {fixture.tvNetwork}
                </div>
              )}
              {fixture.streamingService && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MonitorPlay size={12} className="shrink-0" />
                  {fixture.streamingService}
                </div>
              )}
            </div>
          )}

          {fixture.broadcastLink && fixture.status !== "finished" && (
            <a
              href={fixture.broadcastLink}
              target="_blank"
              rel="noreferrer"
              className="mt-2 w-full text-center py-1.5 bg-primary text-primary-foreground text-xs font-bold rounded uppercase tracking-wider hover:bg-primary/90 transition-colors"
            >
              Watch Live
            </a>
          )}
        </div>
      </div>

      {/* Full-width player footer — outside the 3-col row so tags span the whole card */}
      {fixture.featuredPlayers.length > 0 && (
        <div className="border-t border-border px-4 py-3 flex flex-wrap gap-2">
          {fixture.featuredPlayers.map((p) => (
            <Link
              key={p.id}
              href={`/players/${p.id}`}
              className={`text-xs px-2 py-1 rounded flex items-center gap-1.5 font-medium transition-colors border ${POOL_TIER_STYLES[p.poolTier]}`}
              title={POOL_TIER_LABELS[p.poolTier]}
            >
              <PoolTierIcon tier={p.poolTier} />
              {p.name}
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}
