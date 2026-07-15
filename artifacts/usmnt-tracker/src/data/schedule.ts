export type EventKind =
  | "friendly"
  | "nations-league"
  | "gold-cup"
  | "copa-america"
  | "world-cup-qualifying"
  | "world-cup";

export type EventStatus = "confirmed" | "approximate" | "tbd";

export interface ScheduleEvent {
  id: string;
  name: string;
  kind: EventKind;
  status: EventStatus;
  /** ISO "YYYY-MM-DD" date, or null for TBD/approximate events */
  startDate: string | null;
  endDate: string | null;
  /** Human-readable date label, e.g. "Sept 4–9, 2026" or "Summer 2027" */
  dateLabel: string;
  description: string;
}

export const USMNT_SCHEDULE: ScheduleEvent[] = [
  {
    id: "friendlies-sept-2026",
    name: "September Friendlies",
    kind: "friendly",
    status: "confirmed",
    startDate: "2026-09-04",
    endDate: "2026-09-09",
    dateLabel: "Sept 4–9, 2026",
    description:
      "The first international window of the post-World Cup cycle. Pochettino uses this window to begin auditions for the next generation as Nations League group stage play begins for CONCACAF's lower-ranked nations.",
  },
  {
    id: "friendlies-oct-2026",
    name: "October Friendlies",
    kind: "friendly",
    status: "confirmed",
    startDate: "2026-10-09",
    endDate: "2026-10-14",
    dateLabel: "Oct 9–14, 2026",
    description:
      "Second window of the fall friendly run. With the Nations League group stage still ongoing for smaller CONCACAF sides, the USMNT continues building squad depth ahead of their quarterfinal entry.",
  },
  {
    id: "friendlies-nov-2026",
    name: "November Friendlies",
    kind: "friendly",
    status: "confirmed",
    startDate: "2026-11-13",
    endDate: "2026-11-18",
    dateLabel: "Nov 13–18, 2026",
    description:
      "Final fall friendly window before the Nations League knockout rounds. A critical period to finalize the pool and give fringe players one last look before competitive stakes rise.",
  },
  {
    id: "cnl-qf-2027",
    name: "Nations League Quarterfinals",
    kind: "nations-league",
    status: "confirmed",
    startDate: "2027-03-26",
    endDate: "2027-03-31",
    dateLabel: "Mar 26–31, 2027",
    description:
      "The USMNT enters the Nations League at the quarterfinal stage, having received a bye through the group stage. A two-legged home-and-away tie against a qualified group-stage winner — high stakes with Gold Cup qualification on the line.",
  },
  {
    id: "cnl-f4-gold-cup-2027",
    name: "Nations League Final Four + Gold Cup",
    kind: "gold-cup",
    status: "approximate",
    startDate: "2027-06-01",
    endDate: "2027-07-15",
    dateLabel: "Summer 2027 (June–July)",
    description:
      "The Nations League Final Four serves as the gateway to the Gold Cup. The four semifinalists compete for the Nations League title and automatic berths in the 2027 Gold Cup, which follows immediately in the same window.",
  },
  {
    id: "wcq-begins-2027",
    name: "2030 World Cup Qualifying — Begins",
    kind: "world-cup-qualifying",
    status: "approximate",
    startDate: "2027-09-01",
    endDate: null,
    dateLabel: "Fall 2027",
    description:
      "CONCACAF's new World Cup qualifying format kicks off. With 6 automatic berths for the 2030 World Cup (up from 3.5 in 2022), the path is wider — but so is the competition with an expanded CONCACAF player pool.",
  },
  {
    id: "copa-america-2028",
    name: "Copa América 2028",
    kind: "copa-america",
    status: "tbd",
    startDate: "2028-06-01",
    endDate: null,
    dateLabel: "Summer 2028 (Pending Invite)",
    description:
      "CONMEBOL has historically extended invitations to the USA and Mexico for Copa América. As co-hosts of the 2026 World Cup, the USMNT is a likely invitee — a tournament that would provide elite competition during the qualifying window.",
  },
  {
    id: "wcq-2028-2029",
    name: "2030 World Cup Qualifying",
    kind: "world-cup-qualifying",
    status: "tbd",
    startDate: null,
    endDate: null,
    dateLabel: "2027–2029",
    description:
      "CONCACAF qualifying continues across multiple windows through 2029. Format details TBD by CONCACAF, but the USA enters as a strong favorite given home-soil momentum from 2026.",
  },
  {
    id: "world-cup-2030",
    name: "2030 FIFA World Cup",
    kind: "world-cup",
    status: "tbd",
    startDate: "2030-06-01",
    endDate: null,
    dateLabel: "Summer 2030",
    description:
      "The centenary World Cup, hosted across Spain, Portugal, Morocco, Argentina, Uruguay, and Paraguay. The USMNT's four-year mission — built on the momentum of hosting in 2026 — culminates here.",
  },
];

/**
 * Returns the next upcoming event. Prefers events with a confirmed startDate
 * in the future; falls back to the first approximate or TBD event.
 */
export function getNextEvent(): ScheduleEvent | undefined {
  const today = new Date().toISOString().slice(0, 10);

  // First: confirmed/approximate event whose startDate is today or future
  const upcoming = USMNT_SCHEDULE.find(
    (e) => e.startDate !== null && e.startDate >= today
  );
  if (upcoming) return upcoming;

  // Fallback: first approximate or TBD event (no concrete startDate)
  return USMNT_SCHEDULE.find((e) => e.startDate === null);
}

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
