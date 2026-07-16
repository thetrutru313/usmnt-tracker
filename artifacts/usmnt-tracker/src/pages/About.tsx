import {
  Activity,
  User2,
  Calendar,
  Newspaper,
  HeartPulse,
  RefreshCw,
  Trophy,
  CalendarRange,
  Coffee,
  Heart,
  Info,
  Users,
  TrendingUp,
  BarChart2,
} from "lucide-react";

// ─── Page-level guide entries ────────────────────────────────────────────────

const pages = [
  {
    icon: Activity,
    label: "Dashboard",
    blurb:
      "Your at-a-glance view of everything happening right now. See upcoming USMNT fixtures, recent results, the latest player news, and a quick snapshot of the pool across all tiers.",
  },
  {
    icon: User2,
    label: "Player Pool",
    blurb:
      "Browse every player being tracked, organized into three tiers — Core Squad, In the Mix, and Prospects. Filter by position or tier, and click any player to dive into their full profile.",
  },
  {
    icon: User2,
    label: "Player Profile",
    blurb:
      "A deep-dive on a single player: their current club, position, cap count, recent club form, last-5 match logs, season stats, and national-team history. The form badge and call-up score update automatically as new club data is synced.",
  },
  {
    icon: Calendar,
    label: "Fixtures",
    blurb:
      "All USMNT match results and upcoming fixtures pulled from the live feed. Click a match to see which tracked players appeared and how they performed.",
  },
  {
    icon: CalendarRange,
    label: "Schedule",
    blurb:
      "The long-range calendar from now through the 2030 FIFA World Cup — friendlies, Nations League, Gold Cup, Copa América, and World Cup qualifying all in one timeline.",
  },
  {
    icon: Newspaper,
    label: "News",
    blurb:
      "The latest headlines about USMNT players from around the world, aggregated and sorted by recency so you never miss a transfer rumor, injury update, or standout performance.",
  },
  {
    icon: HeartPulse,
    label: "Injuries",
    blurb:
      "Current injury and suspension status for tracked players. Flags are pulled from club data so you can quickly see who might miss their next call-up window.",
  },
  {
    icon: RefreshCw,
    label: "Transfers",
    blurb:
      "Recent and rumored transfers affecting players in the pool. Useful for tracking when a prospect moves to a bigger stage — or a core squad player loses minutes.",
  },
  {
    icon: Trophy,
    label: "Rankings",
    blurb:
      "Club-level context for the players you're tracking — league standings, Champions League positions, and relegation battles. A player's environment matters as much as their numbers.",
  },
];

// ─── Form badge tiers ─────────────────────────────────────────────────────────

const formTiers = [
  {
    label: "🔥 On Fire",
    color: "text-orange-400",
    desc: "Exceptional recent form — high average rating over the last 5 appearances with an upward trajectory.",
  },
  {
    label: "📈 Rising",
    color: "text-green-400",
    desc: "Good form and improving — last-5 average is solid and trending up versus the prior 5.",
  },
  {
    label: "➡️ Steady",
    color: "text-slate-300",
    desc: "Consistent and reliable. No strong upward or downward trend.",
  },
  {
    label: "📉 Falling",
    color: "text-yellow-400",
    desc: "Form is dipping. Last-5 average has declined compared to the prior window.",
  },
  {
    label: "🧊 Ice Cold",
    color: "text-blue-400",
    desc: "Struggling for form — low rating average over recent appearances.",
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function About() {
  return (
    <div className="space-y-14 pb-16 max-w-3xl">
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-primary/20 text-primary text-xs font-mono font-bold mb-3 tracking-wider">
          <Info size={13} />
          ABOUT
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight uppercase mb-2">
          About This App
        </h1>
        <p className="text-muted-foreground text-lg">
          Everything you need to know about the USMNT Tracker — how it works,
          what the numbers mean, and the story behind it.
        </p>
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/*  SECTION 1 — HOW IT WORKS                                         */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <section className="space-y-8">
        <h2 className="text-2xl font-bold tracking-tight uppercase border-b border-border pb-3">
          How It Works
        </h2>

        {/* Pages guide */}
        <div className="space-y-4">
          {pages.map(({ icon: Icon, label, blurb }) => (
            <div
              key={label}
              className="flex gap-4 p-4 rounded-xl border border-border bg-card"
            >
              <div className="mt-0.5 shrink-0 w-8 h-8 flex items-center justify-center rounded-md bg-primary/10">
                <Icon size={16} className="text-primary" />
              </div>
              <div>
                <p className="font-semibold text-sm mb-1">{label}</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {blurb}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Player Groupings callout ───────────────────────────────────── */}
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 space-y-4">
          <div className="flex items-center gap-2 text-primary font-bold text-sm uppercase tracking-wider">
            <Users size={16} />
            Player Groupings
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Every player in the tracker belongs to one of three tiers, which
            reflect their standing in the USMNT picture:
          </p>
          <div className="space-y-3">
            <div className="flex gap-3">
              <span className="shrink-0 mt-0.5 w-2 h-2 rounded-full bg-primary mt-1.5" />
              <div>
                <p className="text-sm font-semibold">Core Squad</p>
                <p className="text-sm text-muted-foreground">
                  Established USMNT regulars — players who are either current
                  starters or near-certain call-ups for any given camp.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 mt-0.5 w-2 h-2 rounded-full bg-yellow-400 mt-1.5" />
              <div>
                <p className="text-sm font-semibold">In the Mix</p>
                <p className="text-sm text-muted-foreground">
                  Players actively competing for a roster spot. They've earned
                  call-ups before or are pushing hard for one — club form and
                  consistency will determine if they make the next squad.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 mt-0.5 w-2 h-2 rounded-full bg-slate-400 mt-1.5" />
              <div>
                <p className="text-sm font-semibold">Prospects</p>
                <p className="text-sm text-muted-foreground">
                  Young or emerging players on the radar for the future —
                  eligible for the senior team but still developing. These are
                  the names to watch on the road to 2030.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Club Form badge callout ────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div className="flex items-center gap-2 text-foreground font-bold text-sm uppercase tracking-wider">
            <TrendingUp size={16} className="text-primary" />
            Club Form Badge
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The form badge on each player's card and profile reflects how
            they're performing for their club — not the national team. It's
            calculated from their <strong>last 5 appearances</strong> and
            compared against the 5 before that (the "prior window").
          </p>

          <div>
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">
              Result icons
            </p>
            <div className="flex gap-3 flex-wrap">
              {[
                { key: "W", color: "bg-green-500/20 text-green-400 border-green-500/30", label: "Win" },
                { key: "D", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", label: "Draw" },
                { key: "L", color: "bg-red-500/20 text-red-400 border-red-500/30", label: "Loss" },
              ].map(({ key, color, label }) => (
                <div key={key} className="flex items-center gap-1.5">
                  <span className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold border ${color}`}>
                    {key}
                  </span>
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3">
              Form tiers
            </p>
            <div className="space-y-2">
              {formTiers.map(({ label, color, desc }) => (
                <div key={label} className="flex gap-3">
                  <span className={`text-sm font-semibold shrink-0 w-28 ${color}`}>
                    {label}
                  </span>
                  <span className="text-sm text-muted-foreground">{desc}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground/70 leading-relaxed">
            A player with no recent match data (new to tracking, or their club
            stats haven't synced yet) will show no badge rather than a
            misleading one.
          </p>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/*  SECTION 2 — SUPPORT THE PROJECT                                   */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <section className="space-y-6">
        <h2 className="text-2xl font-bold tracking-tight uppercase border-b border-border pb-3">
          Support the Project
        </h2>

        {/* Creator writeup */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div className="flex items-center gap-2 text-primary font-bold text-sm uppercase tracking-wider">
            <Heart size={16} />
            About This Project
          </div>
          <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              I created this app to make it easier to follow USMNT players and
              prospects on the road to the 2030 FIFA World Cup. It's a passion
              project built to help grow interest in U.S. Soccer and make it
              easier for fans to keep up with the next generation of talent.
            </p>
            <p>
              Your support helps cover the costs of running the app, including
              APIs, Replit, and hosting. If donations exceed those expenses,
              every additional dollar will be donated to the{" "}
              <a
                href="https://goalfoundation.org"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
              >
                Goal Foundation
              </a>
              , an organization that provides financial assistance to
              underprivileged youth so they can participate in the pay-to-play
              soccer system.
            </p>
            <p>
              To keep everything transparent, I'll post a monthly breakdown in
              the app showing operating expenses, donations received, and any
              contributions made to the Goal Foundation.
            </p>
          </div>

          <a
            href="https://buymeacoffee.com/thetrutru"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 mt-2 px-5 py-2.5 rounded-lg bg-[#FFDD00] text-[#000000] font-bold text-sm hover:bg-[#FFDD00]/90 transition-colors"
          >
            <Coffee size={16} />
            Buy Me a Coffee
          </a>
        </div>

        {/* Monthly Transparency placeholder */}
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <BarChart2 size={22} />
          </div>
          <p className="font-semibold text-sm">Monthly Transparency Report</p>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
            A breakdown of operating expenses, donations received, and Goal
            Foundation contributions will appear here. Coming soon.
          </p>
        </div>
      </section>
    </div>
  );
}
