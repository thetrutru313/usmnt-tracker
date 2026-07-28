import * as React from "react"
import { Search, Calendar, CalendarRange, Menu, X, Activity, User2, Trophy, Newspaper, HeartPulse, RefreshCw, WifiOff, Info, DollarSign, Star } from "lucide-react"
import { Link, useLocation } from "wouter"
import { useQueryClient } from "@tanstack/react-query"
import {
  getGetDashboardQueryOptions,
  getListPlayersQueryOptions,
  getListFixturesQueryOptions,
  getListNewsQueryOptions,
  getListInjuriesQueryOptions,
  getListTransfersQueryOptions,
  getGetRankingsQueryOptions,
  getListScheduleEventsQueryOptions,
  getListTransparencyMonthsQueryOptions,
} from "@workspace/api-client-react"
import { cn } from "@/lib/utils"
import { Input } from "./ui/input"
import { SyncMyPlayersModal } from "./SyncMyPlayersModal"

// ── Pull-to-refresh ───────────────────────────────────────────────────────────

const PULL_THRESHOLD = 72  // px of drag needed to trigger a refresh
const PULL_MAX      = 96  // px cap so the indicator doesn't fly off screen

function usePullToRefresh(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  onRefresh: () => Promise<void>,
) {
  const [pullY, setPullY]           = React.useState(0)
  const [refreshing, setRefreshing] = React.useState(false)

  // Refs so touch handlers always read the latest values without stale closures
  const startYRef      = React.useRef(0)
  const pullingRef     = React.useRef(false)
  const pullYRef       = React.useRef(0)
  const refreshingRef  = React.useRef(false)

  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return
      if (el.scrollTop === 0) {
        startYRef.current = e.touches[0].clientY
        pullingRef.current = true
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!pullingRef.current || refreshingRef.current) return
      const delta = e.touches[0].clientY - startYRef.current
      if (delta <= 0) {
        // Scrolling up — cancel pull
        pullingRef.current = false
        pullYRef.current   = 0
        setPullY(0)
        return
      }
      // Prevent the browser's native pull-to-refresh / overscroll bounce
      e.preventDefault()
      const clamped = Math.min(delta, PULL_MAX)
      pullYRef.current = clamped
      setPullY(clamped)
    }

    const onTouchEnd = () => {
      if (!pullingRef.current) return
      pullingRef.current = false

      const dist = pullYRef.current
      if (dist >= PULL_THRESHOLD) {
        refreshingRef.current = true
        setRefreshing(true)
        setPullY(PULL_THRESHOLD) // hold indicator in place while refreshing
        onRefresh().finally(() => {
          refreshingRef.current = false
          setRefreshing(false)
          pullYRef.current = 0
          setPullY(0)
        })
      } else {
        pullYRef.current = 0
        setPullY(0)
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true  })
    el.addEventListener('touchmove',  onTouchMove,  { passive: false })
    el.addEventListener('touchend',   onTouchEnd,   { passive: true  })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove',  onTouchMove)
      el.removeEventListener('touchend',   onTouchEnd)
    }
  }, [scrollRef, onRefresh])

  return { pullY, refreshing }
}

// ── Online status ─────────────────────────────────────────────────────────────

function useOnlineStatus() {
  const [isOnline, setIsOnline] = React.useState(() => navigator.onLine)
  React.useEffect(() => {
    const goOnline = () => setIsOnline(true)
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])
  return isOnline
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false)
  const [syncModalOpen, setSyncModalOpen] = React.useState(false)
  const isOnline = useOnlineStatus()

  const queryClient = useQueryClient()
  const scrollRef   = React.useRef<HTMLDivElement>(null)
  const handleRefresh = React.useCallback(
    () => queryClient.invalidateQueries(),
    [queryClient],
  )
  const { pullY, refreshing } = usePullToRefresh(scrollRef, handleRefresh)

  // Fire the primary query for a page when the user hovers its nav link.
  // prefetchQuery is a no-op when the cache is already fresh, so this is safe
  // to call on every hover without double-fetching.
  const prefetch = React.useCallback(
    (opts: Parameters<typeof queryClient.prefetchQuery>[0]) => {
      void queryClient.prefetchQuery(opts)
    },
    [queryClient],
  )

  const navItems = [
    { label: "Dashboard",    path: "/",            icon: Activity,     onHover: () => prefetch(getGetDashboardQueryOptions()) },
    { label: "Player Pool",  path: "/players",     icon: User2,        onHover: () => prefetch(getListPlayersQueryOptions()) },
    { label: "Fixtures",     path: "/fixtures",    icon: Calendar,     onHover: () => prefetch(getListFixturesQueryOptions()) },
    { label: "News",         path: "/news",        icon: Newspaper,    onHover: () => prefetch(getListNewsQueryOptions()) },
    { label: "Injuries",     path: "/injuries",    icon: HeartPulse,   onHover: () => prefetch(getListInjuriesQueryOptions()) },
    { label: "Transfers",    path: "/transfers",   icon: RefreshCw,    onHover: () => prefetch(getListTransfersQueryOptions()) },
    { label: "Rankings",     path: "/rankings",    icon: Trophy,       onHover: () => prefetch(getGetRankingsQueryOptions()) },
    { label: "USMNT Schedule", path: "/schedule",    icon: CalendarRange, onHover: () => prefetch(getListScheduleEventsQueryOptions()) },
    { label: "About",        path: "/about",       icon: Info },
    { label: "Transparency", path: "/transparency", icon: DollarSign,  onHover: () => prefetch(getListTransparencyMonthsQueryOptions()) },
  ]

  return (
    <div className="flex min-h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 border-r border-sidebar-border bg-sidebar transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static lg:block",
        mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex h-16 items-center px-6 border-b border-sidebar-border">
          <div className="flex items-center gap-2 text-primary font-bold text-xl tracking-tight uppercase">
            <span className="bg-primary text-primary-foreground px-2 py-0.5 rounded text-sm">USMNT</span>
            TRACKER
          </div>
          <button className="lg:hidden ml-auto text-sidebar-foreground" onClick={() => setMobileMenuOpen(false)}>
            <X size={20} />
          </button>
        </div>
        
        <div className="flex flex-col h-[calc(100%-4rem)]">
          <div className="p-4 flex-1 overflow-y-auto">
            <div className="relative mb-6">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search players, clubs..." 
                className="pl-9 bg-sidebar-accent/50 border-sidebar-border focus-visible:ring-primary"
              />
            </div>

            <nav className="space-y-1">
              {navItems.map((item) => {
                const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path))
                const Icon = item.icon
                return (
                  <Link
                    key={item.path}
                    href={item.path}
                    onClick={() => setMobileMenuOpen(false)}
                    onMouseEnter={item.onHover}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    )}
                  >
                    <Icon size={18} className={cn(isActive ? "text-primary" : "text-sidebar-foreground/50")} />
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          </div>

          {/* Sync My Players — secondary, below main nav */}
          <div className="px-4 pb-4 border-t border-sidebar-border pt-3">
            <button
              onClick={() => { setSyncModalOpen(true); setMobileMenuOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-xs font-medium text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
            >
              <Star size={14} className="shrink-0" />
              Sync My Players
            </button>
          </div>
        </div>
      </aside>

      {/* Sync My Players Modal */}
      <SyncMyPlayersModal open={syncModalOpen} onOpenChange={setSyncModalOpen} />

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden relative">
        {!isOnline && (
          <div className="flex items-center justify-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-amber-400 text-xs font-medium font-mono shrink-0">
            <WifiOff size={12} />
            <span>You're offline — showing last cached data.</span>
          </div>
        )}
        <header className="h-16 flex-shrink-0 flex items-center px-4 lg:px-8 border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-40">
          <button className="lg:hidden mr-4" onClick={() => setMobileMenuOpen(true)}>
            <Menu size={24} />
          </button>
          
          <div className="flex-1">
            <h2 className="text-lg font-bold tracking-tight hidden lg:block">
              {navItems.find(item => item.path === location)?.label || "USMNT Tracker"}
            </h2>
          </div>

        </header>

        <div ref={scrollRef} className="flex-1 overflow-auto">
          {/* Pull-to-refresh indicator — only visible on touch devices */}
          {(pullY > 0 || refreshing) && (
            <div
              className="flex items-center justify-center overflow-hidden transition-all duration-150"
              style={{ height: refreshing ? PULL_THRESHOLD : pullY }}
            >
              <div
                className={cn(
                  "rounded-full border-2 p-1.5 transition-colors",
                  (refreshing || pullY >= PULL_THRESHOLD)
                    ? "border-primary text-primary"
                    : "border-muted-foreground/40 text-muted-foreground/40",
                )}
              >
                <RefreshCw
                  size={16}
                  className={cn(refreshing && "animate-spin")}
                  style={
                    !refreshing
                      ? { transform: `rotate(${(pullY / PULL_THRESHOLD) * 360}deg)` }
                      : undefined
                  }
                />
              </div>
            </div>
          )}
          <div className="p-4 lg:p-8 max-w-7xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
