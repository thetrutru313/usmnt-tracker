import { CalendarRange, ChevronRight } from "lucide-react";
import {
  USMNT_SCHEDULE,
  getNextEvent,
  KIND_LABELS,
  KIND_COLORS,
  KIND_BORDER,
  STATUS_LABELS,
  STATUS_COLORS,
  type ScheduleEvent,
} from "@/data/schedule";

function groupByYear(events: ScheduleEvent[]): [string, ScheduleEvent[]][] {
  const map = new Map<string, ScheduleEvent[]>();
  for (const e of events) {
    const year = e.startDate
      ? e.startDate.slice(0, 4)
      : e.dateLabel.match(/\b(20\d\d)\b/)?.[1] ?? "2030";
    const key =
      parseInt(year) >= 2028 && parseInt(year) <= 2030 ? "2028–2030" : year;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return Array.from(map.entries());
}

export default function Schedule() {
  const nextEvent = getNextEvent();
  const groups = groupByYear(USMNT_SCHEDULE);

  return (
    <div className="space-y-10 pb-12">
      {/* Header */}
      <div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-primary/20 text-primary text-xs font-mono font-bold mb-3 tracking-wider">
          <CalendarRange size={13} />
          FULL CALENDAR
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight uppercase mb-2">
          USMNT Schedule
        </h1>
        <p className="text-muted-foreground text-lg max-w-2xl">
          The road to 2030 — from post-World Cup friendlies through Nations
          League, Copa América, and World Cup qualifying.
        </p>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            "friendly",
            "nations-league",
            "gold-cup",
            "copa-america",
            "world-cup-qualifying",
            "world-cup",
          ] as const
        ).map((kind) => (
          <span
            key={kind}
            className={`text-xs px-2 py-0.5 rounded border font-medium ${KIND_COLORS[kind]}`}
          >
            {KIND_LABELS[kind]}
          </span>
        ))}
      </div>

      {/* Timeline groups */}
      {groups.map(([year, events]) => (
        <div key={year}>
          <div className="flex items-center gap-3 mb-5">
            <span className="text-2xl font-bold font-mono text-primary/60 tracking-tighter">
              {year}
            </span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <div className="space-y-4">
            {events.map((event) => {
              const isNext = event.id === nextEvent?.id;
              return (
                <div
                  key={event.id}
                  className={`relative border-l-4 ${KIND_BORDER[event.kind]} bg-card border border-card-border rounded-r-xl pl-5 pr-5 py-4 transition-all ${
                    isNext ? "ring-1 ring-primary/40 shadow-md shadow-primary/10" : ""
                  }`}
                >
                  {/* NEXT UP chip */}
                  {isNext && (
                    <div className="absolute -top-2.5 left-4 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary text-primary-foreground text-[10px] font-mono font-bold tracking-wider uppercase">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary-foreground animate-pulse" />
                      NEXT UP
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Badges */}
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span
                          className={`text-xs px-2 py-0.5 rounded border font-medium ${KIND_COLORS[event.kind]}`}
                        >
                          {KIND_LABELS[event.kind]}
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${STATUS_COLORS[event.status]}`}
                        >
                          {STATUS_LABELS[event.status]}
                        </span>
                      </div>

                      <h3 className="font-bold text-lg leading-tight mb-1">
                        {event.name}
                      </h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {event.description}
                      </p>
                    </div>

                    {/* Date box */}
                    <div className="sm:text-right shrink-0">
                      <div className="text-xs text-muted-foreground uppercase font-mono tracking-wider mb-0.5">
                        {event.status === "confirmed" ? "Dates" : event.status === "approximate" ? "Approx." : "TBD"}
                      </div>
                      <div className="font-bold text-base text-foreground">
                        {event.dateLabel}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <p className="text-xs text-muted-foreground font-mono pt-2">
        Dates sourced from CONCACAF official calendar. Approximate and TBD
        entries will be updated as official announcements are made.
      </p>
    </div>
  );
}
