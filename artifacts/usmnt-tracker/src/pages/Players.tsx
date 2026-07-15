import { useListPlayers } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormBadge } from "@/components/FormBadge";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Search, SlidersHorizontal, Shield, Swords, Goal } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type PoolTier = "core" | "inMix" | "prospect";

const POOL_FILTERS: { value: "all" | PoolTier; label: string }[] = [
  { value: "all", label: "All" },
  { value: "core", label: "Core Squad" },
  { value: "inMix", label: "In the Mix" },
  { value: "prospect", label: "Prospects" },
];

export default function Players() {
  const [search, setSearch] = useState("");
  const [poolFilter, setPoolFilter] = useState<string[]>(["all"]);

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
    if (poolFilter.includes("all")) return players;
    return players.filter((p) => poolFilter.includes(p.poolTier));
  }, [players, poolFilter]);

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
        <ToggleGroup
          type="multiple"
          value={poolFilter}
          onValueChange={handlePoolFilterChange}
          className="justify-start flex-nowrap gap-1"
        >
          {POOL_FILTERS.map((f) => (
            <ToggleGroupItem key={f.value} value={f.value} className="text-xs px-2.5 h-7 rounded-md border border-border data-[state=on]:border-primary whitespace-nowrap">
              {f.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[1,2,3,4,5,6,7,8].map(i => (
            <Card key={i} className="animate-pulse h-40" />
          ))}
        </div>
      ) : filteredPlayers?.length === 0 ? (
        <div className="py-20 text-center border border-dashed rounded-lg bg-card/50">
          <p className="text-muted-foreground font-mono">NO PLAYERS FOUND MATCHING CRITERIA</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredPlayers?.map((player) => (
            <Link key={player.id} href={`/players/${player.id}`}>
              <Card className="group hover:border-secondary hover:shadow-lg transition-all cursor-pointer overflow-hidden relative">
                <div className={`absolute top-0 right-0 w-16 h-16 rounded-bl-full -mr-8 -mt-8 transition-colors ${
                  player.poolTier === 'core' ? 'bg-primary/20 group-hover:bg-primary/40' :
                  player.poolTier === 'inMix' ? 'bg-secondary/20 group-hover:bg-secondary/40' :
                  'bg-muted-foreground/20 group-hover:bg-muted-foreground/40'
                }`} />
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-4 relative z-10">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded bg-muted flex items-center justify-center overflow-hidden border border-border">
                        {player.photoUrl ? (
                          <img src={player.photoUrl} alt={player.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="font-mono text-muted-foreground font-bold">{player.name.substring(0,2).toUpperCase()}</span>
                        )}
                      </div>
                      <div>
                        <h3 className="font-bold text-lg leading-tight group-hover:text-secondary transition-colors">{player.name}</h3>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                          <span className="font-medium uppercase tracking-wider">{player.position}</span>
                          <span>•</span>
                          <span className="truncate max-w-[100px]">{player.clubName}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-2 pt-4 border-t border-border/50">
                    <div className="flex flex-col justify-between">
                      <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wide">Age</span>
                      <span className="font-bold data-value text-sm">{player.age}</span>
                    </div>
                    <div className="flex flex-col items-center justify-between">
                      <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wide leading-tight text-center">
                        <span className="sm:hidden">NT Caps</span>
                        <span className="hidden sm:inline">National Team Caps</span>
                      </span>
                      <span className="font-bold data-value text-sm">{player.nationalTeamCaps}</span>
                    </div>
                    <div className="flex flex-col items-end justify-between">
                      <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wide">Form</span>
                      <FormBadge trend={player.performanceTrend} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
