import { useState } from "react";
import { useListFixtures } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { format, isToday, isTomorrow } from "date-fns";
import { Calendar as CalendarIcon, MonitorPlay, MapPin, Star } from "lucide-react";
import { formatTimeMst } from "@/lib/formatMst";
import { Link } from "wouter";

type PoolTier = "core" | "inMix" | "prospect";

const POOL_FILTERS: { value: "all" | PoolTier; label: string }[] = [
  { value: "all", label: "All" },
  { value: "core", label: "Core Squad" },
  { value: "inMix", label: "In the Mix" },
  { value: "prospect", label: "Prospects" },
];

const POOL_TIER_LABELS: Record<PoolTier, string> = {
  core: "Core Squad — 2026 World Cup roster",
  inMix: "In the Mix — 5+ national team caps",
  prospect: "Prospect — under 25",
};

const POOL_TIER_STYLES: Record<PoolTier, string> = {
  core: "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 hover:border-primary/40",
  inMix: "bg-primary/5 text-foreground border-border hover:bg-primary/10 hover:border-primary/30",
  prospect: "bg-muted text-muted-foreground border-border hover:bg-muted/70 hover:border-border",
};

/** Small tricolor icon shown before a player's name, indicating pool tier. */
function PoolTierIcon({ tier }: { tier: PoolTier }) {
  if (tier === "core") {
    // The real USMNT crest — this is the full-roster tier, so it gets the
    // official federation mark rather than a generic icon.
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
    // Same tricolor palette as Core Squad, but no crest — a plain
    // red/white/navy stripe signals "in the pool" without the badge weight.
    return (
      <span
        className="w-1 h-3 rounded-sm shrink-0 bg-gradient-to-b from-primary via-white to-usmnt-blue"
        aria-hidden="true"
      />
    );
  }
  // Prospect: hollow star — "not a full star yet," pairs visually with the
  // filled star inside the Core Squad crest.
  return <Star size={12} strokeWidth={2} className="text-amber-500 fill-none shrink-0" aria-hidden="true" />;
}

function FixturesHeader({ poolFilter, onPoolFilterChange }: { poolFilter: string[]; onPoolFilterChange: (next: string[]) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight uppercase mb-2">Watch Guide</h1>
        <p className="text-muted-foreground text-sm">Every match featuring USMNT players worldwide.</p>
      </div>
      <div className="space-y-1.5">
        <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Filter by player pool</p>
        <ToggleGroup
          type="multiple"
          value={poolFilter}
          onValueChange={onPoolFilterChange}
          className="justify-start flex-wrap"
        >
          {POOL_FILTERS.map((f) => (
            <ToggleGroupItem key={f.value} value={f.value} className="text-xs px-3 h-8 rounded-md border border-border data-[state=on]:border-primary">
              {f.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  );
}

export default function Fixtures() {
  const { data: fixtures, isLoading } = useListFixtures({ scope: 'all' });
  const [poolFilter, setPoolFilter] = useState<string[]>(["all"]);

  const handlePoolFilterChange = (next: string[]) => {
    setPoolFilter((prev) => {
      const clickedAll = next.includes("all") && !prev.includes("all");
      if (clickedAll) return ["all"];
      const withoutAll = next.filter((v) => v !== "all");
      return withoutAll.length === 0 ? ["all"] : withoutAll;
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 w-48 bg-card rounded" />
        <div className="space-y-4">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="h-24 bg-card rounded-xl border border-card-border" />
          ))}
        </div>
      </div>
    );
  }

  if (!fixtures || fixtures.length === 0) {
    return (
      <div className="py-20 text-center border border-dashed rounded-lg bg-card/50">
        <p className="text-muted-foreground font-mono">NO FIXTURES SCHEDULED</p>
      </div>
    );
  }

  const filteredFixtures = poolFilter.includes("all")
    ? fixtures
    : fixtures.filter((fixture) => fixture.featuredPlayers.some((p) => poolFilter.includes(p.poolTier)));

  if (filteredFixtures.length === 0) {
    return (
      <div className="space-y-8 max-w-4xl mx-auto">
        <FixturesHeader poolFilter={poolFilter} onPoolFilterChange={handlePoolFilterChange} />
        <div className="py-20 text-center border border-dashed rounded-lg bg-card/50">
          <p className="text-muted-foreground font-mono">NO FIXTURES MATCH THIS FILTER</p>
        </div>
      </div>
    );
  }

  // Group fixtures by date
  const groupedFixtures = filteredFixtures.reduce((acc, fixture) => {
    const dateStr = format(new Date(fixture.kickoff), 'yyyy-MM-dd');
    if (!acc[dateStr]) acc[dateStr] = [];
    acc[dateStr].push(fixture);
    return acc;
  }, {} as Record<string, typeof fixtures>);

  const sortedDates = Object.keys(groupedFixtures).sort();

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <FixturesHeader poolFilter={poolFilter} onPoolFilterChange={handlePoolFilterChange} />

      <div className="space-y-8">
        {sortedDates.map(dateStr => {
          const date = new Date(dateStr);
          const dateTitle = isToday(date) ? "Today" : isTomorrow(date) ? "Tomorrow" : format(date, "EEEE, MMMM d");
          
          return (
            <div key={dateStr} className="space-y-4">
              <h2 className="text-lg font-bold font-mono uppercase text-muted-foreground flex items-center gap-2 border-b border-border pb-2">
                <CalendarIcon size={16} />
                {dateTitle}
              </h2>
              
              <div className="space-y-3">
                {groupedFixtures[dateStr].map(fixture => (
                  <Card key={fixture.id} className="overflow-hidden hover:border-primary/50 transition-colors">
                    <div className="flex flex-col md:flex-row">
                      {/* Status / Time block */}
                      <div className="md:w-32 bg-muted/30 p-4 flex md:flex-col items-center md:justify-center justify-between border-b md:border-b-0 md:border-r border-border shrink-0">
                        {fixture.status === 'live' ? (
                          <div className="flex flex-col items-center">
                            <Badge variant="destructive" className="animate-pulse mb-1 rounded-sm px-2 py-0.5">LIVE</Badge>
                            <span className="text-xs font-mono font-bold text-destructive mt-1">
                              {fixture.homeScore} - {fixture.awayScore}
                            </span>
                          </div>
                        ) : fixture.status === 'finished' ? (
                          <div className="flex flex-col items-center">
                            <span className="text-[10px] text-muted-foreground font-mono uppercase mb-1">FT</span>
                            <span className="text-lg font-mono font-bold">
                              {fixture.homeScore} - {fixture.awayScore}
                            </span>
                          </div>
                        ) : fixture.status === 'postponed' ? (
                          <Badge variant="outline" className="text-[10px] border-destructive text-destructive">POSTPONED</Badge>
                        ) : (
                          <div className="flex flex-col items-center">
                            <span className="text-lg font-bold data-value">{formatTimeMst(fixture.kickoff)}</span>
                          </div>
                        )}
                      </div>

                      {/* Match Details */}
                      <div className="flex-1 p-4 flex flex-col justify-center">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                          <span className="uppercase tracking-wider font-medium text-primary">{fixture.competition}</span>
                          {fixture.isNationalTeam && (
                            <Badge variant="default" className="h-4 text-[9px] px-1 py-0 ml-2">INTERNATIONAL</Badge>
                          )}
                        </div>
                        
                        <div className="flex items-center justify-between gap-4 mb-3">
                          <div className="flex-1 flex items-center justify-end gap-2 text-right font-bold text-lg">
                            <span>{fixture.homeTeam}</span>
                            {fixture.homeLogoUrl && (
                              <img src={fixture.homeLogoUrl} alt={fixture.homeTeam} className="w-6 h-6 object-contain shrink-0" />
                            )}
                          </div>
                          <div className="text-muted-foreground font-mono text-xs w-4 text-center shrink-0">vs</div>
                          <div className="flex-1 flex items-center gap-2 font-bold text-lg">
                            {fixture.awayLogoUrl && (
                              <img src={fixture.awayLogoUrl} alt={fixture.awayTeam} className="w-6 h-6 object-contain shrink-0" />
                            )}
                            <span>{fixture.awayTeam}</span>
                          </div>
                        </div>

                        {/* USMNT Players involved */}
                        <div className="flex flex-wrap gap-2 pt-3 border-t border-border/50">
                          {fixture.featuredPlayers.map(p => (
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
                        
                        {fixture.broadcastLink && fixture.status !== 'finished' && (
                          <a href={fixture.broadcastLink} target="_blank" rel="noreferrer" className="mt-2 w-full text-center py-1.5 bg-primary text-primary-foreground text-xs font-bold rounded uppercase tracking-wider hover:bg-primary/90 transition-colors">
                            Watch Live
                          </a>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
