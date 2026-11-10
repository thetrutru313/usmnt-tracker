import { useState, useMemo, useRef, useCallback, useEffect, useLayoutEffect, memo } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { useListFixtures, getListFixturesQueryKey, type Fixture } from "@workspace/api-client-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { subDays, startOfDay } from "date-fns";
import { Calendar as CalendarIcon, ChevronDown, ChevronUp, Star } from "lucide-react";
import { FixtureCard, PoolTierIcon, type FixtureCardFixture } from "@/components/FixtureCard";
import { type PoolTier } from "@/lib/poolTiers";
import { fixturesRefetchInterval } from "@/lib/livePolling";
import { localDateLabel, toLocalDateStr } from "@/lib/dateLabels";
import { useMyPlayers } from "@/hooks/useMyPlayers";
import { useHistoryState } from "@/lib/scrollRestoration";
import { dayGroups } from "@/lib/stickyHeading";
import { adjustScrollForRowsAbove, useSameFrameRowUpdates } from "@/lib/virtualRows";

const POOL_FILTERS: { value: "all" | PoolTier; label: string }[] = [
  { value: "all", label: "All" },
  { value: "core", label: "Core Squad" },
  { value: "inMix", label: "In the Mix" },
  { value: "prospect", label: "Prospects" },
];

// ---------------------------------------------------------------------------
// Flat row types for the virtualizer
// ---------------------------------------------------------------------------
type HeadingRow = { type: "heading"; dateStr: string; isFirst: boolean };
type CardRow    = { type: "card";    fixture: FixtureCardFixture };
type FlatRow    = HeadingRow | CardRow;

// Estimated pixel heights used for initial layout — dynamic measurement
// refines these on first render.
const HEADING_FIRST_HEIGHT  = 52;
const HEADING_GAP           = 32;      // the mt-8 gap above every heading but the first
const HEADING_HEIGHT        = HEADING_FIRST_HEIGHT + HEADING_GAP;
const CARD_HEIGHT           = 142;     // card body (~130px) + mb-3 (12px)

// Shared by the (invisible) heading rows and the pinned headings drawn over
// them, so the two line up exactly.
const DATE_HEADING_CLASS =
  "text-lg font-bold font-mono uppercase text-muted-foreground flex items-center gap-2 border-b border-border pt-2 pb-2";

function rowKey(row: FlatRow): string {
  return row.type === "heading" ? `h:${row.dateStr}` : `f:${row.fixture.id}`;
}

// Row sizes from the last visit, so the list is laid out exactly as before
// when the page is re-opened and Back can restore the same scroll position.
let savedMeasurements: VirtualItem[] | undefined;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FixturesHeader({
  poolFilter,
  onPoolFilterChange,
  myPlayersOnly,
  onMyPlayersOnlyChange,
}: {
  poolFilter: string[];
  onPoolFilterChange: (next: string[]) => void;
  myPlayersOnly: boolean;
  onMyPlayersOnlyChange: (next: boolean) => void;
}) {
  const { followedIds } = useMyPlayers();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight uppercase mb-2">Watch Guide</h1>
        <p className="text-muted-foreground text-sm">Every match featuring USMNT players worldwide.</p>
      </div>
      <div className="space-y-1.5">
        <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Filter by player pool</p>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="multiple"
            value={poolFilter}
            onValueChange={onPoolFilterChange}
            className="justify-start flex-nowrap gap-1"
          >
            {POOL_FILTERS.map((f) => (
              <ToggleGroupItem
                key={f.value}
                value={f.value}
                className="text-xs px-2.5 h-7 rounded-md border border-border data-[state=on]:border-primary whitespace-nowrap flex items-center gap-1"
              >
                {f.value !== "all" && <PoolTierIcon tier={f.value} />}
                {f.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          {/* My Players filter chip */}
          <button
            onClick={() => onMyPlayersOnlyChange(!myPlayersOnly)}
            className={`flex items-center gap-1 text-xs px-2.5 h-7 rounded-md border whitespace-nowrap transition-colors ${
              myPlayersOnly
                ? "border-amber-400 bg-amber-400/10 text-amber-400"
                : "border-border text-muted-foreground hover:border-amber-400/60 hover:text-amber-400/80"
            }`}
          >
            <Star size={11} className={myPlayersOnly ? "fill-amber-400 stroke-amber-400" : ""} />
            My Players{followedIds.size > 0 && ` · ${followedIds.size}`}
          </button>
        </div>
      </div>
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
  const [open, setOpen] = useHistoryState("fixturesRecentOpen", false);

  // overflow-clip (not -hidden) so the sticky date headings below still stick
  // to the page's scroll area.
  return (
    <div className="border border-border rounded-lg overflow-clip">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-bold font-mono uppercase tracking-wider text-muted-foreground">
          Recent Results ({sortedFinishedDates.reduce((n, d) => n + groupedFinished[d].length, 0)})
        </span>
        {open ? (
          <ChevronUp size={16} className="text-muted-foreground" />
        ) : (
          <ChevronDown size={16} className="text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="p-4 space-y-8">
          {sortedFinishedDates.map((dateStr) => (
            <div key={dateStr} className="space-y-4">
              <h2 className="sticky top-0 z-10 bg-background pt-2 text-sm font-bold font-mono uppercase text-muted-foreground flex items-center gap-2 border-b border-border pb-2">
                <CalendarIcon size={14} />
                {localDateLabel(dateStr)}
              </h2>
              <div className="space-y-3">
                {groupedFinished[dateStr].map((fixture) => (
                  <FixtureCard key={fixture.id} fixture={fixture} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Virtualized upcoming list
// ---------------------------------------------------------------------------

function VirtualFixtureList({ flatRows }: { flatRows: FlatRow[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Find the nearest scrollable ancestor — the Layout's overflow-auto div.
  const getScrollElement = useCallback((): HTMLElement => {
    let el: HTMLElement | null = containerRef.current;
    while (el) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === "auto" || oy === "scroll" || oy === "overlay") return el;
      el = el.parentElement;
    }
    return document.documentElement;
  }, []);

  // Distance from the top of the scroll area's content to this list (page
  // header and Recent Results sit above it). The virtualizer needs it to work
  // out which rows are on screen; re-measured whenever the content above
  // changes size, e.g. when Recent Results is opened.
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const scrollEl = getScrollElement();
    const measure = () => {
      const m = el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
      setScrollMargin((prev) => (Math.abs(prev - m) < 1 ? prev : m));
    };
    measure();
    const parent = el.parentElement;
    if (!parent || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [getScrollElement]);

  // A card that resizes on screen (its player list opening) moves the rows
  // below it in the same frame, without shifting the scroll position.
  const onRowsChange = useSameFrameRowUpdates();
  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement,
    estimateSize: (i) => {
      const row = flatRows[i];
      if (row.type === "heading") return row.isFirst ? HEADING_FIRST_HEIGHT : HEADING_HEIGHT;
      return CARD_HEIGHT;
    },
    measureElement: (el) => el.getBoundingClientRect().height,
    getItemKey: (i) => rowKey(flatRows[i]!),
    initialMeasurementsCache: savedMeasurements,
    // Start from wherever the scroll area already is rather than jumping to
    // the top, so a restored position isn't overridden on mount.
    initialOffset: () => getScrollElement().scrollTop,
    scrollMargin,
    overscan: 5,
    onChange: onRowsChange,
  });
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = adjustScrollForRowsAbove;

  useEffect(() => () => { savedMeasurements = virtualizer.measurementsCache; }, [virtualizer]);

  // Pinned date headings: for each day with a row on screen, draw its heading
  // in a box spanning that day (see dayGroups). The heading rows in the list
  // keep their space but are invisible underneath.
  const dayOf = useMemo(() => {
    let heading = 0;
    return flatRows.map((row, i) => (row.type === "heading" ? (heading = i) : heading));
  }, [flatRows]);
  const totalSize = virtualizer.getTotalSize(); // also refreshes measurementsCache
  const virtualItems = virtualizer.getVirtualItems();
  const measurements = virtualizer.measurementsCache;
  const headings: { index: number; top: number }[] = [];
  flatRows.forEach((row, index) => {
    const m = measurements[index];
    if (row.type === "heading" && m) {
      headings.push({ index, top: m.start - scrollMargin + (row.isFirst ? 0 : HEADING_GAP) });
    }
  });
  const visibleDays = new Set(virtualItems.map((item) => dayOf[item.index]));
  const groups = dayGroups(headings, totalSize).filter((g) => visibleDays.has(g.index));
  const pinnedHeadings = new Set(groups.map((g) => g.index));

  return (
    <div ref={containerRef}>
      {/* Total height spacer — keeps the scrollbar accurate */}
      <div style={{ height: totalSize, position: "relative" }}>
        {groups.map((g) => {
          const heading = flatRows[g.index];
          if (heading?.type !== "heading") return null;
          return (
            <div
              key={`day:${heading.dateStr}`}
              data-testid="date-heading-group"
              style={{ position: "absolute", top: g.top, left: 0, width: "100%", height: g.height, zIndex: 10, pointerEvents: "none" }}
            >
              <h2 className={`${DATE_HEADING_CLASS} sticky top-0 bg-background`}>
                <CalendarIcon size={16} />
                {localDateLabel(heading.dateStr)}
              </h2>
            </div>
          );
        })}
        {virtualItems.map((vItem) => {
          const row = flatRows[vItem.index];
          return (
            <div
              key={vItem.key}
              data-index={vItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vItem.start - scrollMargin}px)`,
              }}
            >
              {row.type === "heading" ? (
                // Keeps the heading's space in the list; hidden when the
                // pinned copy is drawn over it.
                <h2
                  aria-hidden={pinnedHeadings.has(vItem.index) || undefined}
                  className={`${DATE_HEADING_CLASS} ${row.isFirst ? "" : "mt-8"} ${pinnedHeadings.has(vItem.index) ? "invisible" : ""}`}
                >
                  <CalendarIcon size={16} />
                  {localDateLabel(row.dateStr)}
                </h2>
              ) : (
                <div className="mt-3">
                  <FixtureCard fixture={row.fixture} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function groupByDate(list: FixtureCardFixture[]): Record<string, FixtureCardFixture[]> {
  return list.reduce(
    (acc, fixture) => {
      const dateStr = toLocalDateStr(new Date(fixture.kickoff));
      if (!acc[dateStr]) acc[dateStr] = [];
      acc[dateStr]!.push(fixture);
      return acc;
    },
    {} as Record<string, FixtureCardFixture[]>,
  );
}

export default function Fixtures() {
  const { data: fixtures, isLoading } = useListFixtures(
    { scope: "all" },
    {
      query: {
        queryKey: getListFixturesQueryKey({ scope: "all" }),
        placeholderData: keepPreviousData,
        refetchInterval: (query): number | false =>
          fixturesRefetchInterval(query.state.data as Fixture[] | undefined),
      },
    },
  );
  // Kept on the history entry so Back from a match brings the same view back.
  const [poolFilter, setPoolFilter] = useHistoryState<string[]>("fixturesPoolFilter", ["all"]);
  const [myPlayersOnly, setMyPlayersOnly] = useHistoryState("fixturesMyPlayersOnly", false);
  const { followedIds } = useMyPlayers();

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
          {[1, 2, 3, 4, 5].map((i) => (
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

  // Apply pool tier filter
  let filteredFixtures = poolFilter.includes("all")
    ? fixtures
    : fixtures.filter((fixture) =>
        fixture.featuredPlayers.some((p) => poolFilter.includes(p.poolTier)),
      );

  // Apply My Players filter
  if (myPlayersOnly) {
    filteredFixtures = filteredFixtures.filter((fixture) =>
      fixture.featuredPlayers.some((p) => followedIds.has(p.id)),
    );
  }

  // Safety net: a "scheduled" fixture whose kickoff is more than 2 hours in
  // the past is stuck — the backend reconciliation loop can only update
  // fixtures that have fixture_players links, so orphaned fixtures (no player
  // tags) can never self-heal. Always show "live" matches regardless of wall
  // time; give "scheduled" a 2-hour grace window to cover kickoff delays and
  // slow API updates before hiding them from the upcoming list.
  const nowMs = Date.now();
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const upcomingFixtures = filteredFixtures.filter(
    (f) =>
      f.status === "live" ||
      (f.status !== "finished" &&
        new Date(f.kickoff).getTime() > nowMs - TWO_HOURS_MS),
  );
  const sevenDaysAgo = subDays(startOfDay(new Date()), 7);
  const finishedFixtures = filteredFixtures.filter(
    (f) => f.status === "finished" && new Date(f.kickoff) >= sevenDaysAgo,
  );

  if (filteredFixtures.length === 0) {
    return (
      <div className="space-y-8 max-w-4xl mx-auto">
        <FixturesHeader
          poolFilter={poolFilter}
          onPoolFilterChange={handlePoolFilterChange}
          myPlayersOnly={myPlayersOnly}
          onMyPlayersOnlyChange={setMyPlayersOnly}
        />
        {myPlayersOnly && followedIds.size === 0 ? (
          <div className="py-20 text-center border border-dashed rounded-lg bg-card/50">
            <Star size={32} className="mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-muted-foreground font-mono">YOU HAVEN'T SAVED ANY PLAYERS YET</p>
            <p className="text-muted-foreground/60 text-sm mt-2">
              Tap the ☆ on any player card to add them to My Players.
            </p>
          </div>
        ) : (
          <div className="py-20 text-center border border-dashed rounded-lg bg-card/50">
            <p className="text-muted-foreground font-mono">NO FIXTURES MATCH THIS FILTER</p>
          </div>
        )}
      </div>
    );
  }

  const groupedUpcoming = groupByDate(upcomingFixtures);
  const sortedUpcomingDates = Object.keys(groupedUpcoming).sort();

  const groupedFinished = groupByDate(finishedFixtures);
  const sortedFinishedDates = Object.keys(groupedFinished).sort().reverse();

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <FixturesHeader
        poolFilter={poolFilter}
        onPoolFilterChange={handlePoolFilterChange}
        myPlayersOnly={myPlayersOnly}
        onMyPlayersOnlyChange={setMyPlayersOnly}
      />

      {finishedFixtures.length > 0 && (
        <RecentResults
          groupedFinished={groupedFinished}
          sortedFinishedDates={sortedFinishedDates}
        />
      )}

      {upcomingFixtures.length === 0 ? (
        <div className="py-20 text-center border border-dashed rounded-lg bg-card/50">
          <p className="text-muted-foreground font-mono">NO UPCOMING FIXTURES</p>
        </div>
      ) : (
        <VirtualFixtureListMemo
          sortedDates={sortedUpcomingDates}
          groupedFixtures={groupedUpcoming}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Memoized adapter — builds the flat row array and renders VirtualFixtureList.
// Separate component so the parent (Fixtures) state changes (e.g. poolFilter
// toggle animation) don't force the virtualizer to recompute unless the data
// actually changes.
// ---------------------------------------------------------------------------

const VirtualFixtureListMemo = memo(function VirtualFixtureListMemo({
  sortedDates,
  groupedFixtures,
}: {
  sortedDates: string[];
  groupedFixtures: Record<string, FixtureCardFixture[]>;
}) {
  const flatRows = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = [];
    sortedDates.forEach((dateStr, idx) => {
      rows.push({ type: "heading", dateStr, isFirst: idx === 0 });
      for (const fixture of groupedFixtures[dateStr]!) {
        rows.push({ type: "card", fixture });
      }
    });
    return rows;
  }, [sortedDates, groupedFixtures]);

  return <VirtualFixtureList flatRows={flatRows} />;
});
