import { useListNews } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ArrowUpRight, Flame } from "lucide-react";
import { Link } from "wouter";

export default function News() {
  const { data: news, isLoading } = useListNews({ limit: 50 });

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse max-w-4xl mx-auto">
        <div className="h-10 w-48 bg-card rounded" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="h-48 bg-card rounded-xl border border-card-border" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight uppercase mb-2">Intel Feed</h1>
        <p className="text-muted-foreground text-sm">Aggregated news, summaries, and impact analysis.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {news?.map((article, i) => (
          <Card key={article.id} className={`group hover:shadow-lg transition-all ${i === 0 ? 'md:col-span-2' : ''}`}>
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Badge variant={
                  article.sentiment === 'positive' ? 'success' :
                  article.sentiment === 'negative' ? 'destructive' : 'secondary'
                } className="uppercase font-mono text-[10px]">
                  {article.category}
                </Badge>
                <span className="text-xs font-mono text-muted-foreground">
                  {format(new Date(article.publishedAt), "MMM d, HH:mm")}
                </span>
                <span className="text-xs font-mono text-muted-foreground ml-auto uppercase bg-muted px-2 py-0.5 rounded">
                  {article.source}
                </span>
              </div>

              <a href={article.url} target="_blank" rel="noreferrer" className="block group-hover:text-primary transition-colors">
                <h2 className={`font-bold tracking-tight mb-3 ${i === 0 ? 'text-2xl md:text-3xl' : 'text-xl'}`}>
                  {article.headline}
                  <ArrowUpRight className="inline-block ml-1 opacity-0 group-hover:opacity-100 transition-opacity" size={20} />
                </h2>
              </a>

              <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                {article.summary}
              </p>

              <div className="bg-muted/30 border border-border rounded-lg p-4 mb-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-foreground mb-1.5">
                  <Flame size={14} className="text-secondary" />
                  Why It Matters
                </div>
                <p className="text-sm text-muted-foreground italic">"{article.whyItMatters}"</p>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-border/50">
                <div className="flex flex-wrap gap-2">
                  {article.players.map(player => (
                    <Link key={player.id} href={`/players/${player.id}`} className="flex items-center gap-1.5 hover:bg-muted p-1 rounded transition-colors -ml-1">
                      {player.photoUrl ? (
                        <img src={player.photoUrl} alt={player.name} className="w-5 h-5 rounded-full object-cover border border-border" />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[8px] font-bold border border-border">
                          {player.name.substring(0,1)}
                        </div>
                      )}
                      <span className="text-xs font-medium">{player.name}</span>
                    </Link>
                  ))}
                </div>
                
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase font-mono text-muted-foreground">Impact</span>
                  <div className="flex gap-0.5">
                    {[...Array(10)].map((_, idx) => (
                      <div key={idx} className={`w-1.5 h-3 rounded-sm ${idx < article.impactScore ? 'bg-primary' : 'bg-muted'}`} />
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
