/**
 * Seeds the schedule_events table from the former hardcoded schedule.ts data.
 * Safe to run multiple times — uses INSERT ... ON CONFLICT DO NOTHING.
 */
import { db, scheduleEventsTable } from "../index";


const events = [
  {
    slug: "friendlies-sept-2026",
    name: "September Friendlies",
    kind: "friendly",
    status: "confirmed",
    startDate: "2026-09-26",
    endDate: "2026-09-29",
    dateLabel: "Sept 26 & 29, 2026",
    description:
      "The first international window of the post-World Cup cycle. Pochettino uses this window to begin auditions for the next generation as Nations League group stage play begins for CONCACAF's lower-ranked nations.",
    sortOrder: 10,
  },
  {
    slug: "friendlies-oct-2026",
    name: "October Friendlies",
    kind: "friendly",
    status: "confirmed",
    startDate: "2026-10-03",
    endDate: "2026-10-06",
    dateLabel: "Oct 3 & 6, 2026",
    description:
      "Second window of the fall friendly run. With the Nations League group stage still ongoing for smaller CONCACAF sides, the USMNT continues building squad depth ahead of their quarterfinal entry.",
    sortOrder: 20,
  },
  {
    slug: "cnl-qf-nov-2026",
    name: "Nations League Quarterfinals",
    kind: "nations-league",
    status: "confirmed",
    startDate: "2026-11-13",
    endDate: "2026-11-18",
    dateLabel: "Nov 14 & 17, 2026",
    description:
      "The USMNT faces Haiti in a two-legged Nations League quarterfinal on November 14 and 17. The first leg is away at a neutral site, with venue and kickoff time still to be announced; the return leg is at TQL Stadium in Cincinnati at 7:00 PM EST. Both matches air on TNT and stream on HBO Max.",
    sortOrder: 30,
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
      .onConflictDoUpdate({
        target: scheduleEventsTable.slug,
        set: {
          name: event.name,
          kind: event.kind,
          status: event.status,
          startDate: event.startDate,
          endDate: event.endDate,
          dateLabel: event.dateLabel,
          description: event.description,
          sortOrder: event.sortOrder,
          updatedAt: new Date(),
        },
      });
  }

  const rows = await db.select({ slug: scheduleEventsTable.slug }).from(scheduleEventsTable);
  console.log(`Done — ${rows.length} events in schedule_events table.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
