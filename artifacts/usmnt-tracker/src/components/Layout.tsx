import * as React from "react"
import { Search, MapPin, Calendar, Menu, X, Activity, User2, Trophy, Newspaper, HeartPulse, RefreshCw } from "lucide-react"
import { Link, useLocation } from "wouter"
import { cn } from "@/lib/utils"
import { Input } from "./ui/input"

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false)

  const navItems = [
    { label: "Dashboard", path: "/", icon: Activity },
    { label: "Player Pool", path: "/players", icon: User2 },
    { label: "Fixtures", path: "/fixtures", icon: Calendar },
    { label: "News", path: "/news", icon: Newspaper },
    { label: "Injuries", path: "/injuries", icon: HeartPulse },
    { label: "Transfers", path: "/transfers", icon: RefreshCw },
    { label: "Rankings", path: "/rankings", icon: Trophy },
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
        
        <div className="p-4">
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
                <Link key={item.path} href={item.path} onClick={() => setMobileMenuOpen(false)} className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                  isActive 
                    ? "bg-primary/10 text-primary" 
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                )}>
                  <Icon size={18} className={cn(isActive ? "text-primary" : "text-sidebar-foreground/50")} />
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </div>
        
        <div className="absolute bottom-0 inset-x-0 p-4 border-t border-sidebar-border text-xs text-sidebar-foreground/50 font-mono">
          SYSTEM_STATUS: ONLINE<br/>
          SYNC: LIVE
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden relative">
        <header className="h-16 flex-shrink-0 flex items-center px-4 lg:px-8 border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-40">
          <button className="lg:hidden mr-4" onClick={() => setMobileMenuOpen(true)}>
            <Menu size={24} />
          </button>
          
          <div className="flex-1">
            <h2 className="text-lg font-bold tracking-tight hidden lg:block">
              {navItems.find(item => item.path === location)?.label || "USMNT Tracker"}
            </h2>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs font-mono font-medium">
              <span className="w-2 h-2 rounded-full bg-primary live-pulse"></span>
              <span className="text-muted-foreground hidden sm:inline-block">LIVE UPDATES</span>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto">
          <div className="p-4 lg:p-8 max-w-7xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
