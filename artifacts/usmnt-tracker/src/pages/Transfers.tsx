import { useListTransfers, useListNews } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FormBadge } from "@/components/FormBadge";
import { format } from "date-fns";
import { RefreshCw, ArrowRight, ExternalLink, Newspaper } from "lucide-react";
import { Link } from "wouter";

export default function Transfers() {
  const { data: transfers, isLoading: transfersLoading } = useListTransfers();
  const { data: rumorArticles, isLoading: rumorsLoading } = useListNews(
    { category: "Transfer Rumors", limit: 15 },
  );

  const isLoading = transfersLoading || rumorsLoading;

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse max-w-4xl mx-auto">
        <div className="h-10 w-48 bg-card rounded" />
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-32 bg-card rounded-xl border border-border" />
          ))}
        </div>
      </div>
    );
  }

  const confirmed = transfers?.filter(t => t.status === "confirmed") || [];

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight uppercase mb-2 flex items-center gap-3">
          <RefreshCw className="text-primary" size={28} />
          Transfer Hub
        </h1>
        <p className="text-muted-foreground text-sm">Confirmed moves from the live feed, plus transfer news from the press.</p>
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
                      <Badge className="w-fit uppercase text-[10px] tracking-wider mb-2">{transfer.transferType.replace("_", " ")}</Badge>
                      <div className="font-mono font-bold text-green-600 dark:text-green-400">{transfer.fee || "Undisclosed"}</div>
                    </div>

                    <div className="p-4 md:p-6 flex-1 flex flex-col justify-center">
                      <div className="flex items-center gap-4 mb-4">
                        <Link href={`/players/${transfer.player.id}`} className="shrink-0">
                          {transfer.player.photoUrl ? (
                            <img src={transfer.player.photoUrl} alt={transfer.player.name} className="w-12 h-12 rounded-full object-cover border-2 border-primary/20 hover:border-primary transition-colors" />
                          ) : (
                            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center font-bold text-sm hover:border-primary border-2 border-border transition-colors">
                              {transfer.player.name.substring(0, 2)}
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

        {/* Transfer News from RSS feed */}
        <div className="space-y-4">
          <h2 className="text-sm font-bold font-mono uppercase text-foreground tracking-widest border-b border-border pb-2 flex items-center gap-2">
            <Newspaper size={13} className="text-muted-foreground" />
            In the Press
          </h2>

          {!rumorArticles || rumorArticles.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm border border-dashed border-border rounded-xl">
              No transfer news in the feed yet — check back soon.
            </div>
          ) : (
            <div className="space-y-3">
              {rumorArticles.map(article => (
                <Card key={article.id} className="bg-card/60 hover:bg-card transition-colors">
                  <CardContent className="p-4 md:p-5">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <a
                        href={article.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-sm leading-snug hover:text-primary transition-colors flex-1"
                      >
                        {article.headline}
                      </a>
                      <a
                        href={article.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-primary transition-colors shrink-0 mt-0.5"
                        aria-label="Open article"
                      >
                        <ExternalLink size={14} />
                      </a>
                    </div>

                    <div className="flex items-center gap-2 mb-3">
                      <Badge variant="outline" className="text-[9px] font-mono uppercase tracking-wide px-1.5 py-0 h-4 border-border text-muted-foreground">
                        {article.source}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {format(new Date(article.publishedAt), "MMM d, yyyy")}
                      </span>
                    </div>

                    {article.summary && article.summary !== article.headline && (
                      <p className="text-xs text-muted-foreground leading-relaxed mb-3 line-clamp-2">
                        {article.summary}
                      </p>
                    )}

                    {article.players && article.players.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-2 border-t border-border/50">
                        {article.players.map(player => (
                          <Link
                            key={player.id}
                            href={`/players/${player.id}`}
                            className="flex items-center gap-1.5 bg-muted/40 hover:bg-muted/70 rounded px-2 py-0.5 transition-colors"
                          >
                            {player.photoUrl ? (
                              <img src={player.photoUrl} alt={player.name} className="w-4 h-4 rounded-full object-cover" />
                            ) : (
                              <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center text-[8px] font-bold">
                                {player.name.substring(0, 1)}
                              </div>
                            )}
                            <span className="text-xs font-medium">{player.name}</span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
