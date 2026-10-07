/**
 * Seeds the schedule_events table from the former hardcoded schedule.ts data.
 * Safe to run multiple times — upserts by slug without deleting retired rows.
 */
import { db, scheduleEventsTable } from "../index";
import { events } from "./scheduleEventsData";

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
