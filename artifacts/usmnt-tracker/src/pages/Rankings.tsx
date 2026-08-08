import { useGetRankings } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FormBadge } from "@/components/FormBadge";
import { Trophy, TrendingUp, Clock, Flame, Star } from "lucide-react";
import { Link } from "wouter";

export default function Rankings() {
  const { data: rankings, isLoading } = useGetRankings();

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse max-w-6xl mx-auto">
        <div className="h-10 w-48 bg-card rounded" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {[1,2,3].map(i => (
            <div key={i} className="h-96 bg-card rounded-xl border border-card-border" />
          ))}
        </div>
      </div>
    );
  }

  if (!rankings) return null;

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight uppercase mb-2 flex items-center gap-3">
          <Trophy className="text-secondary" size={28} />
          Smart Rankings
        </h1>
        <p className="text-muted-foreground text-sm">Dynamic leaderboards based on recent performance, minutes, and momentum.</p>
      </div>

      {/* Featured Metric - Best Performances this week */}
      <Card className="border-secondary/30 shadow-lg shadow-secondary/5">
        <CardHeader className="bg-secondary/5 border-b border-border pb-4">
          <CardTitle className="text-lg uppercase tracking-tight flex items-center gap-2 text-foreground">
            <Star size={18} className="text-secondary fill-secondary" />
            Best Performances this week
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border">
            {rankings.bestWeekendPerformances.slice(0, 3).map((match, idx) => (
              <div key={match.id} className="p-6 relative overflow-hidden group">
                <div className="absolute -top-4 -right-4 text-9xl font-black text-muted/20 z-0 select-none font-mono">
                  {idx + 1}
                </div>
                <div className="relative z-10">
                  <div className="flex items-center gap-3 mb-4">
                    <Link href={`/players/${match.player.id}`}>
                      {match.player.photoUrl ? (
                         <img src={match.player.photoUrl} alt={match.player.name} className="w-12 h-12 rounded object-cover border border-border hover:border-secondary transition-colors" />
                      ) : (
                        <div className="w-12 h-12 rounded bg-muted flex items-center justify-center font-bold border border-border hover:border-secondary transition-colors">
                          {match.player.name.substring(0,2)}
                        </div>
                      )}
                    </Link>
                    <div>
                      <Link href={`/players/${match.player.id}`} className="font-bold text-lg hover:text-secondary transition-colors leading-none">
                        {match.player.name}
                      </Link>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground uppercase tracking-wider">{match.player.position}</span>
                        <FormBadge trend={match.performanceTrend} showEmoji={false} className="h-4 text-[9px]" />
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex justify-between items-end">
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">vs {match.opponent}</div>
                      <div className="flex gap-2">
                        {match.goals > 0 && <Badge variant="secondary" className="px-1.5 py-0 h-5 text-[10px]">{match.goals}G</Badge>}
                        {match.assists > 0 && <Badge variant="outline" className="px-1.5 py-0 h-5 text-[10px] border-secondary text-secondary">{match.assists}A</Badge>}
                        {match.goals === 0 && match.assists === 0 && <span className="text-xs font-mono text-muted-foreground">{match.minutes} min played</span>}
                      </div>
                    </div>
                    <div className="text-3xl font-bold font-mono text-secondary">
                      {match.rating != null ? match.rating.toFixed(1) : "–"}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Most In Form */}
        <Card>
          <CardHeader className="pb-3 border-b border-border">
            <CardTitle className="text-md uppercase tracking-tight flex items-center gap-2">
              <Flame size={16} className="text-primary" />
              Best Club Form
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {rankings.mostInForm.map((player, idx) => (
                <div key={player.id} className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors">
                  <div className="w-6 text-center font-mono font-bold text-muted-foreground text-sm">{idx + 1}</div>
                  <div className="flex-1 min-w-0">
                    <Link href={`/players/${player.id}`} className="font-bold text-sm hover:underline truncate block">
                      {player.name}
                    </Link>
                    <div className="text-xs text-muted-foreground truncate">{player.clubName}</div>
                  </div>
                  <FormBadge trend={player.performanceTrend} showEmoji={false} className="mt-0 h-4 text-[9px]" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Most Minutes */}
        <Card>
          <CardHeader className="pb-3 border-b border-border">
            <CardTitle className="text-md uppercase tracking-tight flex items-center gap-2">
              <Clock size={16} className="text-muted-foreground" />
              Ironmen (Minutes) · {rankings.seasonYear}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {rankings.mostMinutes.map((player, idx) => (
                <div key={player.id} className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors">
                  <div className="w-6 text-center font-mono font-bold text-muted-foreground text-sm">{idx + 1}</div>
                  <div className="flex-1 min-w-0">
                    <Link href={`/players/${player.id}`} className="font-bold text-sm hover:underline truncate block">
                      {player.name}
                    </Link>
                    <div className="text-xs text-muted-foreground truncate">{player.clubName}</div>
                  </div>
                  <FormBadge trend={player.performanceTrend} showEmoji={false} className="mt-0 h-4 text-[9px]" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Rising Fast */}
        <Card>
          <CardHeader className="pb-3 border-b border-border">
            <CardTitle className="text-md uppercase tracking-tight flex items-center gap-2">
              <TrendingUp size={16} className="text-green-500" />
              Rising Prospects
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {rankings.risingFast.map((player, idx) => (
                <div key={player.id} className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors">
                  <div className="w-6 text-center font-mono font-bold text-muted-foreground text-sm">{idx + 1}</div>
                  <div className="flex-1 min-w-0">
                    <Link href={`/players/${player.id}`} className="font-bold text-sm hover:underline truncate block">
                      {player.name}
                    </Link>
                    <div className="text-xs text-muted-foreground truncate">{player.clubName} • Age {player.age}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <FormBadge trend={player.performanceTrend} showEmoji={false} className="mt-0 h-4 text-[9px]" />
                    {player.potentialCallUpScore && (
                      <div className="flex items-center gap-1 bg-muted px-2 py-0.5 rounded text-[10px] font-mono font-bold">
                        <TrendingUp size={10} className="text-green-500" />
                        {player.potentialCallUpScore}%
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
