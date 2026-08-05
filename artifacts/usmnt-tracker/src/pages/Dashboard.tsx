import { useGetDashboard, getGetDashboardQueryKey, type DashboardSummary } from "@workspace/api-client-react";
import { dashboardRefetchInterval } from "@/lib/livePolling";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FormBadge } from "@/components/FormBadge";
import { FixtureCard } from "@/components/FixtureCard";
import { ScheduleMatchRow } from "@/components/ScheduleMatchRow";
import { Trophy, CalendarDays, RefreshCw, HeartPulse, Newspaper, ArrowUpRight, ChevronRight } from "lucide-react";
import soccerBall from "@/assets/soccer-ball.png";
import { Link } from "wouter";
import { format } from "date-fns";
import { KIND_LABELS, KIND_COLORS, STATUS_COLORS, STATUS_LABELS, type EventKind, type EventStatus } from "@/data/schedule";

export default function Dashboard() {
  const { data: dashboard, isLoading, error } = useGetDashboard({
    query: {
      queryKey: getGetDashboardQueryKey(),
      refetchInterval: (query): number | false =>
        dashboardRefetchInterval(query.state.data as DashboardSummary | undefined),
    },
  });

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

  const nextEvent = dashboard.nextScheduleEvent;

  // Away-jersey star pattern — positions/sizes mirror the jersey's scattered grid
  const JERSEY_STARS = [
    // row 1
    { x: "2%",  y: "-18%", s: 64 }, { x: "15%", y: "5%",   s: 72 }, { x: "29%", y: "-12%", s: 60 },
    { x: "43%", y: "10%",  s: 68 }, { x: "57%", y: "-8%",  s: 64 }, { x: "71%", y: "8%",   s: 70 },
    { x: "85%", y: "-14%", s: 62 }, { x: "96%", y: "6%",   s: 58 },
    // row 2
    { x: "8%",  y: "48%",  s: 70 }, { x: "22%", y: "60%",  s: 62 }, { x: "36%", y: "44%",  s: 74 },
    { x: "50%", y: "56%",  s: 66 }, { x: "64%", y: "42%",  s: 68 }, { x: "78%", y: "58%",  s: 62 },
    { x: "91%", y: "46%",  s: 70 },
    // row 3 (bleeds off bottom edge)
    { x: "3%",  y: "88%",  s: 66 }, { x: "18%", y: "100%", s: 70 }, { x: "33%", y: "85%",  s: 60 },
    { x: "47%", y: "98%",  s: 68 }, { x: "61%", y: "82%",  s: 64 }, { x: "75%", y: "96%",  s: 72 },
    { x: "89%", y: "86%",  s: 62 },
  ];

  return (
    <div className="space-y-8 pb-10">
      {/* Next Window Hero — USMNT away jersey theme */}
      {nextEvent && (
        <Link href="/schedule">
          <section className="relative overflow-hidden rounded-2xl bg-[#001a3a] border border-[#002868] border-t-2 border-t-red-600 shadow-xl cursor-pointer hover:brightness-110 transition-all group">
            {/* Jersey star layer */}
            <div className="absolute inset-0 pointer-events-none select-none" aria-hidden="true">
              {JERSEY_STARS.map((star, i) => (
                <svg
                  key={i}
                  viewBox="0 0 100 100"
                  style={{ position: "absolute", left: star.x, top: star.y, width: star.s, height: star.s, opacity: 0.13 }}
                >
                  <polygon points="50,5 61,35 95,35 68,57 79,91 50,70 21,91 32,57 5,35 39,35" fill="white" />
                </svg>
              ))}
            </div>

            <div className="p-6 md:p-8 relative z-10">
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-4">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-primary/20 text-primary text-xs font-mono font-bold tracking-wider">
                      <CalendarDays size={14} />
                      NEXT UP
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded border font-medium ${KIND_COLORS[nextEvent.kind as EventKind]}`}>
                      {KIND_LABELS[nextEvent.kind as EventKind]}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${STATUS_COLORS[nextEvent.status as EventStatus]}`}>
                      {STATUS_LABELS[nextEvent.status as EventStatus]}
                    </span>
                  </div>
                  <h1 className="text-2xl md:text-5xl font-bold tracking-tight mb-2 uppercase text-foreground">
                    {nextEvent.name}
                  </h1>

                  {/* When fixtures are available, show match tiles; otherwise show description */}
                  {nextEvent.fixtures && nextEvent.fixtures.length > 0 ? (
                    <div className="mt-3 bg-background/20 rounded-xl border border-border/40 backdrop-blur divide-y divide-border/30 overflow-hidden max-w-xl">
                      {nextEvent.fixtures.map((fixture) => (
                        <div key={fixture.id} className="px-3">
                          <ScheduleMatchRow fixture={fixture} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground max-w-xl text-sm md:text-lg">
                      {nextEvent.description}
                    </p>
                  )}
                </div>

                <div className="flex flex-col items-start md:items-end gap-4 shrink-0">
                  {/* Show date box only when no fixtures */}
                  {(!nextEvent.fixtures || nextEvent.fixtures.length === 0) && (
                    <div className="p-4 bg-background/50 rounded-xl border border-border backdrop-blur">
                      <span className="text-xs text-muted-foreground uppercase font-mono tracking-wider block mb-1">
                        {(nextEvent.status as EventStatus) === "confirmed" ? "Dates" : (nextEvent.status as EventStatus) === "approximate" ? "Approx." : "TBD"}
                      </span>
                      <span className="text-xl font-bold data-value">{nextEvent.dateLabel}</span>
                    </div>
                  )}
                  <div className="inline-flex items-center gap-1 text-xs font-mono font-bold text-primary group-hover:gap-2 transition-all">
                    VIEW FULL SCHEDULE <ChevronRight size={13} />
                  </div>
                </div>
              </div>
            </div>
          </section>
        </Link>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Today's Games */}
        <Card className="col-span-1 lg:col-span-2">
          <CardHeader className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between pb-2">
            <div>
              <CardTitle className="text-base md:text-lg uppercase tracking-tight flex items-center gap-2">
                <img src={soccerBall} alt="" aria-hidden="true" style={{ width: 18, height: 18 }} />
                Upcoming Matches
              </CardTitle>
              <CardDescription>USMNT players in action</CardDescription>
            </div>
            <Link href="/fixtures" className="text-sm font-mono text-primary hover:text-primary/80 transition-colors flex items-center gap-1 whitespace-nowrap shrink-0">
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
                    <FixtureCard key={game.id} fixture={game} showDate />
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
