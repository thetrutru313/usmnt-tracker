import { MapPin, MonitorPlay } from "lucide-react";
import { Link } from "wouter";
import { formatDate, formatTime } from "@/lib/formatTime";
import type { Fixture } from "@workspace/api-client-react";

/**
 * Compact match row for use inside Schedule event cards and Dashboard Hero.
 *
 * Shows home flag/name, vs (or a home–away score), then away flag/name,
 * alongside kickoff date/time, venue/city, and scheduled/live broadcasts.
 * Both flags are 20px; names truncate independently. On narrow screens,
 * broadcast occupies its own untruncated line below the matchup.
 * Live/finished scores retain their LIVE / FT prefixes.
 * Finished/live rows link to match details; other rows are non-interactive.
 * Do not wrap this component in a parent link.
 */
export function ScheduleMatchRow({ fixture }: { fixture: Fixture }) {
  const hasScore =
    fixture.homeScore !== null && fixture.awayScore !== null;

  const isFinished = fixture.status === "finished";
  const isLive = fixture.status === "live";
  const isLinked = isFinished || isLive;
  const broadcast = fixture.status === "scheduled" || isLive
    ? [fixture.tvNetwork, fixture.streamingService]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join(" · ")
    : "";
  const rowClassName = "grid grid-cols-[4rem_minmax(0,1fr)] sm:grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5 border-b border-border/50 last:border-0";

  const content = (
    <>
      {/* Date column */}
      <div className="w-16 shrink-0 text-center">
        <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider leading-none mb-0.5">
          {formatDate(fixture.kickoff)}
        </div>
        <div className="text-[10px] font-mono text-muted-foreground">
          {fixture.kickoffTimeTbd ? "Time TBD" : formatTime(fixture.kickoff)}
        </div>
      </div>

      {/* Match info */}
      <div className="min-w-0 flex items-center gap-2">
        {/* Home flag + independently truncating name */}
        <div className="flex-1 min-w-0 flex items-center gap-1">
          {fixture.homeLogoUrl && (
            <img
              src={fixture.homeLogoUrl}
              alt={fixture.homeTeam}
              className="w-5 h-5 object-contain shrink-0"
            />
          )}
          <span className="font-semibold text-sm truncate">{fixture.homeTeam}</span>
        </div>

        {/* Score or "vs" label */}
        {hasScore ? (
          <span className={`text-xs font-mono font-bold shrink-0 px-1.5 py-0.5 rounded ${
            isLive
              ? "bg-destructive/20 text-destructive"
              : isFinished
              ? "bg-muted text-foreground"
              : "text-muted-foreground"
          }`}>
            {isLive ? "LIVE · " : isFinished ? "FT · " : ""}
            {fixture.homeScore}–{fixture.awayScore}
          </span>
        ) : (
          <span className="text-[10px] font-mono font-bold text-muted-foreground shrink-0 uppercase">vs</span>
        )}

        {/* Away flag + independently truncating name */}
        <div className="flex-1 min-w-0 flex items-center gap-1">
          {fixture.awayLogoUrl && (
            <img
              src={fixture.awayLogoUrl}
              alt={fixture.awayTeam}
              className="w-5 h-5 object-contain shrink-0"
            />
          )}
          <span className="font-semibold text-sm truncate">{fixture.awayTeam}</span>
        </div>
      </div>

      {/* Venue stays desktop-only; broadcast is a single responsive element. */}
      <div className={`${broadcast ? "flex" : "hidden sm:flex"} col-span-2 sm:col-span-1 justify-self-end flex-col items-end gap-1 text-[10px] text-muted-foreground shrink-0 max-w-[140px]`}>
        <div className="hidden sm:flex items-center gap-1 max-w-full">
          <MapPin size={10} className="shrink-0" />
          <span className="truncate">
            {fixture.city ? fixture.city : fixture.venue}
          </span>
        </div>
        {broadcast && (
          <div data-testid="match-row-broadcast" className="flex items-center justify-end gap-1 whitespace-nowrap">
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
