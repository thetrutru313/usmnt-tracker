import { useListPlayers } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Link } from "wouter";
import { Search, SlidersHorizontal, Shield, Swords, Goal } from "lucide-react";

export default function Players() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"current" | "fringe" | "prospect" | "">("");
  
  const { data: players, isLoading } = useListPlayers({ 
    search: search.length > 2 ? search : undefined,
    category: category || undefined
  });

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

      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        <button 
          onClick={() => setCategory("")}
          className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors border ${category === "" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:border-primary/50 text-foreground"}`}
        >
          All Players
        </button>
        <button 
          onClick={() => setCategory("current")}
          className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors border ${category === "current" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:border-primary/50 text-foreground"}`}
        >
          Core Squad
        </button>
        <button 
          onClick={() => setCategory("fringe")}
          className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors border ${category === "fringe" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:border-primary/50 text-foreground"}`}
        >
          In the Mix
        </button>
        <button 
          onClick={() => setCategory("prospect")}
          className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors border ${category === "prospect" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:border-primary/50 text-foreground"}`}
        >
          Prospects
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[1,2,3,4,5,6,7,8].map(i => (
            <Card key={i} className="animate-pulse h-40" />
          ))}
        </div>
      ) : players?.length === 0 ? (
        <div className="py-20 text-center border border-dashed rounded-lg bg-card/50">
          <p className="text-muted-foreground font-mono">NO PLAYERS FOUND MATCHING CRITERIA</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {players?.map((player) => (
            <Link key={player.id} href={`/players/${player.id}`}>
              <Card className="group hover:border-secondary hover:shadow-lg transition-all cursor-pointer overflow-hidden relative">
                <div className={`absolute top-0 right-0 w-16 h-16 rounded-bl-full -mr-8 -mt-8 transition-colors ${
                  player.category === 'current' ? 'bg-primary/20 group-hover:bg-primary/40' :
                  player.category === 'fringe' ? 'bg-secondary/20 group-hover:bg-secondary/40' :
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
                    <div className="flex flex-col">
                      <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wide">Age</span>
                      <span className="font-bold data-value text-sm">{player.age}</span>
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wide">Caps</span>
                      <span className="font-bold data-value text-sm">{player.nationalTeamCaps}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wide">Trend</span>
                      <Badge variant={player.performanceTrend === 'rising' ? 'success' : player.performanceTrend === 'falling' ? 'destructive' : 'secondary'} className="rounded px-1.5 h-5 text-[10px] uppercase font-mono mt-0.5">
                        {player.performanceTrend}
                      </Badge>
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
