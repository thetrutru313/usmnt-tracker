import { MapPin } from "lucide-react";
import { formatDate, formatTime } from "@/lib/formatTime";
import type { Fixture } from "@workspace/api-client-react";

/**
 * Compact match row for use inside Schedule event cards and Dashboard Hero.
 *
 * Shows: USMNT crest vs opponent, kickoff date + time, venue/city.
 * Renders scores when homeScore/awayScore are present.
 * Self-contained — no navigation or click handler; wrap in a <Link> from the parent.
 */
export function ScheduleMatchRow({ fixture }: { fixture: Fixture }) {
  // Determine which side is USMNT so we can label "vs <Opponent>" cleanly
  const usTeamNames = ["united states", "usa", "usmnt"];
  const homeIsUS = usTeamNames.some((n) =>
    fixture.homeTeam.toLowerCase().includes(n)
  );
  const opponent = homeIsUS ? fixture.awayTeam : fixture.homeTeam;
  const opponentLogoUrl = homeIsUS
    ? fixture.awayLogoUrl
    : fixture.homeLogoUrl;

  const hasScore =
    fixture.homeScore !== null && fixture.awayScore !== null;

  const usScore = homeIsUS ? fixture.homeScore : fixture.awayScore;
  const oppScore = homeIsUS ? fixture.awayScore : fixture.homeScore;

  const isFinished = fixture.status === "finished";
  const isLive = fixture.status === "live";

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/50 last:border-0">
      {/* Date column */}
      <div className="w-16 shrink-0 text-center">
        <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider leading-none mb-0.5">
          {formatDate(fixture.kickoff)}
        </div>
        <div className="text-[10px] font-mono text-muted-foreground">
          {formatTime(fixture.kickoff)}
        </div>
      </div>

      {/* Match info */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {/* USMNT crest */}
        <img
          src={`${import.meta.env.BASE_URL}badges/usmnt-crest.png`}
          alt="USMNT"
          className="w-5 h-5 object-contain shrink-0"
          aria-hidden="true"
        />

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
          <span className="text-[10px] font-mono font-bold text-muted-foreground shrink-0 uppercase">vs</span>
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

      {/* Venue / city */}
      <div className="hidden sm:flex items-center gap-1 text-[10px] text-muted-foreground shrink-0 max-w-[140px]">
        <MapPin size={10} className="shrink-0" />
        <span className="truncate">
          {fixture.city ? fixture.city : fixture.venue}
        </span>
      </div>
    </div>
  );
}
