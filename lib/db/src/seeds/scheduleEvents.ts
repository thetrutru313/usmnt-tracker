/**
 * Seeds the schedule_events table from the former hardcoded schedule.ts data.
 * Safe to run multiple times — uses INSERT ... ON CONFLICT DO NOTHING.
 */
import { db, scheduleEventsTable } from "../index";
import { sql } from "drizzle-orm";

const events = [
  {
    slug: "friendlies-sept-2026",
    name: "September Friendlies",
    kind: "friendly",
    status: "confirmed",
    startDate: "2026-09-04",
    endDate: "2026-09-09",
    dateLabel: "Sept 4–9, 2026",
    description:
      "The first international window of the post-World Cup cycle. Pochettino uses this window to begin auditions for the next generation as Nations League group stage play begins for CONCACAF's lower-ranked nations.",
    sortOrder: 10,
  },
  {
    slug: "friendlies-oct-2026",
    name: "October Friendlies",
    kind: "friendly",
    status: "confirmed",
    startDate: "2026-10-09",
    endDate: "2026-10-14",
    dateLabel: "Oct 9–14, 2026",
    description:
      "Second window of the fall friendly run. With the Nations League group stage still ongoing for smaller CONCACAF sides, the USMNT continues building squad depth ahead of their quarterfinal entry.",
    sortOrder: 20,
  },
  {
    slug: "friendlies-nov-2026",
    name: "November Friendlies",
    kind: "friendly",
    status: "confirmed",
    startDate: "2026-11-13",
    endDate: "2026-11-18",
    dateLabel: "Nov 13–18, 2026",
    description:
      "Final fall friendly window before the Nations League knockout rounds. A critical period to finalize the pool and give fringe players one last look before competitive stakes rise.",
    sortOrder: 30,
  },
  {
    slug: "cnl-qf-2027",
    name: "Nations League Quarterfinals",
    kind: "nations-league",
    status: "confirmed",
    startDate: "2027-03-26",
    endDate: "2027-03-31",
    dateLabel: "Mar 26–31, 2027",
    description:
      "The USMNT enters the Nations League at the quarterfinal stage, having received a bye through the group stage. A two-legged home-and-away tie against a qualified group-stage winner — high stakes with Gold Cup qualification on the line.",
    sortOrder: 40,
  },
  {
    slug: "cnl-f4-gold-cup-2027",
    name: "Nations League Final Four + Gold Cup",
    kind: "gold-cup",
    status: "approximate",
    startDate: "2027-06-01",
    endDate: "2027-07-15",
    dateLabel: "Summer 2027 (June–July)",
    description:
      "The Nations League Final Four serves as the gateway to the Gold Cup. The four semifinalists compete for the Nations League title and automatic berths in the 2027 Gold Cup, which follows immediately in the same window.",
    sortOrder: 50,
  },
  {
    slug: "wcq-begins-2027",
    name: "2030 World Cup Qualifying — Begins",
    kind: "world-cup-qualifying",
    status: "approximate",
    startDate: "2027-09-01",
    endDate: null,
    dateLabel: "Fall 2027",
    description:
      "CONCACAF's new World Cup qualifying format kicks off. With 6 automatic berths for the 2030 World Cup (up from 3.5 in 2022), the path is wider — but so is the competition with an expanded CONCACAF player pool.",
    sortOrder: 60,
  },
  {
    slug: "copa-america-2028",
    name: "Copa América 2028",
    kind: "copa-america",
    status: "tbd",
    startDate: "2028-06-01",
    endDate: null,
    dateLabel: "Summer 2028 (Pending Invite)",
    description:
      "CONMEBOL has historically extended invitations to the USA and Mexico for Copa América. As co-hosts of the 2026 World Cup, the USMNT is a likely invitee — a tournament that would provide elite competition during the qualifying window.",
    sortOrder: 70,
  },
  {
    slug: "wcq-2028-2029",
    name: "2030 World Cup Qualifying",
    kind: "world-cup-qualifying",
    status: "tbd",
    startDate: null,
    endDate: null,
    dateLabel: "2027–2029",
    description:
      "CONCACAF qualifying continues across multiple windows through 2029. Format details TBD by CONCACAF, but the USA enters as a strong favorite given home-soil momentum from 2026.",
    sortOrder: 80,
  },
  {
    slug: "world-cup-2030",
    name: "2030 FIFA World Cup",
    kind: "world-cup",
    status: "tbd",
    startDate: "2030-06-01",
    endDate: null,
    dateLabel: "Summer 2030",
    description:
      "The centenary World Cup, hosted across Spain, Portugal, Morocco, Argentina, Uruguay, and Paraguay. The USMNT's four-year mission — built on the momentum of hosting in 2026 — culminates here.",
    sortOrder: 90,
  },
];

async function seed() {
  console.log("Seeding schedule_events...");

  for (const event of events) {
    await db
      .insert(scheduleEventsTable)
      .values({ ...event, updatedAt: new Date() })
      .onConflictDoNothing({ target: scheduleEventsTable.slug });
  }

  const rows = await db.select({ slug: scheduleEventsTable.slug }).from(scheduleEventsTable);
  console.log(`Done — ${rows.length} events in schedule_events table.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
