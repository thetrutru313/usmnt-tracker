import { useGetPlayer, useListNews } from "@workspace/api-client-react";
import { useParams } from "wouter";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowUpRight, ChevronRight, Activity, Calendar, Info, Clock, AlertTriangle, Shield, TrendingUp, TrendingDown, Minus, Loader2, ExternalLink, Newspaper, Star } from "lucide-react";
import { FormBadge } from "@/components/FormBadge";
import { PoolTierIcon } from "@/components/FixtureCard";
import { type PoolTier, POOL_TIER_STYLES } from "@/lib/poolTiers";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import { formatKickoff } from "@/lib/formatTime";
import { useMyPlayers } from "@/hooks/useMyPlayers";
import { toast } from "sonner";

const USMNT_CREST_URL = `${import.meta.env.BASE_URL}badges/usmnt-crest.png`;

/** "2025" -> "2025/2026" — the season-selector display format the rest of the club-soccer calendar uses. */
function formatSeasonLabel(season: string): string {
  const year = parseInt(season, 10);
  if (Number.isNaN(year)) return season;
  return `${year}/${year + 1}`;
}

export default function PlayerProfile() {
  const { id } = useParams<{ id: string }>();
  const playerId = parseInt(id || "0", 10);
  const [selectedSeason, setSelectedSeason] = useState<string | undefined>(undefined);
  const [selectedCycle, setSelectedCycle] = useState<string | undefined>(undefined);
  const [matchFilter, setMatchFilter] = useState<"all" | "club" | "usmnt">("all");
  const [starAnimating, setStarAnimating] = useState(false);
  const [, navigate] = useLocation();
  const { isFollowing, toggle } = useMyPlayers();

  async function handleFollowClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setStarAnimating(true);
    setTimeout(() => setStarAnimating(false), 300);
    const result = await toggle(playerId);
    if (result === "added") {
      toast("Added to My Players");
    } else {
      toast("Removed from My Players");
    }
  }

  const { data: transferNews } = useListNews(
    { playerId, category: "Transfer Rumors", limit: 3 },
    { query: { enabled: !!playerId } as any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  );

  // The generated hook's `query` option type omits `Partial<>`, so a bare
  // `{ enabled }` object doesn't structurally satisfy it even though the
  // underlying react-query call accepts it fine (queryKey/queryFn are filled
  // in by the generated `getGetPlayerQueryOptions` merge).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: player, isLoading, isFetching, error } = useGetPlayer(playerId, {
    ...(selectedSeason ? { season: selectedSeason } : {}),
    ...(selectedCycle ? { cycle: selectedCycle } : {}),
  }, {
    query: { enabled: !!playerId } as any
  });

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-64 bg-card rounded-xl border border-card-border" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="col-span-2 h-96 bg-card rounded-xl border border-card-border" />
          <div className="col-span-1 h-96 bg-card rounded-xl border border-card-border" />
        </div>
      </div>
    );
  }

  if (error || !player) {
    return (
      <div className="py-20 text-center border border-dashed rounded-lg bg-card/50">
        <p className="text-muted-foreground font-mono">PLAYER NOT FOUND OR ERROR LOADING PROFILE</p>
        <Link href="/players" className="text-primary mt-4 inline-block hover:underline">Return to Player Pool</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <Link href="/players" className="inline-flex items-center text-sm font-mono text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft size={14} className="mr-1" /> BACK TO POOL
      </Link>

      {/* Hero Profile */}
      <div className="relative overflow-hidden rounded-2xl bg-card border border-card-border shadow-lg">
        <div className="absolute top-0 right-0 w-1/3 h-full bg-gradient-to-l from-primary/10 to-transparent pointer-events-none" />
        
        <div className="p-6 md:p-8 relative z-10">
          <div className="flex flex-col md:flex-row gap-6 md:gap-8 items-start md:items-center">
            <div className="w-32 h-32 md:w-40 md:h-40 rounded-xl bg-background border-2 border-border overflow-hidden shrink-0 shadow-md">
              {player.photoUrl ? (
                <img src={player.photoUrl} alt={player.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-4xl font-bold font-mono text-muted-foreground">
                  {player.name.substring(0, 2).toUpperCase()}
                </div>
              )}
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                {(() => {
                  const tier: PoolTier = player.category === 'current' ? 'core' : player.category === 'fringe' ? 'inMix' : 'prospect';
                  const label = player.category === 'current' ? 'Core Squad' : player.category === 'fringe' ? 'In the Mix' : 'Prospect';
                  return (
                    <Badge variant="outline" className={`uppercase font-mono text-[10px] tracking-widest flex items-center gap-1 ${POOL_TIER_STYLES[tier]}`}>
                      <PoolTierIcon tier={tier} />
                      {label}
                    </Badge>
                  );
                })()}
                {player.performanceTrend && (
                  <FormBadge trend={player.performanceTrend} />
                )}
              </div>
              
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-4xl md:text-5xl font-bold tracking-tight uppercase text-foreground leading-none">
                  {player.name}
                </h1>
                {/* Follow / unfollow star button
                    ── Tap-target constraint ───────────────────────────────────
                    WCAG 2.5.5 and Apple HIG require a minimum 44×44 px tap target.
                    The min-h-[44px] min-w-[44px] classes enforce this floor.
                    Do NOT reduce these values — a Vitest test guards this threshold.
                    ─────────────────────────────────────────────────────────── */}
                <button
                  onClick={handleFollowClick}
                  aria-label={isFollowing(playerId) ? "Remove from My Players" : "Add to My Players"}
                  className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md transition-colors text-muted-foreground hover:text-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    isFollowing(playerId) ? "text-amber-400" : ""
                  } ${starAnimating ? "scale-125" : "scale-100"} transition-transform`}
                >
                  <Star
                    size={20}
                    className={isFollowing(playerId) ? "fill-amber-400 stroke-amber-400" : ""}
                  />
                </button>
              </div>
              
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
                <span className="font-medium flex items-center gap-1.5 text-foreground">
                  {player.clubLogoUrl && <img src={player.clubLogoUrl} alt={player.clubName} className="w-4 h-4" />}
                  {player.clubName} <span className="text-muted-foreground">({player.league})</span>
                </span>
                <span className="uppercase tracking-wider font-medium">{player.position}</span>
                <span>Age: {player.age}</span>
                {player.marketValueUsd && (
                  <span className="text-green-600 dark:text-green-400 font-mono">
                    ${(player.marketValueUsd / 1000000).toFixed(1)}M
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-row md:flex-col gap-4 bg-background/50 p-4 rounded-xl border border-border shrink-0 self-stretch md:self-auto justify-center">
              <div className="text-center md:text-right">
                <div className="text-xs text-muted-foreground uppercase font-mono tracking-wider mb-1">CAPS</div>
                <div className="text-2xl font-bold data-value leading-none">{player.nationalTeamCaps}</div>
              </div>
              <div className="w-px h-full md:w-full md:h-px bg-border"></div>
              <div className="text-center md:text-right">
                <div className="text-xs text-muted-foreground uppercase font-mono tracking-wider mb-1">GOALS</div>
                <div className="text-2xl font-bold data-value leading-none">{player.nationalTeamGoals}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-6 lg:col-span-2">
          {/* Club Season Stats */}
          <Card>
            <CardHeader className="pb-4 border-b">
              <CardTitle className="text-lg uppercase tracking-tight flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity size={18} className="text-primary" />
                  Club Season
                </div>
                {player.availableClubSeasons.length > 0 ? (
                  <select
                    value={player.clubSeasonStats.season}
                    onChange={(e) => setSelectedSeason(e.target.value)}
                    className="text-sm font-mono text-muted-foreground bg-background border border-border rounded px-2 py-1 cursor-pointer hover:text-foreground transition-colors"
                    aria-label="Select season"
                  >
                    {player.availableClubSeasons.map(season => (
                      <option key={season} value={season}>{formatSeasonLabel(season)}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-sm font-mono text-muted-foreground">N/A</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-border">
                <div className="p-4 flex flex-col justify-center items-center text-center">
                  <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wide mb-1">Minutes / Starts</span>
                  <span className="text-xl font-bold data-value">{player.clubSeasonStats.minutes} <span className="text-sm text-muted-foreground font-normal">/ {player.clubSeasonStats.starts}</span></span>
                </div>
                <div className="p-4 flex flex-col justify-center items-center text-center">
                  <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wide mb-1">Goals / Assists</span>
                  <span className="text-xl font-bold data-value">{player.clubSeasonStats.goals} <span className="text-sm text-muted-foreground font-normal">/ {player.clubSeasonStats.assists}</span></span>
                </div>
                <div className="p-4 flex flex-col justify-center items-center text-center">
                  <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wide mb-1">Avg Rating</span>
                  <span className="text-xl font-bold data-value text-secondary">{player.clubSeasonStats.avgRating != null ? player.clubSeasonStats.avgRating.toFixed(2) : '–'}</span>
                </div>
                <div className="p-4 flex flex-col justify-center items-center text-center">
                  <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wide mb-1">Shots / Key Passes</span>
                  <span className="text-xl font-bold data-value">{player.clubSeasonStats.shots} <span className="text-sm text-muted-foreground font-normal">/ {player.clubSeasonStats.keyPasses}</span></span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* USMNT Cycle Stats */}
          <Card>
            <CardHeader className="pb-4 border-b">
              <CardTitle className="text-lg uppercase tracking-tight flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <img src={USMNT_CREST_URL} alt="" aria-hidden="true" className="w-[18px] h-[18px] object-contain" />
                  USMNT Cycle
                </div>
                {player.availableCycles.length > 0 ? (
                  <select
                    value={player.nationalTeamStats.season}
                    onChange={(e) => setSelectedCycle(e.target.value)}
                    className="text-sm font-mono text-muted-foreground bg-background border border-border rounded px-2 py-1 cursor-pointer hover:text-foreground transition-colors"
                    aria-label="Select World Cup cycle"
                  >
                    {player.availableCycles.map(cycle => (
                      <option key={cycle} value={cycle}>{cycle}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-sm font-mono text-muted-foreground">{player.nationalTeamStats.season}</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {player.nationalTeamStats.minutes > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-border">
                  <div className="p-4 flex flex-col justify-center items-center text-center">
                    <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wide mb-1">Minutes / Starts</span>
                    <span className="text-xl font-bold data-value">{player.nationalTeamStats.minutes} <span className="text-sm text-muted-foreground font-normal">/ {player.nationalTeamStats.starts}</span></span>
                  </div>
                  <div className="p-4 flex flex-col justify-center items-center text-center">
                    <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wide mb-1">Goals / Assists</span>
                    <span className="text-xl font-bold data-value">{player.nationalTeamStats.goals} <span className="text-sm text-muted-foreground font-normal">/ {player.nationalTeamStats.assists}</span></span>
                  </div>
                  <div className="p-4 flex flex-col justify-center items-center text-center">
                    <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wide mb-1">Avg Rating</span>
                    <span className="text-xl font-bold data-value text-secondary">{player.nationalTeamStats.avgRating != null ? player.nationalTeamStats.avgRating.toFixed(2) : '–'}</span>
                  </div>
                  <div className="p-4 flex flex-col justify-center items-center text-center">
                    <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wide mb-1">Caps this cycle</span>
                    <span className="text-xl font-bold data-value">{player.nationalTeamStats.starts}</span>
                  </div>
                </div>
              ) : (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No USMNT appearances synced for this cycle yet.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Match Log */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg uppercase tracking-tight flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                Recent Matches
                <div className="flex items-center gap-1 text-xs font-mono">
                  {(["all", "club", "usmnt"] as const).map(filter => (
                    <button
                      key={filter}
                      onClick={() => setMatchFilter(filter)}
                      className={`px-2.5 py-1 rounded uppercase tracking-wider transition-colors ${
                        matchFilter === filter
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      }`}
                    >
                      {filter === "all" ? "All" : filter === "club" ? "Club" : "USMNT"}
                    </button>
                  ))}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm text-left">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase font-mono text-muted-foreground tracking-wider">
                      <th className="pb-2 font-medium hidden sm:table-cell"></th>
                      <th className="pb-2 font-medium">Date</th>
                      <th className="pb-2 font-medium">Opponent</th>
                      <th className="pb-2 font-medium hidden sm:table-cell">Comp</th>
                      <th className="pb-2 font-medium hidden sm:table-cell">Min</th>
                      <th className="pb-2 font-medium pr-4">G/A</th>
                      <th className="pb-2 font-medium text-right">Rating</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {player.matchLog
                      .filter(match => matchFilter === "all" || (matchFilter === "usmnt") === match.isNationalTeam)
                      .slice(0, 5)
                      .map(match => {
                        const fixtureId = (match as any).fixtureId as number | null | undefined;
                        const isClickable = fixtureId != null;
                        return (
                        <tr
                          key={match.id}
                          className={`hover:bg-muted/50 transition-colors ${isClickable ? "cursor-pointer" : ""}`}
                          onClick={isClickable ? () => navigate(`/matches/${fixtureId}`) : undefined}
                        >
                          <td className="py-2 pr-2 hidden sm:table-cell">
                            {match.isNationalTeam ? (
                              <img src={USMNT_CREST_URL} alt="USMNT" title="USMNT" className="w-5 h-5 object-contain" />
                            ) : player.clubLogoUrl ? (
                              <img src={player.clubLogoUrl} alt={player.clubName} title={player.clubName} className="w-5 h-5 object-contain" />
                            ) : (
                              <Shield size={16} className="text-muted-foreground" />
                            )}
                          </td>
                          <td className="py-2 text-muted-foreground font-mono whitespace-nowrap">
                            <div className="flex items-center gap-1">
                              {format(new Date(match.date), "M/d")}
                              {isClickable && (
                                <ArrowUpRight size={11} className="text-muted-foreground/50 shrink-0" />
                              )}
                            </div>
                          </td>
                          <td className="py-2 font-medium">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className={`shrink-0 ${match.result === 'W' ? 'text-green-500' : match.result === 'L' ? 'text-destructive' : 'text-yellow-500'}`}>{match.result}</span>
                              <span className="truncate">{match.opponent}</span>
                            </div>
                          </td>
                          <td className="py-2 text-muted-foreground text-xs hidden sm:table-cell">{match.competition}</td>
                          <td className="py-2 font-mono hidden sm:table-cell">{match.minutes}'</td>
                          <td className="py-2 font-mono">
                            {match.goals > 0 && <span className="text-primary mr-1">{match.goals}G</span>}
                            {match.assists > 0 && <span className="text-secondary">{match.assists}A</span>}
                            {match.goals === 0 && match.assists === 0 && <span className="text-muted-foreground">-</span>}
                          </td>
                          <td className="py-2 text-right font-bold data-value">
                            {match.rating != null ? (
                              <span className={match.rating >= 7.5 ? 'text-secondary' : match.rating <= 6.0 ? 'text-destructive' : ''}>
                                {match.rating.toFixed(1)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">–</span>
                            )}
                          </td>
                        </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Status / Injuries */}
          {player.injuries && player.injuries.length > 0 && (
            <Card className="border-destructive/50 bg-destructive/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-md uppercase tracking-tight flex items-center gap-2 text-destructive">
                  <AlertTriangle size={16} />
                  Medical Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {player.injuries.filter(i => i.status === 'active' || i.status === 'recovering').map(injury => (
                    <div key={injury.id}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-bold">{injury.bodyPart}</span>
                        <Badge variant="outline" className="text-[10px] uppercase font-mono text-destructive border-destructive">{injury.status}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">Since {format(new Date(injury.startDate), "MMM d")} • Missed {injury.matchesMissed} matches</p>
                      {injury.expectedReturn && (
                        <div className="bg-background rounded p-2 text-xs border border-destructive/20 flex items-center gap-2">
                          <Clock size={12} className="text-muted-foreground" />
                          Expected return: <span className="font-bold">{format(new Date(injury.expectedReturn), "MMM d, yyyy")}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Form Breakdown */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-md uppercase tracking-tight flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Activity size={16} className="text-muted-foreground" />
                  Club Form Breakdown
                </div>
                <span className="text-[10px] font-mono text-muted-foreground normal-case tracking-normal flex items-center gap-1">
                  {isFetching && <Loader2 size={10} className="animate-spin" />}
                  {formatSeasonLabel(selectedSeason ?? player.clubSeasonStats.season)}
                </span>
              </CardTitle>
              {player.performanceTrend && (
                <div className="mt-1">
                  <FormBadge trend={player.performanceTrend} />
                </div>
              )}
            </CardHeader>
            <CardContent className="relative">
              {isFetching && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-b-xl bg-background/60 backdrop-blur-[1px]">
                  <Loader2 size={20} className="animate-spin text-muted-foreground" />
                </div>
              )}
              {player.last5Stats.minutes >= 270 && player.last5Stats.avgRating != null && player.seasonStats.avgRating != null ? (
                (() => {
                  const last5Avg = player.last5Stats.avgRating!;
                  const seasonAvg = player.seasonStats.avgRating!;
                  const delta = last5Avg - seasonAvg;
                  const deltaPositive = delta > 0.005;
                  const deltaNegative = delta < -0.005;

                  const prev5Avg = player.previous5Stats?.avgRating ?? null;
                  const hasPrev5 = prev5Avg != null && (player.previous5Stats?.minutes ?? 0) > 0;
                  const trendDelta = hasPrev5 ? last5Avg - prev5Avg! : null;
                  const trendPositive = trendDelta != null && trendDelta > 0.005;
                  const trendNegative = trendDelta != null && trendDelta < -0.005;

                  return (
                    <div className="space-y-3">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Last-5 avg rating</span>
                        <span className="font-bold data-value text-secondary">{last5Avg.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Season avg rating</span>
                        <span className="font-medium">{seasonAvg.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm pt-2 border-t border-border">
                        <span className="text-muted-foreground">vs season baseline</span>
                        <span className={`font-bold flex items-center gap-1 ${deltaPositive ? 'text-green-500' : deltaNegative ? 'text-destructive' : 'text-muted-foreground'}`}>
                          {deltaPositive ? <TrendingUp size={14} /> : deltaNegative ? <TrendingDown size={14} /> : <Minus size={14} />}
                          {deltaPositive ? "+" : ""}{delta.toFixed(2)}
                        </span>
                      </div>
                      {hasPrev5 && (
                        <>
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-muted-foreground">Prior-5 avg rating</span>
                            <span className="font-medium">{prev5Avg!.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between items-center text-sm pt-2 border-t border-border">
                            <span className="text-muted-foreground">vs prior 5 games</span>
                            <span className={`font-bold flex items-center gap-1 ${trendPositive ? 'text-green-500' : trendNegative ? 'text-destructive' : 'text-muted-foreground'}`}>
                              {trendPositive ? <TrendingUp size={14} /> : trendNegative ? <TrendingDown size={14} /> : <Minus size={14} />}
                              {trendPositive ? "+" : ""}{trendDelta!.toFixed(2)}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()
              ) : (
                <p className="text-sm text-muted-foreground">Not enough minutes for form data</p>
              )}
            </CardContent>
          </Card>

          {/* Bio & Details */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-md uppercase tracking-tight flex items-center gap-2">
                <Info size={16} className="text-muted-foreground" />
                Player Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed mb-4 text-muted-foreground">
                {player.bio}
              </p>
              
              <div className="space-y-3 pt-4 border-t border-border">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Contract Until</span>
                  <span className="font-medium">{player.contractUntil ? format(new Date(player.contractUntil), "MMM yyyy") : 'Unknown'}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Youth NT</span>
                  <span className="font-medium">{player.youthNationalTeam || 'None'}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Senior Debut</span>
                  <span className="font-medium">{player.debutDate ? format(new Date(player.debutDate), "MMM yyyy") : 'Not capped'}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Transfer News */}
          {transferNews && transferNews.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-md uppercase tracking-tight flex items-center gap-2">
                  <Newspaper size={16} className="text-muted-foreground" />
                  Transfer News
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {transferNews.map(article => (
                    <a
                      key={article.id}
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start justify-between gap-2 px-4 py-3 hover:bg-muted/30 transition-colors group"
                    >
                      <div className="flex-1 min-w-0 space-y-1">
                        <p className="text-xs font-medium leading-snug group-hover:text-primary transition-colors line-clamp-2">
                          {article.headline}
                        </p>
                        <p className="text-[10px] font-mono text-muted-foreground">
                          {article.source} · {format(new Date(article.publishedAt), "MMM d")}
                        </p>
                      </div>
                      <ExternalLink size={12} className="text-muted-foreground shrink-0 mt-0.5 group-hover:text-primary transition-colors" />
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Upcoming Fixtures */}
          {player.upcomingFixtures && player.upcomingFixtures.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-md uppercase tracking-tight flex items-center gap-2">
                  <Calendar size={16} className="text-muted-foreground" />
                  Upcoming Matches
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {player.upcomingFixtures.slice(0, 3).map(fixture => (
                    <div key={fixture.id} className="flex flex-col gap-1 p-2 rounded bg-muted/30 border border-border">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-mono uppercase text-muted-foreground">{formatKickoff(fixture.kickoff)}</span>
                        <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">{fixture.competition}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm font-medium">
                        <span className="truncate w-1/3">{fixture.homeTeam}</span>
                        <span className="text-muted-foreground text-xs font-mono px-2">v</span>
                        <span className="truncate w-1/3 text-right">{fixture.awayTeam}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
