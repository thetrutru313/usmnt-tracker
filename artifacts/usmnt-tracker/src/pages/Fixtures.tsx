import { useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { useListFixtures, getListFixturesQueryKey, type Fixture } from "@workspace/api-client-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { subDays, startOfDay } from "date-fns";
import { Calendar as CalendarIcon, ChevronDown, ChevronUp } from "lucide-react";
import { FixtureCard, PoolTierIcon, type PoolTier, type FixtureCardFixture } from "@/components/FixtureCard";
import { fixturesRefetchInterval } from "@/lib/livePolling";
import { utcDateLabel } from "@/lib/dateLabels";

const POOL_FILTERS: { value: "all" | PoolTier; label: string }[] = [
  { value: "all", label: "All" },
  { value: "core", label: "Core Squad" },
  { value: "inMix", label: "In the Mix" },
  { value: "prospect", label: "Prospects" },
];

function FixturesHeader({ poolFilter, onPoolFilterChange }: { poolFilter: string[]; onPoolFilterChange: (next: string[]) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight uppercase mb-2">Watch Guide</h1>
        <p className="text-muted-foreground text-sm">Every match featuring USMNT players worldwide.</p>
      </div>
      <div className="space-y-1.5">
        <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Filter by player pool</p>
        <ToggleGroup
          type="multiple"
          value={poolFilter}
          onValueChange={onPoolFilterChange}
          className="justify-start flex-nowrap gap-1"
        >
          {POOL_FILTERS.map((f) => (
            <ToggleGroupItem key={f.value} value={f.value} className="text-xs px-2.5 h-7 rounded-md border border-border data-[state=on]:border-primary whitespace-nowrap flex items-center gap-1">
              {f.value !== "all" && <PoolTierIcon tier={f.value} />}
              {f.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  );
}

export default function Fixtures() {
  const { data: fixtures, isLoading } = useListFixtures(
    { scope: 'all' },
    {
      query: {
        queryKey: getListFixturesQueryKey({ scope: 'all' }),
        placeholderData: keepPreviousData,
        refetchInterval: (query): number | false =>
          fixturesRefetchInterval(query.state.data as Fixture[] | undefined),
      },
    },
  );
  const [poolFilter, setPoolFilter] = useState<string[]>(["all"]);

  const handlePoolFilterChange = (next: string[]) => {
    setPoolFilter((prev) => {
      const clickedAll = next.includes("all") && !prev.includes("all");
      if (clickedAll) return ["all"];
      const withoutAll = next.filter((v) => v !== "all");
      return withoutAll.length === 0 ? ["all"] : withoutAll;
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 w-48 bg-card rounded" />
        <div className="space-y-4">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="h-24 bg-card rounded-xl border border-card-border" />
          ))}
        </div>
      </div>
    );
  }

  if (!fixtures || fixtures.length === 0) {
    return (
      <div className="py-20 text-center border border-dashed rounded-lg bg-card/50">
        <p className="text-muted-foreground font-mono">NO FIXTURES SCHEDULED</p>
      </div>
    );
  }

  const filteredFixtures = poolFilter.includes("all")
    ? fixtures
    : fixtures.filter((fixture) => fixture.featuredPlayers.some((p) => poolFilter.includes(p.poolTier)));

  // Split into upcoming/live and finished (recent results capped to a 7-day window)
  const upcomingFixtures = filteredFixtures.filter((f) => f.status !== "finished");
  const sevenDaysAgo = subDays(startOfDay(new Date()), 7);
  const finishedFixtures = filteredFixtures.filter(
    (f) => f.status === "finished" && new Date(f.kickoff) >= sevenDaysAgo,
  );

  if (filteredFixtures.length === 0) {
    return (
      <div className="space-y-8 max-w-4xl mx-auto">
        <FixturesHeader poolFilter={poolFilter} onPoolFilterChange={handlePoolFilterChange} />
        <div className="py-20 text-center border border-dashed rounded-lg bg-card/50">
          <p className="text-muted-foreground font-mono">NO FIXTURES MATCH THIS FILTER</p>
        </div>
      </div>
    );
  }

  function groupByDate(list: FixtureCardFixture[]): Record<string, FixtureCardFixture[]> {
    return list.reduce((acc, fixture) => {
      const dateStr = new Date(fixture.kickoff).toISOString().substring(0, 10);
      if (!acc[dateStr]) acc[dateStr] = [];
      acc[dateStr]!.push(fixture);
      return acc;
    }, {} as Record<string, FixtureCardFixture[]>);
  }

  const groupedUpcoming = groupByDate(upcomingFixtures);
  const sortedUpcomingDates = Object.keys(groupedUpcoming).sort();

  const groupedFinished = groupByDate(finishedFixtures);
  // Most recent finished dates first
  const sortedFinishedDates = Object.keys(groupedFinished).sort().reverse();

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <FixturesHeader poolFilter={poolFilter} onPoolFilterChange={handlePoolFilterChange} />

      {finishedFixtures.length > 0 && (
        <RecentResults groupedFinished={groupedFinished} sortedFinishedDates={sortedFinishedDates} />
      )}

      {upcomingFixtures.length === 0 ? (
        <div className="py-20 text-center border border-dashed rounded-lg bg-card/50">
          <p className="text-muted-foreground font-mono">NO UPCOMING FIXTURES</p>
        </div>
      ) : (
        <div className="space-y-8">
          {sortedUpcomingDates.map(dateStr => {
            const dateTitle = utcDateLabel(dateStr);

            return (
              <div key={dateStr} className="space-y-4">
                <h2 className="text-lg font-bold font-mono uppercase text-muted-foreground flex items-center gap-2 border-b border-border pb-2">
                  <CalendarIcon size={16} />
                  {dateTitle}
                </h2>
                <div className="space-y-3">
                  {groupedUpcoming[dateStr].map(fixture => (
                    <FixtureCard key={fixture.id} fixture={fixture} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RecentResults({
  groupedFinished,
  sortedFinishedDates,
}: {
  groupedFinished: Record<string, FixtureCardFixture[]>;
  sortedFinishedDates: string[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-bold font-mono uppercase tracking-wider text-muted-foreground">
          Recent Results ({sortedFinishedDates.reduce((n, d) => n + groupedFinished[d].length, 0)})
        </span>
        {open ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
      </button>

      {open && (
        <div className="p-4 space-y-8">
          {sortedFinishedDates.map(dateStr => {
            const dateTitle = utcDateLabel(dateStr);

            return (
              <div key={dateStr} className="space-y-4">
                <h2 className="text-sm font-bold font-mono uppercase text-muted-foreground flex items-center gap-2 border-b border-border pb-2">
                  <CalendarIcon size={14} />
                  {dateTitle}
                </h2>
                <div className="space-y-3">
                  {groupedFinished[dateStr].map(fixture => (
                    <FixtureCard key={fixture.id} fixture={fixture} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
