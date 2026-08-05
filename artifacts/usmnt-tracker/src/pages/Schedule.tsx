import { CalendarRange, ChevronRight, Loader2 } from "lucide-react";
import { useListScheduleEvents } from "@workspace/api-client-react";
import type { ScheduleEvent } from "@workspace/api-client-react";
import {
  KIND_LABELS,
  KIND_COLORS,
  KIND_BORDER,
  STATUS_LABELS,
  STATUS_COLORS,
} from "@/data/schedule";
import { ScheduleMatchRow } from "@/components/ScheduleMatchRow";

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

function getNextEvent(events: ScheduleEvent[]): ScheduleEvent | undefined {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events.find((e) => e.startDate !== null && e.startDate >= today);
  if (upcoming) return upcoming;
  return events.find((e) => e.startDate === null);
}

export default function Schedule() {
  const { data, isLoading, error } = useListScheduleEvents();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-muted-foreground" size={28} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 text-center bg-destructive/10 text-destructive rounded-xl border border-destructive/20">
        <p className="font-mono text-sm">FAILED TO LOAD SCHEDULE DATA</p>
      </div>
    );
  }

  const events = data.events;
  const nextEvent = getNextEvent(events);
  const groups = groupByYear(events);

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
      {groups.map(([year, yearEvents]) => (
        <div key={year}>
          <div className="flex items-center gap-3 mb-5">
            <span className="text-2xl font-bold font-mono text-primary/60 tracking-tighter">
              {year}
            </span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <div className="space-y-4">
            {yearEvents.map((event) => {
              const isNext = event.slug === nextEvent?.slug;
              const kind = event.kind as keyof typeof KIND_COLORS;
              const status = event.status as keyof typeof STATUS_COLORS;
              return (
                <div
                  key={event.id}
                  className={`relative border-l-4 ${KIND_BORDER[kind]} bg-card border border-card-border rounded-r-xl pl-5 pr-5 py-4 transition-all ${
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

                  {/* Header: badges + name + (date box when no fixtures) */}
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Badges */}
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span
                          className={`text-xs px-2 py-0.5 rounded border font-medium ${KIND_COLORS[kind]}`}
                        >
                          {KIND_LABELS[kind]}
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${STATUS_COLORS[status]}`}
                        >
                          {STATUS_LABELS[status]}
                        </span>
                      </div>

                      <h3 className="font-bold text-lg leading-tight mb-1">
                        {event.name}
                      </h3>

                      {/* Show description only when no fixtures are available */}
                      {(!event.fixtures || event.fixtures.length === 0) && (
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {event.description}
                        </p>
                      )}
                    </div>

                    {/* Date box — only shown when no fixtures */}
                    {(!event.fixtures || event.fixtures.length === 0) && (
                      <div className="sm:text-right shrink-0">
                        <div className="text-xs text-muted-foreground uppercase font-mono tracking-wider mb-0.5">
                          {event.status === "confirmed" ? "Dates" : event.status === "approximate" ? "Approx." : "TBD"}
                        </div>
                        <div className="font-bold text-base text-foreground">
                          {event.dateLabel}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Match rows — shown when fixtures are present */}
                  {event.fixtures && event.fixtures.length > 0 && (
                    <div className="mt-3">
                      {event.fixtures.map((fixture) => (
                        <ScheduleMatchRow key={fixture.id} fixture={fixture} />
                      ))}
                    </div>
                  )}
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
