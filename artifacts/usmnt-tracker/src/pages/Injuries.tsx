import { useListInjuries } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FormBadge } from "@/components/FormBadge";
import { format } from "date-fns";
import { Activity, Clock, ShieldAlert } from "lucide-react";
import { Link } from "wouter";

export default function Injuries() {
  const { data: injuries, isLoading } = useListInjuries();

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse max-w-4xl mx-auto">
        <div className="h-10 w-48 bg-card rounded" />
        <div className="space-y-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="h-24 bg-card rounded-xl border border-card-border" />
          ))}
        </div>
      </div>
    );
  }

  const activeInjuries = injuries?.filter(i => i.status === 'active' || i.status === 'recovering') || [];
  const returnedInjuries = injuries?.filter(i => i.status === 'returned') || [];

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight uppercase mb-2 flex items-center gap-3">
          <Activity className="text-destructive" size={28} />
          Medical Bay
        </h1>
        <p className="text-muted-foreground text-sm">Tracking injuries, recovery timelines, and recent returns across the pool.</p>
      </div>

      {activeInjuries.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-bold font-mono uppercase text-destructive tracking-widest flex items-center gap-2">
            <ShieldAlert size={14} /> Active Issues
          </h2>
          
          <div className="grid grid-cols-1 gap-4">
            {activeInjuries.map(injury => (
              <Card key={injury.id} className="border-l-4 border-l-destructive">
                <CardContent className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
                  <div className="flex items-center gap-4 sm:w-1/3 shrink-0">
                    <Link href={`/players/${injury.player.id}`} className="shrink-0">
                      {injury.player.photoUrl ? (
                        <img src={injury.player.photoUrl} alt={injury.player.name} className="w-12 h-12 rounded object-cover border border-border hover:border-primary transition-colors" />
                      ) : (
                        <div className="w-12 h-12 rounded bg-muted flex items-center justify-center font-bold text-sm text-muted-foreground hover:border-primary border border-border transition-colors">
                          {injury.player.name.substring(0,2).toUpperCase()}
                        </div>
                      )}
                    </Link>
                    <div>
                      <Link href={`/players/${injury.player.id}`} className="font-bold text-lg hover:underline truncate block">
                        {injury.player.name}
                      </Link>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-xs text-muted-foreground">{injury.clubName}</span>
                        <FormBadge trend={injury.performanceTrend} showEmoji={false} className="h-4 text-[9px]" />
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-[10px] uppercase font-mono text-muted-foreground mb-1">Issue</div>
                      <div className="font-medium text-foreground">{injury.bodyPart}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase font-mono text-muted-foreground mb-1">Status</div>
                      <Badge variant={injury.status === 'active' ? 'destructive' : 'warning'} className="text-[10px] uppercase font-mono px-1.5 py-0 h-5">
                        {injury.status}
                      </Badge>
                    </div>
                  </div>

                  <div className="sm:w-1/4 shrink-0 bg-muted/30 p-3 rounded-lg border border-border flex flex-col justify-center">
                    <div className="flex items-center gap-1.5 text-[10px] uppercase font-mono text-muted-foreground mb-1">
                      <Clock size={12} /> Expected Return
                    </div>
                    <div className="font-bold font-mono">
                      {injury.expectedReturn ? format(new Date(injury.expectedReturn), "MMM d, yyyy") : 'TBD'}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Missed: {injury.daysMissed}d / {injury.matchesMissed} matches
                    </div>
                  </div>
                </CardContent>
                <div className="px-4 sm:px-6 py-2 bg-muted/20 border-t border-border text-xs text-muted-foreground italic">
                  Update: {injury.latestUpdate}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {returnedInjuries.length > 0 && (
        <div className="space-y-4 pt-8">
          <h2 className="text-sm font-bold font-mono uppercase text-green-500 tracking-widest">
            Recently Returned
          </h2>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {returnedInjuries.map(injury => (
              <Card key={injury.id} className="border-l-4 border-l-green-500 bg-green-500/5">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded bg-background flex items-center justify-center shrink-0 border border-border">
                    <span className="font-bold text-xs">{injury.player.name.substring(0,2).toUpperCase()}</span>
                  </div>
                  <div>
                    <Link href={`/players/${injury.player.id}`} className="font-bold hover:underline">
                      {injury.player.name}
                    </Link>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-xs text-muted-foreground">Recovered from {injury.bodyPart.toLowerCase()}</span>
                      <FormBadge trend={injury.performanceTrend} showEmoji={false} className="h-4 text-[9px]" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
