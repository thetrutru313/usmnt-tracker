import { MapPin, MonitorPlay } from "lucide-react";
import { Link } from "wouter";
import { formatDate, formatTime } from "@/lib/formatTime";
import type { Fixture } from "@workspace/api-client-react";

/**
 * Compact match row for use inside Schedule event cards and Dashboard Hero.
 *
 * Shows: USMNT crest vs opponent, kickoff date + time, venue/city,
 * and broadcast information for scheduled/live matches.
 * Renders scores when homeScore/awayScore are present.
 * Finished/live rows link to match details; other rows are non-interactive.
 * Do not wrap this component in a parent link.
 */
export function ScheduleMatchRow({ fixture }: { fixture: Fixture }) {
  // Determine which side is USMNT so we can label "vs <Opponent>" cleanly
  const usTeamNames = ["united states", "usa", "usmnt"];
  const homeIsUS = usTeamNames.some((n) =>
    fixture.homeTeam.toLowerCase().includes(n)
  );
  const opponent = homeIsUS ? fixture.awayTeam : fixture.homeTeam;
  const usLogoUrl = homeIsUS ? fixture.homeLogoUrl : fixture.awayLogoUrl;
  const opponentLogoUrl = homeIsUS
    ? fixture.awayLogoUrl
    : fixture.homeLogoUrl;

  const hasScore =
    fixture.homeScore !== null && fixture.awayScore !== null;

  const usScore = homeIsUS ? fixture.homeScore : fixture.awayScore;
  const oppScore = homeIsUS ? fixture.awayScore : fixture.homeScore;

  const isFinished = fixture.status === "finished";
  const isLive = fixture.status === "live";
  const isLinked = isFinished || isLive;
  const broadcast = fixture.status === "scheduled" || isLive
    ? [fixture.tvNetwork, fixture.streamingService]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join(" · ")
    : "";
  const rowClassName = "flex items-center gap-3 py-2.5 border-b border-border/50 last:border-0";

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
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {/* USMNT flag */}
        {usLogoUrl && (
          <img
            src={usLogoUrl}
            alt="USMNT"
            className="w-5 h-5 object-contain shrink-0"
            aria-hidden="true"
          />
        )}

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
            {usScore}–{oppScore}
          </span>
        ) : (
          <span className="text-[10px] font-mono font-bold text-muted-foreground shrink-0 uppercase">{homeIsUS ? "vs" : "@"}</span>
        )}

        {/* Opponent logo + name */}
        {opponentLogoUrl && (
          <img
            src={opponentLogoUrl}
            alt={opponent}
            className="w-4 h-4 object-contain shrink-0"
          />
        )}
        <span className="font-semibold text-sm truncate">{opponent}</span>
      </div>

      {/* Venue stays desktop-only; broadcast is a single responsive element. */}
      <div className={`${broadcast ? "flex" : "hidden sm:flex"} flex-col items-end gap-1 text-[10px] text-muted-foreground shrink-0 max-w-[140px]`}>
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
