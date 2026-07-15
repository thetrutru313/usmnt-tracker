import { useGetDashboard } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FormBadge } from "@/components/FormBadge";
import { Activity, Trophy, CalendarDays, RefreshCw, HeartPulse, Newspaper, ArrowUpRight, Tv, Users } from "lucide-react";
import { Link } from "wouter";
import { format, isToday } from "date-fns";
import { formatKickoffMst } from "@/lib/formatMst";

export default function Dashboard() {
  const { data: dashboard, isLoading, error } = useGetDashboard();

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-40 bg-card rounded-xl border border-card-border" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="h-64 bg-card rounded-xl border border-card-border" />
          <div className="h-64 bg-card rounded-xl border border-card-border" />
          <div className="h-64 bg-card rounded-xl border border-card-border" />
        </div>
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="p-8 text-center bg-destructive/10 text-destructive rounded-xl border border-destructive/20">
        <p className="font-mono text-sm">FAILED TO LOAD DASHBOARD DATA</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-10">
      {/* Next Window Hero */}
      <section className="relative overflow-hidden rounded-2xl bg-card border border-card-border shadow-lg">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
        
        <div className="p-6 md:p-8 relative z-10">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-primary/20 text-primary text-xs font-mono font-bold mb-4 tracking-wider">
                <CalendarDays size={14} />
                NEXT NATIONAL TEAM WINDOW
              </div>
              <h1 className="text-3xl md:text-5xl font-bold tracking-tight mb-2 uppercase text-foreground">
                {dashboard.nextWindow.name}
              </h1>
              <p className="text-muted-foreground max-w-xl text-lg">
                {dashboard.nextWindow.description}
              </p>
            </div>
            
            <div className="flex flex-col items-start md:items-end p-4 bg-background/50 rounded-xl border border-border backdrop-blur">
              <span className="text-sm text-muted-foreground uppercase font-mono tracking-wider mb-1">DATES</span>
              <span className="text-xl font-bold data-value">
                {format(new Date(dashboard.nextWindow.startDate), "MMM d")} - {format(new Date(dashboard.nextWindow.endDate), "MMM d, yyyy")}
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Today's Games */}
        <Card className="col-span-1 lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-lg uppercase tracking-tight flex items-center gap-2">
                <Activity size={18} className="text-primary" />
                Upcoming Matches
              </CardTitle>
              <CardDescription>USMNT players in action</CardDescription>
            </div>
            <Link href="/fixtures" className="text-sm font-mono text-primary hover:text-primary/80 transition-colors flex items-center gap-1">
              ALL FIXTURES <ArrowUpRight size={14} />
            </Link>
          </CardHeader>
          <CardContent>
            {(() => {
              const nextGames = [...dashboard.todaysGames, ...dashboard.upcomingGames]
                .sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime())
                .slice(0, 5);

              if (nextGames.length === 0) {
                return (
                  <div className="py-8 text-center border border-dashed rounded-lg bg-muted/20">
                    <p className="text-muted-foreground font-mono text-sm">NO UPCOMING MATCHES SCHEDULED</p>
                  </div>
                );
              }

              return (
                <div className="space-y-3">
                  {nextGames.map(game => (
                    <div key={game.id} className="group relative flex flex-col gap-3 p-3 rounded-lg border bg-background hover:border-primary/50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4 w-1/3">
                          {game.homeLogoUrl && (
                            <img src={game.homeLogoUrl} alt={game.homeTeam} className="w-6 h-6 object-contain shrink-0" />
                          )}
                          <div className="text-right w-full font-medium truncate">{game.homeTeam}</div>
                        </div>
                        <div className="flex flex-col items-center justify-center px-4 w-1/4">
                          {game.status === 'live' ? (
                            <Badge variant="destructive" className="animate-pulse mb-1 rounded-sm px-1.5 py-0">LIVE</Badge>
                          ) : isToday(new Date(game.kickoff)) ? (
                            <Badge variant="default" className="mb-1 rounded-sm px-1.5 py-0 font-mono">TODAY</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground font-mono mb-1">
                              {formatKickoffMst(game.kickoff)}
                            </span>
                          )}
                          <div className="font-mono text-lg font-bold tracking-widest bg-muted px-3 py-1 rounded">
                            {game.homeScore !== null ? `${game.homeScore} - ${game.awayScore}` : 'v'}
                          </div>
                        </div>
                        <div className="flex items-center gap-4 w-1/3 justify-end">
                          <div className="w-full font-medium truncate text-right">{game.awayTeam}</div>
                          {game.awayLogoUrl && (
                            <img src={game.awayLogoUrl} alt={game.awayTeam} className="w-6 h-6 object-contain shrink-0" />
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border text-xs">
                        <div className="flex items-center gap-1.5 text-muted-foreground min-w-0">
                          <Users size={12} className="shrink-0 text-primary" />
                          <span className="truncate">
                            {game.featuredPlayers.map(p => p.name).join(", ")}
                          </span>
                        </div>
                        {game.streamingService && (
                          <div className="flex items-center gap-1.5 text-muted-foreground shrink-0">
                            <Tv size={12} className="text-secondary" />
                            <span className="font-mono">{game.streamingService}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* Top Performers */}
        <Card className="col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg uppercase tracking-tight flex items-center gap-2">
              <Trophy size={18} className="text-secondary" />
              Top Performers
            </CardTitle>
            <CardDescription>Highest rated this week</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {dashboard.topPerformers.map(player => (
                <Link key={player.id} href={`/players/${player.id}`} className="flex items-center gap-3 group">
                  <div className="w-10 h-10 rounded bg-muted flex items-center justify-center overflow-hidden border border-border group-hover:border-secondary transition-colors">
                    {player.photoUrl ? (
                      <img src={player.photoUrl} alt={player.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="font-mono text-muted-foreground text-xs">{player.name.substring(0,2)}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold truncate group-hover:text-secondary transition-colors">{player.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{player.clubName} • {player.position}</div>
                  </div>
                  <FormBadge trend={player.performanceTrend} showEmoji={false} className="mt-0" />
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Latest News */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-md uppercase tracking-tight flex items-center gap-2">
              <Newspaper size={16} className="text-muted-foreground" />
              Latest Intel
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {dashboard.latestNews.slice(0, 3).map(article => (
                <a key={article.id} href={article.url} target="_blank" rel="noreferrer" className="block group">
                  <div className="text-xs font-mono text-muted-foreground mb-1 flex items-center gap-2">
                    <span className="uppercase">{article.source}</span>
                    <span>•</span>
                    <span>{format(new Date(article.publishedAt), "MMM d")}</span>
                  </div>
                  <h4 className="font-medium text-sm group-hover:text-primary transition-colors line-clamp-2 leading-snug">
                    {article.headline}
                  </h4>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Transfers & Rumors */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-md uppercase tracking-tight flex items-center gap-2">
              <RefreshCw size={16} className="text-muted-foreground" />
              Transfer Watch
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {dashboard.transfers.slice(0, 3).map(transfer => (
                <div key={transfer.id} className="border-b border-border last:border-0 pb-3 last:pb-0">
                  <div className="flex justify-between items-start mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Link href={`/players/${transfer.player.id}`} className="font-bold text-sm hover:underline truncate">{transfer.player.name}</Link>
                      <FormBadge trend={transfer.performanceTrend} showEmoji={false} className="h-4 text-[9px] shrink-0" />
                    </div>
                    <Badge variant={transfer.status === 'confirmed' ? 'default' : 'outline'} className="text-[10px] uppercase rounded-sm px-1.5 py-0 h-4 shrink-0 ml-1">
                      {transfer.status}
                    </Badge>
                  </div>
                  <div className="text-xs flex items-center gap-1.5 text-muted-foreground">
                    <span className="truncate max-w-[100px]">{transfer.fromClub}</span>
                    <ArrowUpRight size={12} className="text-primary shrink-0" />
                    <span className="truncate max-w-[100px] text-foreground font-medium">{transfer.toClub}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Injury Updates */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-md uppercase tracking-tight flex items-center gap-2">
              <HeartPulse size={16} className="text-muted-foreground" />
              Medical Bay
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {dashboard.injuries.slice(0, 4).map(injury => (
                <div key={injury.id} className="flex items-center gap-3">
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${injury.status === 'active' ? 'bg-destructive' : injury.status === 'recovering' ? 'bg-yellow-500' : 'bg-green-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Link href={`/players/${injury.player.id}`} className="font-bold text-sm hover:underline truncate">
                          {injury.player.name}
                        </Link>
                        <FormBadge trend={injury.performanceTrend} showEmoji={false} className="h-4 text-[9px] shrink-0" />
                      </div>
                      <span className="text-xs font-mono text-muted-foreground whitespace-nowrap ml-1">
                        {injury.expectedReturn ? format(new Date(injury.expectedReturn), "MMM d") : 'TBD'}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{injury.bodyPart} • {injury.status}</div>
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
