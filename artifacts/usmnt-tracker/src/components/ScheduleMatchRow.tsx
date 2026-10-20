import { MapPin, MonitorPlay } from "lucide-react";
import { Link } from "wouter";
import { formatDate, formatTime } from "@/lib/formatTime";
import { useLiveElapsedMinute } from "@/hooks/useLiveElapsedMinute";
import type { Fixture } from "@workspace/api-client-react";

/**
 * Compact match row for use inside Schedule event cards and Dashboard Hero.
 *
 * Date column: date, then one nowrap status line (time+zone / Time TBD /
 * LIVE + minute / FT / PPD).
 * sm and up: teams mirrored around a fixed-width centre ("vs" or score pill).
 * Below sm: line 1 is date · status (left) and broadcast (right); line 2 is
 * the same mirrored teams grid spanning the full width.
 * Finished losers are muted; draws, live and scheduled stay full colour.
 * Broadcast renders exactly once (meta line right on mobile, right column on sm+).
 * Finished/live rows link to match details; other rows are non-interactive.
 * Do not wrap this component in a parent link.
 */
export function ScheduleMatchRow({ fixture }: { fixture: Fixture }) {
  const hasScore = fixture.homeScore !== null && fixture.awayScore !== null;
  const isFinished = fixture.status === "finished";
  const isLive = fixture.status === "live";
  const isPostponed = fixture.status === "postponed";
  const isLinked = isFinished || isLive;
  const liveMinute = useLiveElapsedMinute(fixture.elapsedMinute, isLive);

  const broadcast = fixture.status === "scheduled" || isLive
    ? [fixture.tvNetwork, fixture.streamingService]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join(" · ")
    : "";

  const homeLost = isFinished && hasScore && fixture.homeScore! < fixture.awayScore!;
  const awayLost = isFinished && hasScore && fixture.awayScore! < fixture.homeScore!;
  const homeTone = homeLost ? "text-muted-foreground" : "text-foreground";
  const awayTone = awayLost ? "text-muted-foreground" : "text-foreground";

  const rowClassName =
    "grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[4.75rem_minmax(0,1fr)_8.5rem] items-center gap-x-3 gap-y-1 px-3 py-2 border-b border-border/50 last:border-0";

  const statusLine = isLive ? (
    <div className="text-[10px] font-mono font-bold text-destructive whitespace-nowrap">
      {liveMinute != null ? `LIVE ${liveMinute}'` : "LIVE"}
    </div>
  ) : isFinished ? (
    <div className="text-[10px] font-mono font-bold text-muted-foreground">FT</div>
  ) : isPostponed ? (
    <div className="text-[10px] font-mono font-bold text-muted-foreground">PPD</div>
  ) : (
    <div className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
      {fixture.kickoffTimeTbd ? "Time TBD" : formatTime(fixture.kickoff)}
    </div>
  );

  const flag = (src: string | null, alt: string) =>
    src ? <img src={src} alt={alt} className="w-5 h-5 object-contain shrink-0" /> : <span className="w-5 h-5 shrink-0" />;

  const content = (
    <>
      {/* Date column */}
      <div data-testid="match-row-date" className="flex items-baseline gap-1 whitespace-nowrap sm:block sm:whitespace-normal self-center text-left">
        <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider leading-none mb-0.5">
          {formatDate(fixture.kickoff)}
        </div>
        <span aria-hidden="true" className="sm:hidden text-[10px] font-mono text-muted-foreground leading-none">{" · "}</span>
        {statusLine}
      </div>

      {/* Teams */}
      <div data-testid="match-row-mobile" className="min-w-0 col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
        {/* sm and up: [home 1fr][centre fixed][away 1fr] */}
        <div data-testid="match-row-desktop" className="grid grid-cols-[minmax(0,1fr)_3.5rem_minmax(0,1fr)] items-center gap-2">
          <div className="min-w-0 flex items-center justify-end gap-1.5">
            <span className={`font-semibold text-sm truncate ${homeTone}`}>{fixture.homeTeam}</span>
            {flag(fixture.homeLogoUrl, fixture.homeTeam)}
          </div>
          <div data-testid="match-row-center" className="flex justify-center">
            {hasScore ? (
              <span className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${
                isLive ? "bg-destructive/20 text-destructive"
                  : isFinished ? "bg-muted text-foreground" : "text-muted-foreground"
              }`}>
                <span data-testid="match-row-home-score" className={isLive ? "" : homeTone}>{fixture.homeScore}</span>
                –
                <span data-testid="match-row-away-score" className={isLive ? "" : awayTone}>{fixture.awayScore}</span>
              </span>
            ) : (
              <span className="text-[10px] font-mono font-bold text-muted-foreground uppercase">vs</span>
            )}
          </div>
          <div className="min-w-0 flex items-center gap-1.5">
            {flag(fixture.awayLogoUrl, fixture.awayTeam)}
            <span className={`font-semibold text-sm truncate ${awayTone}`}>{fixture.awayTeam}</span>
          </div>
        </div>
      </div>

      {/* Meta: venue (sm+ only) above the single broadcast element */}
      <div className={`${broadcast ? "flex" : "hidden sm:flex"} col-start-2 row-start-1 sm:col-start-3 sm:row-start-auto min-w-0 flex-col items-end gap-1 text-[10px] text-muted-foreground`}>
        <div className="hidden sm:flex items-center justify-end gap-1 max-w-full min-w-0">
          <MapPin size={10} className="shrink-0" />
          <span className="truncate">{fixture.city ? fixture.city : fixture.venue}</span>
        </div>
        {broadcast && (
          <div data-testid="match-row-broadcast" className="flex items-center sm:justify-end gap-1 whitespace-nowrap">
            <MonitorPlay size={10} className="shrink-0" />
            <span>{broadcast}</span>
          </div>
        )}
      </div>
    </>
  );

  return isLinked ? (
    <Link
      href={`/matches/${fixture.id}`}
      aria-label={`${fixture.homeTeam} vs ${fixture.awayTeam} — match details`}
      className={`${rowClassName} cursor-pointer hover:bg-primary/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary`}
    >
      {content}
    </Link>
  ) : (
    <div className={rowClassName}>{content}</div>
  );
}
