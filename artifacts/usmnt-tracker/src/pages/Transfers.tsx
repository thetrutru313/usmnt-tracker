import { useListTransfers } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FormBadge } from "@/components/FormBadge";
import { format } from "date-fns";
import { RefreshCw, ArrowRight } from "lucide-react";
import { Link } from "wouter";

export default function Transfers() {
  const { data: transfers, isLoading } = useListTransfers();

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse max-w-4xl mx-auto">
        <div className="h-10 w-48 bg-card rounded" />
        <div className="space-y-4">
          {[1,2,3].map(i => (
            <div key={i} className="h-32 bg-card rounded-xl border border-card-border" />
          ))}
        </div>
      </div>
    );
  }

  const confirmed = transfers?.filter(t => t.status === 'confirmed') || [];
  const rumors = transfers?.filter(t => t.status === 'rumor') || [];

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight uppercase mb-2 flex items-center gap-3">
          <RefreshCw className="text-primary" size={28} />
          Transfer Hub
        </h1>
        <p className="text-muted-foreground text-sm">Confirmed moves and loans from the API-Football feed.</p>
      </div>

      <div className="space-y-12">
        {/* Confirmed Moves */}
        {confirmed.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-sm font-bold font-mono uppercase text-foreground tracking-widest border-b border-border pb-2">
              Confirmed Deals
            </h2>
            <div className="space-y-3">
              {confirmed.map(transfer => (
                <Card key={transfer.id} className="overflow-hidden">
                  <CardContent className="p-0 flex flex-col md:flex-row">
                    <div className="p-4 md:w-48 bg-muted/20 border-b md:border-b-0 md:border-r border-border flex flex-col justify-center">
                      <div className="text-xs text-muted-foreground font-mono mb-1">{format(new Date(transfer.announcedAt), "MMM d, yyyy")}</div>
                      <Badge className="w-fit uppercase text-[10px] tracking-wider mb-2">{transfer.transferType.replace('_', ' ')}</Badge>
                      <div className="font-mono font-bold text-green-600 dark:text-green-400">{transfer.fee || 'Undisclosed'}</div>
                    </div>
                    
                    <div className="p-4 md:p-6 flex-1 flex flex-col justify-center">
                      <div className="flex items-center gap-4 mb-4">
                        <Link href={`/players/${transfer.player.id}`} className="shrink-0">
                          {transfer.player.photoUrl ? (
                            <img src={transfer.player.photoUrl} alt={transfer.player.name} className="w-12 h-12 rounded-full object-cover border-2 border-primary/20 hover:border-primary transition-colors" />
                          ) : (
                            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center font-bold text-sm hover:border-primary border-2 border-border transition-colors">
                              {transfer.player.name.substring(0,2)}
                            </div>
                          )}
                        </Link>
                        <div>
                          <Link href={`/players/${transfer.player.id}`} className="font-bold text-xl hover:text-primary transition-colors">
                            {transfer.player.name}
                          </Link>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-sm text-muted-foreground uppercase tracking-wider">{transfer.player.position}</span>
                            <FormBadge trend={transfer.performanceTrend} showEmoji={false} className="h-4 text-[9px]" />
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 bg-muted/10 p-3 rounded border border-border">
                        <div className="flex-1 text-center font-medium truncate">{transfer.fromClub}</div>
                        <ArrowRight size={16} className="text-primary shrink-0" />
                        <div className="flex-1 text-center font-bold truncate text-foreground">{transfer.toClub}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Rumor Mill */}
        {rumors.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-sm font-bold font-mono uppercase text-muted-foreground tracking-widest border-b border-border pb-2">
              Rumor Mill
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {rumors.map(transfer => (
                <Card key={transfer.id} className="bg-card/50 border-dashed">
                  <CardContent className="p-5">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-2">
                        <Link href={`/players/${transfer.player.id}`} className="font-bold hover:text-primary transition-colors">
                          {transfer.player.name}
                        </Link>
                        <FormBadge trend={transfer.performanceTrend} showEmoji={false} className="h-4 text-[9px]" />
                      </div>
                      <div className="flex items-center gap-1.5 bg-background border border-border px-2 py-0.5 rounded text-xs font-mono">
                        Probability
                        <span className={`font-bold ${
                          transfer.probabilityScore && transfer.probabilityScore >= 70 ? 'text-primary' : 
                          transfer.probabilityScore && transfer.probabilityScore >= 40 ? 'text-yellow-500' : 'text-muted-foreground'
                        }`}>{transfer.probabilityScore}%</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-sm mb-4">
                      <span className="text-muted-foreground truncate max-w-[40%]">{transfer.fromClub}</span>
                      <ArrowRight size={14} className="text-muted-foreground shrink-0 mx-2" />
                      <span className="font-medium truncate max-w-[40%] text-right">{transfer.toClub}</span>
                    </div>

                    <p className="text-xs text-muted-foreground italic border-t border-border pt-3">
                      "{transfer.summary}"
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
