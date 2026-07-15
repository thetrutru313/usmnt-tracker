/**
 * Visual mapping constants for USMNT schedule events.
 *
 * The schedule data itself lives in the `schedule_events` database table and is
 * managed via the admin API endpoints (POST/PUT/DELETE /api/admin/schedule).
 * The frontend reads events from GET /api/schedule via `useListScheduleEvents`.
 *
 * These constants are kept here because they are pure frontend styling choices
 * that don't belong in the database.
 */

export type EventKind =
  | "friendly"
  | "nations-league"
  | "gold-cup"
  | "copa-america"
  | "world-cup-qualifying"
  | "world-cup";

export type EventStatus = "confirmed" | "approximate" | "tbd";

export const KIND_LABELS: Record<EventKind, string> = {
  friendly: "Friendly",
  "nations-league": "Nations League",
  "gold-cup": "Gold Cup",
  "copa-america": "Copa América",
  "world-cup-qualifying": "World Cup Qualifying",
  "world-cup": "FIFA World Cup",
};

export const KIND_COLORS: Record<EventKind, string> = {
  friendly: "bg-slate-500/20 text-slate-300 border-slate-500/30",
  "nations-league": "bg-amber-500/20 text-amber-300 border-amber-500/30",
  "gold-cup": "bg-orange-500/20 text-orange-300 border-orange-500/30",
  "copa-america": "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  "world-cup-qualifying": "bg-purple-500/20 text-purple-300 border-purple-500/30",
  "world-cup": "bg-primary/20 text-primary border-primary/30",
};

export const KIND_BORDER: Record<EventKind, string> = {
  friendly: "border-l-slate-500",
  "nations-league": "border-l-amber-500",
  "gold-cup": "border-l-orange-500",
  "copa-america": "border-l-emerald-500",
  "world-cup-qualifying": "border-l-purple-500",
  "world-cup": "border-l-primary",
};

export const STATUS_LABELS: Record<EventStatus, string> = {
  confirmed: "Confirmed",
  approximate: "Dates Approx.",
  tbd: "TBD",
};

export const STATUS_COLORS: Record<EventStatus, string> = {
  confirmed: "bg-green-500/20 text-green-400 border-green-500/30",
  approximate: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  tbd: "bg-muted text-muted-foreground border-border",
};
