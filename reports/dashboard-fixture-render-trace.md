# Dashboard fixture render trace (hero vs. upcoming-games list)

Read-only trace. No code, schema, migrations, or tests were changed.

Scope: `artifacts/usmnt-tracker/src/pages/Dashboard.tsx`, walked top to bottom, with every fixture-rendering element traced back to its API field and server-side query in `artifacts/api-server/src/routes/dashboard.ts`.

---

## Render tree, top to bottom

### 1. "Next Window Hero" — the large featured block at the top

```tsx
{nextEvent && (
  <Link href="/schedule">
    <section className="relative overflow-hidden rounded-2xl bg-[#001a3a] border border-[#002868] border-t-2 border-t-red-600 shadow-xl cursor-pointer hover:brightness-110 transition-all group">
      ...
      <h1 className="text-2xl md:text-5xl font-bold tracking-tight mb-2 uppercase text-foreground">
        {nextEvent.name}
      </h1>

      {/* When fixtures are available, show match tiles; otherwise show description */}
      {nextEvent.fixtures && nextEvent.fixtures.length > 0 ? (
        <div className="mt-3 bg-black/50 rounded-xl border border-white/10 divide-y divide-white/10 overflow-hidden max-w-xl">
          {nextEvent.fixtures.map((fixture) => (
            <div key={fixture.id} className="px-3">
              <ScheduleMatchRow fixture={fixture} />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground max-w-xl text-sm md:text-lg">
          {nextEvent.description}
        </p>
      )}
```

**Variable:** `nextEvent`, defined at line 44:

```ts
const nextEvent = dashboard.nextScheduleEvent;
```

**Field trace:** `dashboard.nextScheduleEvent.fixtures` — an array of individual fixture objects. Each one is rendered by `<ScheduleMatchRow fixture={fixture} />`. This is the **only** place `nextEvent.fixtures` is consumed in the file. If the array is empty, the hero falls back to `{nextEvent.description}` instead.

**Server-side query** (`artifacts/api-server/src/routes/dashboard.ts:203-221`):

```ts
const nextEvent = nextScheduleEventRows[0];
let nextEventFixtures: (typeof fixturesTable.$inferSelect)[] = [];
if (nextEvent?.startDate != null && nextEvent?.endDate != null) {
  const startTs = new Date(nextEvent.startDate + "T00:00:00Z");
  const endExclusive = new Date(
    new Date(nextEvent.endDate + "T00:00:00Z").getTime() + 30 * 60 * 60 * 1000,
  );
  nextEventFixtures = await db
    .select()
    .from(fixturesTable)
    .where(
      and(
        eq(fixturesTable.isNationalTeam, true),
        gte(fixturesTable.kickoff, startTs),
        lt(fixturesTable.kickoff, endExclusive),
      ),
    )
    .orderBy(asc(fixturesTable.kickoff));
}
```

Attached to the response payload as:

```ts
nextScheduleEvent: nextEvent
  ? {
      ...nextEvent,
      fixtures: nextEventFixtures.map((f) => ({ ...f, featuredPlayers: [] })),
    }
  : undefined,
```

This is the query previously described as the "next-event fixture block." It populates `nextScheduleEvent.fixtures`, and that field is rendered **only** inside the hero.

---

### 2. "Upcoming Matches" card — the list of next games below the hero

```tsx
<CardTitle className="text-base md:text-lg uppercase tracking-tight flex items-center gap-2">
  <img src={soccerBall} alt="" aria-hidden="true" style={{ width: 18, height: 18 }} />
  Upcoming Matches
</CardTitle>
<CardDescription>USMNT players in action</CardDescription>
```

```tsx
{(() => {
  const nextGames = [...dashboard.todaysGames, ...dashboard.upcomingGames]
    .sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime())
    .slice(0, 5);

  if (nextGames.length === 0) {
    return (
      <div className="py-8 text-center border border-dashed rounded-lg bg-muted/20">
        <p className="text-muted-foreground font-mono text-sm">NO UPCOMING MATCHES SCHEDULED</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {nextGames.map(game => (
        <FixtureCard key={game.id} fixture={game} showDate />
      ))}
    </div>
  );
})()}
```

**Variable:** `nextGames`, built locally inside an IIFE from `dashboard.todaysGames` and `dashboard.upcomingGames`, concatenated and sorted client-side.

**Field trace:** `dashboard.todaysGames` and `dashboard.upcomingGames` — two separate response fields.

**Server-side queries** (`artifacts/api-server/src/routes/dashboard.ts:47-77`):

```ts
db
  .select()
  .from(fixturesTable)
  .where(and(
    gte(fixturesTable.kickoff, startOfDay),
    lt(fixturesTable.kickoff, endOfDay),
    notInArray(fixturesTable.status, ["finished", "cancelled", "postponed"]),
    or(eq(fixturesTable.isNationalTeam, true), notIlike(fixturesTable.competition, "%Friendlies%")),
    // Only show fixtures that have at least one tagged USMNT player; national-team
    // fixtures are always relevant regardless of fixture_players links.
    or(
      eq(fixturesTable.isNationalTeam, true),
      sql`EXISTS (SELECT 1 FROM fixture_players fp WHERE fp.fixture_id = ${fixturesTable.id})`,
    ),
  ))
  .orderBy(asc(fixturesTable.kickoff)),
// → todaysGamesRaw → attachFeaturedPlayers(...) → todaysGames

db
  .select()
  .from(fixturesTable)
  .where(and(
    gte(fixturesTable.kickoff, endOfDay),
    notInArray(fixturesTable.status, ["finished", "cancelled", "postponed"]),
    or(eq(fixturesTable.isNationalTeam, true), notIlike(fixturesTable.competition, "%Friendlies%")),
    // Same ghost-fixture guard as todaysGames and the Fixtures page.
    or(
      eq(fixturesTable.isNationalTeam, true),
      sql`EXISTS (SELECT 1 FROM fixture_players fp WHERE fp.fixture_id = ${fixturesTable.id})`,
    ),
  ))
  .orderBy(asc(fixturesTable.kickoff))
  .limit(8),
// → upcomingGamesRaw → attachFeaturedPlayers(...) → upcomingGames
```

Both raw result sets are passed through `attachFeaturedPlayers(...)` before landing on the response payload as `todaysGames` / `upcomingGames`.

---

### 3. Everything else on the page (no fixture data)

- **Top Performers** — `dashboard.topPerformers`, no fixture data.
- **Latest Intel** — `dashboard.latestNews`, no fixture data.
- **Transfer Watch** — `dashboard.transfers`, no fixture data.
- **Medical Bay** — `dashboard.injuries`, no fixture data.

None of these render any fixture field. The full file (lines 1-302) contains no other fixture-rendering element — no separate "next match" countdown, no other schedule/event block.

---

## Direct answers

### Which on-screen element renders `nextGames` (Dashboard.tsx:153-168)? Does anything else render from it?

Only the **"Upcoming Matches" card**. `nextGames` is declared inside the IIFE scoped to that one `<CardContent>` block (lines 152-172) and is not referenced anywhere else in the file. Nothing else renders from it.

### The "next-event fixture block" in `routes/dashboard.ts` — which field does it populate, and which element renders it?

It populates `nextScheduleEvent.fixtures`. That field is rendered only inside the hero section, via:

```tsx
{nextEvent.fixtures.map((fixture) => <ScheduleMatchRow fixture={fixture} />)}
```

If `nextEvent.fixtures` is empty, the hero falls back to rendering `{nextEvent.description}` instead. Nothing else in the page reads this field.

### Are the hero and the upcoming-games list fed by the same array, or by different ones?

**Different ones.**

- The hero is fed by `dashboard.nextScheduleEvent.fixtures`, populated by the query at `dashboard.ts:211-221` (filtered by `isNationalTeam = true` plus the schedule-event's kickoff window).
- The upcoming-games list is fed by `dashboard.todaysGames` and `dashboard.upcomingGames`, populated by the two separate queries at `dashboard.ts:47-77` (filtered by date range, status, and the `isNationalTeam` / `Friendlies` / linked-player conditions).

These are independent server-side queries with independent `where` clauses. A condition can be added to one without touching the other.

### Is there anything else on the dashboard that renders fixtures which hasn't been named? Schedule/event blocks, a "next match" countdown, anything.

No. The full file was read start to finish. There is no separate "next match" countdown, no other schedule/event block, and no other fixture-consuming element besides:

1. the hero (`nextEvent.fixtures` via `ScheduleMatchRow`), and
2. the Upcoming Matches card (`nextGames` via `FixtureCard`).
