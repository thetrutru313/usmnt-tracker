import { useListFixtures } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format, isToday, isTomorrow } from "date-fns";
import { Calendar as CalendarIcon, MonitorPlay, MapPin } from "lucide-react";
import { formatTimeMst } from "@/lib/formatMst";

export default function Fixtures() {
  const { data: fixtures, isLoading } = useListFixtures({ scope: 'all' });

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

  // Group fixtures by date
  const groupedFixtures = fixtures.reduce((acc, fixture) => {
    const dateStr = format(new Date(fixture.kickoff), 'yyyy-MM-dd');
    if (!acc[dateStr]) acc[dateStr] = [];
    acc[dateStr].push(fixture);
    return acc;
  }, {} as Record<string, typeof fixtures>);

  const sortedDates = Object.keys(groupedFixtures).sort();

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight uppercase mb-2">Watch Guide</h1>
        <p className="text-muted-foreground text-sm">Every match featuring USMNT players worldwide.</p>
      </div>

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
                          <div className="flex-1 text-right font-bold text-lg">{fixture.homeTeam}</div>
                          <div className="text-muted-foreground font-mono text-xs w-4 text-center shrink-0">vs</div>
                          <div className="flex-1 font-bold text-lg">{fixture.awayTeam}</div>
                        </div>

                        {/* USMNT Players involved */}
                        <div className="flex flex-wrap gap-2 pt-3 border-t border-border/50">
                          {fixture.featuredPlayers.map(p => (
                            <span key={p.id} className="text-xs bg-secondary/10 text-secondary border border-secondary/20 px-2 py-1 rounded flex items-center gap-1 font-medium">
                              {p.name}
                            </span>
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
