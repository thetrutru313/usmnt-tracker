import { useListPlayers } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { useMemo, useState } from "react";
import { Search, Star } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PoolTierIcon } from "@/components/FixtureCard";
import { type PoolTier } from "@/lib/poolTiers";
import { PlayerCard } from "@/components/PlayerCard";
import { useMyPlayers } from "@/hooks/useMyPlayers";

const POOL_FILTERS: { value: "all" | PoolTier; label: string }[] = [
  { value: "all", label: "All" },
  { value: "core", label: "Core Squad" },
  { value: "inMix", label: "In the Mix" },
  { value: "prospect", label: "Prospects" },
];

export default function Players() {
  const [search, setSearch] = useState("");
  const [poolFilter, setPoolFilter] = useState<string[]>(["all"]);
  const [myPlayersOnly, setMyPlayersOnly] = useState(false);
  const { followedIds } = useMyPlayers();

  const { data: players, isLoading } = useListPlayers({
    search: search.length > 2 ? search : undefined,
  });

  const handlePoolFilterChange = (next: string[]) => {
    if (next.length === 0) {
      setPoolFilter(["all"]);
      return;
    }
    const addedAll = next.includes("all") && !poolFilter.includes("all");
    if (addedAll) {
      setPoolFilter(["all"]);
      return;
    }
    setPoolFilter(next.filter((v) => v !== "all"));
  };

  const filteredPlayers = useMemo(() => {
    if (!players) return players;
    let list = players;
    if (!poolFilter.includes("all")) {
      list = list.filter((p) => poolFilter.includes(p.poolTier));
    }
    if (myPlayersOnly) {
      list = list.filter((p) => followedIds.has(p.id));
    }
    return list;
  }, [players, poolFilter, myPlayersOnly, followedIds]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight uppercase">Player Pool</h1>
          <p className="text-muted-foreground text-sm">Tracking active roster, fringe players, and prospects.</p>
        </div>
        
        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search player name..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-card border-card-border focus-visible:ring-secondary"
            />
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Filter by player pool</p>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="multiple"
            value={poolFilter}
            onValueChange={handlePoolFilterChange}
            className="justify-start flex-nowrap gap-1"
          >
            {POOL_FILTERS.map((f) => (
              <ToggleGroupItem key={f.value} value={f.value} className="text-xs px-2.5 h-7 rounded-md border border-border data-[state=on]:border-primary whitespace-nowrap flex items-center gap-1">
                {f.value !== "all" && <PoolTierIcon tier={f.value} />}
                {f.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          {/* My Players filter chip */}
          <button
            onClick={() => setMyPlayersOnly((v) => !v)}
            className={`flex items-center gap-1 text-xs px-2.5 h-7 rounded-md border whitespace-nowrap transition-colors ${
              myPlayersOnly
                ? "border-amber-400 bg-amber-400/10 text-amber-400"
                : "border-border text-muted-foreground hover:border-amber-400/60 hover:text-amber-400/80"
            }`}
          >
            <Star size={11} className={myPlayersOnly ? "fill-amber-400 stroke-amber-400" : ""} />
            My Players
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[1,2,3,4,5,6,7,8].map(i => (
            <div key={i} className="animate-pulse h-40 rounded-lg border border-border bg-card" />
          ))}
        </div>
      ) : myPlayersOnly && followedIds.size === 0 ? (
        <div className="py-20 text-center border border-dashed rounded-lg bg-card/50">
          <Star size={32} className="mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-muted-foreground font-mono">YOU HAVEN'T SAVED ANY PLAYERS YET</p>
          <p className="text-muted-foreground/60 text-sm mt-2">Tap the ☆ on any player card to add them to My Players.</p>
        </div>
      ) : filteredPlayers?.length === 0 ? (
        <div className="py-20 text-center border border-dashed rounded-lg bg-card/50">
          <p className="text-muted-foreground font-mono">NO PLAYERS FOUND MATCHING CRITERIA</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredPlayers?.map((player) => (
            <PlayerCard key={player.id} player={player} />
          ))}
        </div>
      )}
    </div>
  );
}
