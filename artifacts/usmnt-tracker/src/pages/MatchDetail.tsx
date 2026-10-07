import { useGetFixture } from "@workspace/api-client-react";
import { fixtureRefetchInterval, LIVE_POLL_INTERVAL } from "@/lib/livePolling";
import { useParams } from "wouter";
import { Link } from "wouter";
import { ArrowLeft, MapPin, Clock, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import type { FixtureTrackedPlayer } from "@workspace/api-client-react";

const USMNT_CREST_URL = `${import.meta.env.BASE_URL}badges/usmnt-crest.png`;

function ScoreBlock({
  homeTeam,
  awayTeam,
  homeLogoUrl,
  awayLogoUrl,
  homeScore,
  awayScore,
  status,
  elapsedMinute,
}: {
  homeTeam: string;
  awayTeam: string;
  homeLogoUrl: string | null;
  awayLogoUrl: string | null;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  elapsedMinute?: number | null;
}) {
  const scoreDisplay =
    status === "finished"
      ? `${homeScore} – ${awayScore}`
      : status === "live"
        ? `${homeScore} – ${awayScore}`
        : "vs";

  return (
    <div className="flex items-center justify-center gap-4 md:gap-8 py-4">
      {/* Home */}
      <div className="flex flex-col items-center gap-2 min-w-0 flex-1 max-w-[140px]">
        <div className="w-16 h-16 flex items-center justify-center">
          {homeLogoUrl ? (
            <img src={homeLogoUrl} alt={homeTeam} className="w-full h-full object-contain" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center text-xs font-mono text-muted-foreground">
              {homeTeam.substring(0, 3).toUpperCase()}
            </div>
          )}
        </div>
        <span className="font-bold text-center text-sm leading-snug line-clamp-2">{homeTeam}</span>
      </div>

      {/* Score / Status */}
      <div className="flex flex-col items-center gap-1 shrink-0">
        {status === "live" && (
          <span className="inline-flex items-center gap-1.5 mb-1">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive" />
            </span>
            <span className="text-[10px] font-bold font-mono text-destructive tracking-widest uppercase">
              LIVE{elapsedMinute != null ? ` ${elapsedMinute}'` : ""}
            </span>
          </span>
        )}
        <span className="text-3xl md:text-4xl font-bold font-mono tracking-tight">
          {scoreDisplay}
        </span>
        {status === "live" && (
          <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-mono text-muted-foreground tracking-wide">
            <RefreshCw size={9} className="animate-spin" style={{ animationDuration: "3s" }} />
            updating every {LIVE_POLL_INTERVAL / 1000}s
          </span>
        )}
        {status === "finished" && (
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Full Time</span>
        )}
        {status === "postponed" && (
          <Badge variant="outline" className="text-[10px] border-destructive text-destructive">POSTPONED</Badge>
        )}
        {status === "scheduled" && (
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Scheduled</span>
        )}
      </div>

      {/* Away */}
      <div className="flex flex-col items-center gap-2 min-w-0 flex-1 max-w-[140px]">
        <div className="w-16 h-16 flex items-center justify-center">
          {awayLogoUrl ? (
            <img src={awayLogoUrl} alt={awayTeam} className="w-full h-full object-contain" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center text-xs font-mono text-muted-foreground">
              {awayTeam.substring(0, 3).toUpperCase()}
            </div>
          )}
        </div>
        <span className="font-bold text-center text-sm leading-snug line-clamp-2">{awayTeam}</span>
      </div>
    </div>
  );
}

function RatingBadge({ rating }: { rating: number | null }) {
  if (rating == null) return <span className="text-muted-foreground">–</span>;
  const cls =
    rating >= 7.5
      ? "text-secondary font-bold"
      : rating <= 6.0
        ? "text-destructive font-bold"
        : "font-bold";
  return <span className={cls}>{rating.toFixed(1)}</span>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function PlayerRow({
  player,
  showConceded,
}: {
  player: FixtureTrackedPlayer;
  showConceded: boolean;
}) {
  const ml = player.matchLog;

  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
      {/* Player */}
      <td className="py-3 pr-3">
        <Link
          href={`/players/${player.id}`}
          className="flex items-center gap-2.5 group min-w-0"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-8 h-8 rounded bg-muted overflow-hidden border border-border shrink-0 group-hover:border-primary transition-colors">
            {player.photoUrl ? (
              <img src={player.photoUrl} alt={player.name} className="w-full h-full object-cover" />
            ) : (
              <span className="w-full h-full flex items-center justify-center text-[10px] font-mono text-muted-foreground">
                {player.name.substring(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <div className="font-medium text-sm group-hover:text-primary transition-colors truncate">
              {player.name}
            </div>
            <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-wide flex items-center gap-1.5">
              {player.clubLogoUrl && (
                <img src={player.clubLogoUrl} alt="" aria-hidden className="w-3 h-3 object-contain" />
              )}
              {player.position}
            </div>
          </div>
        </Link>
      </td>

      {/* Stats */}
      {ml ? (
        <>
          <td className="py-3 px-2 text-center font-mono text-sm">{ml.minutes}'</td>
          <td className="py-3 px-2 text-center font-mono text-sm">
            {ml.goals > 0 ? <span className="text-primary font-bold">{ml.goals}</span> : <span className="text-muted-foreground">0</span>}
          </td>
          <td className="py-3 px-2 text-center font-mono text-sm">
            {ml.assists > 0 ? <span className="text-secondary font-bold">{ml.assists}</span> : <span className="text-muted-foreground">0</span>}
          </td>
          {showConceded && (
            <td className="py-3 px-2 text-center font-mono text-sm text-muted-foreground">
              {ml.conceded != null ? ml.conceded : "–"}
            </td>
          )}
          <td className="py-3 pl-2 text-right">
            <RatingBadge rating={ml.rating} />
          </td>
        </>
      ) : (
        <td
          colSpan={showConceded ? 5 : 4}
          className="py-3 px-2 text-center"
        >
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
            <Loader2 size={11} className="animate-spin" />
            stats pending
          </span>
        </td>
      )}
    </tr>
  );
}

export default function MatchDetail() {
  const { id } = useParams<{ id: string }>();
  const fixtureId = parseInt(id || "0", 10);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: fixture, isLoading, error } = useGetFixture(fixtureId, { query: { enabled: !!fixtureId, refetchInterval: (query: any) => fixtureRefetchInterval(query.state.data) } as any });

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse max-w-3xl mx-auto">
        <div className="h-6 w-32 bg-muted rounded" />
        <div className="h-48 bg-card rounded-xl border border-card-border" />
        <div className="h-64 bg-card rounded-xl border border-card-border" />
      </div>
    );
  }

  if (error || !fixture) {
    return (
      <div className="py-20 text-center border border-dashed rounded-lg bg-card/50 max-w-3xl mx-auto">
        <p className="text-muted-foreground font-mono text-sm">FIXTURE NOT FOUND</p>
        <Link href="/fixtures" className="text-primary mt-4 inline-block hover:underline text-sm">
          ← Back to fixtures
        </Link>
      </div>
    );
  }

  const players = fixture.trackedPlayers ?? [];
  const hasConceded = players.some((p) => p.matchLog?.conceded != null);
  // After 3 hours from kickoff the post-match pipeline has definitely had a
  // chance to run (daily sync + 35-min post-match delay), so a missing match
  // log means the player did not feature — not that stats are still incoming.
  const statsSettled =
    fixture.status === "finished" &&
    Date.now() > new Date(fixture.kickoff).getTime() + 3 * 60 * 60 * 1000;

  return (
    <div className="space-y-6 pb-10 max-w-3xl mx-auto">
      <Link
        href="/fixtures"
        className="inline-flex items-center text-sm font-mono text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft size={14} className="mr-1" /> BACK TO FIXTURES
      </Link>

      {/* Match header card */}
      <Card className="overflow-hidden">
        <div className="bg-muted/20 px-6 pt-5 pb-2">
          <div className="flex flex-wrap items-center justify-center gap-2 mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-primary">
              {fixture.competition}
            </span>
            {fixture.isNationalTeam && (
              <Badge variant="default" className="h-4 text-[9px] px-1 py-0">
                INTERNATIONAL
              </Badge>
            )}
          </div>

          <ScoreBlock
            homeTeam={fixture.homeTeam}
            awayTeam={fixture.awayTeam}
            homeLogoUrl={fixture.homeLogoUrl}
            awayLogoUrl={fixture.awayLogoUrl}
            homeScore={fixture.homeScore}
            awayScore={fixture.awayScore}
            status={fixture.status}
            elapsedMinute={fixture.elapsedMinute}
          />
        </div>

        <div className="border-t border-border px-6 py-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Clock size={12} />
            {fixture.kickoffTimeTbd
              ? `${format(new Date(fixture.kickoff), "EEEE, MMMM d, yyyy")} · Time TBD`
              : format(new Date(fixture.kickoff), "EEEE, MMMM d, yyyy · h:mm a")}
          </span>
          <span className="flex items-center gap-1.5">
            <MapPin size={12} />
            {fixture.venue}
          </span>
        </div>
      </Card>

      {/* Tracked players */}
      <Card>
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-base uppercase tracking-tight flex items-center gap-2">
            <img src={USMNT_CREST_URL} alt="" aria-hidden className="w-4 h-4 object-contain" />
            USMNT Tracked Players
            <span className="ml-auto text-xs font-mono font-normal text-muted-foreground normal-case tracking-normal">
              {players.filter((p) => p.matchLog).length} / {players.length}{" "}
              {statsSettled ? "featured" : "synced"}
            </span>
          </CardTitle>
        </CardHeader>

        <CardContent className="p-0">
          {players.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground font-mono">
              NO TRACKED PLAYERS LINKED TO THIS FIXTURE
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase font-mono text-muted-foreground tracking-wider">
                    <th className="px-4 py-2 font-medium text-left">Player</th>
                    <th className="px-2 py-2 font-medium text-center">Min</th>
                    <th className="px-2 py-2 font-medium text-center">G</th>
                    <th className="px-2 py-2 font-medium text-center">A</th>
                    {hasConceded && <th className="px-2 py-2 font-medium text-center">Con</th>}
                    <th className="pl-2 pr-4 py-2 font-medium text-right">Rating</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border px-4">
                  {players.map((player) => (
                    <tr key={player.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      {/* Player cell */}
                      <td className="py-3 pl-4 pr-3">
                        <Link
                          href={`/players/${player.id}`}
                          className="flex items-center gap-2.5 group min-w-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="w-8 h-8 rounded bg-muted overflow-hidden border border-border shrink-0 group-hover:border-primary transition-colors">
                            {player.photoUrl ? (
                              <img src={player.photoUrl} alt={player.name} className="w-full h-full object-cover" />
                            ) : (
                              <span className="w-full h-full flex items-center justify-center text-[10px] font-mono text-muted-foreground">
                                {player.name.substring(0, 2).toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-sm group-hover:text-primary transition-colors truncate">
                              {player.name}
                            </div>
                            <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-wide flex items-center gap-1.5">
                              {player.clubLogoUrl && (
                                <img src={player.clubLogoUrl} alt="" aria-hidden className="w-3 h-3 object-contain" />
                              )}
                              {player.position}
                            </div>
                          </div>
                        </Link>
                      </td>

                      {/* Stats or pending */}
                      {player.matchLog ? (
                        <>
                          <td className="py-3 px-2 text-center font-mono text-sm">{player.matchLog.minutes}'</td>
                          <td className="py-3 px-2 text-center font-mono text-sm">
                            {player.matchLog.goals > 0
                              ? <span className="text-primary font-bold">{player.matchLog.goals}</span>
                              : <span className="text-muted-foreground">0</span>}
                          </td>
                          <td className="py-3 px-2 text-center font-mono text-sm">
                            {player.matchLog.assists > 0
                              ? <span className="text-secondary font-bold">{player.matchLog.assists}</span>
                              : <span className="text-muted-foreground">0</span>}
                          </td>
                          {hasConceded && (
                            <td className="py-3 px-2 text-center font-mono text-sm text-muted-foreground">
                              {player.matchLog.conceded != null ? player.matchLog.conceded : "–"}
                            </td>
                          )}
                          <td className="py-3 pl-2 pr-4 text-right">
                            <RatingBadge rating={player.matchLog.rating} />
                          </td>
                        </>
                      ) : fixture.status === "scheduled" ? (
                        <td colSpan={hasConceded ? 5 : 4} />
                      ) : statsSettled ? (
                        // Stats pipeline has had time to run; absent log = did not feature.
                        <td colSpan={hasConceded ? 5 : 4} className="py-3 pr-4 text-center">
                          <span className="text-xs text-muted-foreground font-mono">—</span>
                        </td>
                      ) : (
                        // Recently finished — sync may still be in-flight.
                        <td colSpan={hasConceded ? 5 : 4} className="py-3 pr-4 text-center">
                          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                            <Loader2 size={11} className="animate-spin" />
                            stats pending
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
