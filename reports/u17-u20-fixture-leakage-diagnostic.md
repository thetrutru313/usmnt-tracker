# Diagnostic: U17/U20 fixtures leaking into Dashboard hero & USMNT Schedule page

No code, schema, migrations, tests, or workflows were changed. This is a read-only diagnostic.

## Summary

The two affected surfaces both use `isNationalTeam = true` as if it meant "senior USMNT".

- Dashboard fixture queries include every national-team row, including U17/U20.
- Schedule query includes every national-team row, including U17/U20.
- The React components do not remove youth fixtures afterward.
- The Fixtures page deliberately returns all national-team fixtures and has no age-group filtering. Its behavior currently preserves U17/U20 fixtures.

There is no age-group column or senior-only discriminator in the current API contract.

---

# 1. Fixture queries and filters

## A. `GET /api/fixtures/:id`

**File:** `artifacts/api-server/src/routes/fixtures.ts:20`

Fetches exactly one fixture by internal ID:

```ts
db.select().from(fixturesTable).where(eq(fixturesTable.id, id))
```

There is no `isNationalTeam`, team-name, competition, or age-group filter.

Linked players are fetched with:

```ts
.where(eq(fixturePlayersTable.fixtureId, id))
```

The fixture-detail match-log query applies:

```ts
and(
  inArray(matchLogsTable.playerId, playerIds),
  eq(matchLogsTable.apiFootballFixtureId, fixture.apiFootballFixtureId),
)
```

If the fixture has no API-Football ID, the fallback is gated only by:

```ts
else if (fixture.isNationalTeam)
```

That is a boolean check and does not distinguish senior, U17, or U20.

---

## B. `GET /api/fixtures`

**File:** `artifacts/api-server/src/routes/fixtures.ts:206-267`

### Base filter

```ts
const conditions = [
  or(
    eq(fixturesTable.isNationalTeam, true),
    notIlike(fixturesTable.competition, "%Friendlies%"),
  ),
];
```

This means:

- All rows with `isNationalTeam = true` are retained.
- Youth rows are therefore retained.
- Non-national-team competitions whose name does not contain `Friendlies` are also retained.
- Competition is not used to distinguish senior from youth.

### Ghost-fixture filter

When `playerId` is absent, this additional condition is applied:

```ts
or(
  eq(fixturesTable.isNationalTeam, true),
  lt(fixturesTable.kickoff, new Date()),
  sql`EXISTS (
    SELECT 1
    FROM fixture_players fp
    WHERE fp.fixture_id = ${fixturesTable.id}
  )`,
)
```

Again, all national-team fixtures bypass the link requirement, including youth fixtures.

### Scope filters

For `scope === "today"`:

```ts
conditions.push(
  gte(fixturesTable.kickoff, startOfDay),
  lt(fixturesTable.kickoff, endOfDay),
);
```

For `scope === "upcoming"`:

```ts
conditions.push(gte(fixturesTable.kickoff, new Date()));
```

For `scope === "all"` there is no date filter.

### Player filter

When `playerId` is supplied:

```ts
.where(eq(fixturePlayersTable.playerId, playerId))
```

Then the fixture query receives:

```ts
conditions.push(inArray(fixturesTable.id, fixtureIds));
```

### Conclusion for the Fixtures page

The Fixtures API is the layer that returns the fixtures. It does not filter client-visible national-team rows by senior/youth name. That is why the Fixtures page can continue showing all age groups.

---

## C. Dashboard fixture queries

**File:** `artifacts/api-server/src/routes/dashboard.ts`

The dashboard has three fixture-producing paths.

### C1. `todaysGamesRaw`

```ts
.where(and(
  gte(fixturesTable.kickoff, startOfDay),
  lt(fixturesTable.kickoff, endOfDay),
  notInArray(fixturesTable.status, ["finished", "cancelled", "postponed"]),
  or(
    eq(fixturesTable.isNationalTeam, true),
    notIlike(fixturesTable.competition, "%Friendlies%"),
  ),
  or(
    eq(fixturesTable.isNationalTeam, true),
    sql`EXISTS (
      SELECT 1
      FROM fixture_players fp
      WHERE fp.fixture_id = ${fixturesTable.id}
    )`,
  ),
))
```

The problematic condition is:

```ts
eq(fixturesTable.isNationalTeam, true)
```

That includes senior, U17, and U20.

### C2. `upcomingGamesRaw`

```ts
.where(and(
  gte(fixturesTable.kickoff, endOfDay),
  notInArray(fixturesTable.status, ["finished", "cancelled", "postponed"]),
  or(
    eq(fixturesTable.isNationalTeam, true),
    notIlike(fixturesTable.competition, "%Friendlies%"),
  ),
  or(
    eq(fixturesTable.isNationalTeam, true),
    sql`EXISTS (
      SELECT 1
      FROM fixture_players fp
      WHERE fp.fixture_id = ${fixturesTable.id}
    )`,
  ),
))
```

Again, the national-team branch includes all age groups.

### C3. Dashboard next-event fixture block

```ts
.where(
  and(
    eq(fixturesTable.isNationalTeam, true),
    gte(fixturesTable.kickoff, startTs),
    lt(fixturesTable.kickoff, endExclusive),
  ),
)
```

This is the direct source for fixtures attached to the dashboard's schedule/hero event area. It includes all rows where `isNationalTeam = true`, including U17/U20.

### Dashboard React rendering

**File:** `artifacts/usmnt-tracker/src/pages/Dashboard.tsx:153-168`

The client combines the API results and sorts them:

```ts
const nextGames = [...dashboard.todaysGames, ...dashboard.upcomingGames]
  .sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime())
  .slice(0, 5);
```

It then renders every returned row:

```tsx
{nextGames.map(game => (
  <FixtureCard key={game.id} fixture={game} showDate />
))}
```

There is no team-name or age-group exclusion in the dashboard component.

---

## D. `GET /api/schedule`

**File:** `artifacts/api-server/src/routes/schedule.ts:56-66`

The schedule query is:

```ts
.where(
  and(
    eq(fixturesTable.isNationalTeam, true),
    gte(fixturesTable.kickoff, new Date(minStart + "T00:00:00Z")),
    lt(fixturesTable.kickoff, maxEndExclusive),
  ),
)
```

This includes every national-team fixture inside the event-date bounding window, regardless of whether the teams are:

- `USA`
- `United States U17`
- `United States U20`
- another national-team row

The per-event client-side grouping only applies date-window matching:

```ts
const matching = ntFixtures.filter(
  (f) => f.kickoff >= start && f.kickoff < endExclusive,
);
```

It does not inspect team names.

### Schedule React rendering

**File:** `artifacts/usmnt-tracker/src/pages/Schedule.tsx`

The page calls:

```ts
const { data, isLoading, error } = useListScheduleEvents();
```

It renders the returned event fixtures through `ScheduleMatchRow`. No age-group or team-name filtering is applied in the React page.

---

## E. Player profile upcoming fixtures

**File:** `artifacts/api-server/src/routes/players.ts:81-98`

First obtains all fixtures linked to the player:

```ts
.where(eq(fixturePlayersTable.playerId, id))
```

Then fetches those fixtures using:

```ts
and(
  inArray(
    fixturesTable.id,
    upcomingFixtureIds.map((r) => r.fixtureId),
  ),
  gte(
    fixturesTable.kickoff,
    new Date(Date.now() - 1000 * 60 * 60 * 24),
  ),
)
```

There is no `isNationalTeam` or team-name filter.

The client renders the first three:

```tsx
{player.upcomingFixtures.slice(0, 3).map(fixture => (
```

This is not one of the named dashboard/schedule surfaces, but it can display any linked national-team age group.

---

## F. Fixture featured-player helper

**File:** `artifacts/api-server/src/lib/queries.ts:383-408`

The helper joins fixture-player links to fixtures:

```ts
.innerJoin(
  fixturesTable,
  eq(fixturePlayersTable.fixtureId, fixturesTable.id),
)
.where(inArray(fixturePlayersTable.fixtureId, fixtureIds));
```

It selects fixture status but does not filter by:

- `isNationalTeam`
- `homeTeam`
- `awayTeam`
- `competition`
- age group

This helper enriches fixtures already selected by the API routes.

---

## G. Fixture reconciliation queries

**File:** `artifacts/api-server/src/lib/fixtureReconciliation.ts`

These are maintenance queries, not UI surface queries.

### Tracked club fixtures

```ts
.where(
  and(
    inArray(fixturePlayersTable.playerId, clubPlayerIds),
    inArray(fixturesTable.status, ["scheduled", "live"]),
  ),
)
```

No national-team or team-name filter is applied. The query is scoped by player links and status.

### Upcoming non-national-team purge

```ts
.where(
  and(
    eq(fixturesTable.isNationalTeam, false),
    inArray(fixturesTable.status, ["scheduled", "live"]),
    gt(fixturesTable.kickoff, retentionCutoff),
    notExists(
      db
        .select({ one: sql`1` })
        .from(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, fixturesTable.id)),
    ),
  ),
)
```

This explicitly excludes all national-team rows, but it does not distinguish senior/youth because that distinction is not needed for this cleanup.

### Past orphan purge

```ts
.where(
  and(
    inArray(fixturesTable.status, ["scheduled", "live"]),
    lt(fixturesTable.kickoff, nowDate),
    notExists(
      db
        .select({ one: sql`1` })
        .from(fixturePlayersTable)
        .where(eq(fixturePlayersTable.fixtureId, fixturesTable.id)),
    ),
  ),
)
```

No national-team or team-name condition.

### Stale postponed purge

```ts
.where(
  and(
    eq(fixturesTable.status, "postponed"),
    lt(fixturesTable.kickoff, cutoff),
  ),
)
```

No national-team or team-name condition.

---

## H. Internal `apiFootballSync.ts` fixture queries

**File:** `artifacts/api-server/src/lib/apiFootballSync.ts`

### Club repair pass

```ts
.where(
  and(
    inArray(fixturesTable.apiFootballFixtureId, freshApiIds),
    inArray(fixturesTable.status, ["scheduled", "live"]),
  ),
)
```

No age-group or national-team filter. This operates on fixtures belonging to tracked clubs.

### National-team repair pass: upcoming rows

```ts
.where(
  and(
    eq(fixturesTable.isNationalTeam, true),
    inArray(fixturesTable.status, ["scheduled", "live"]),
  ),
)
```

This includes senior, U17, and U20 rows.

### National-team repair pass: finished history

```ts
.where(
  and(
    eq(fixturesTable.isNationalTeam, true),
    eq(fixturesTable.competition, competition),
    eq(fixturesTable.status, "finished"),
  ),
)
```

This groups all national-team age groups together when their competition string matches.

### Senior sync row selection

```ts
.where(eq(fixturesTable.isNationalTeam, true))
```

Then it applies the existing JavaScript workaround:

```ts
const usaRows = seededRows.filter(
  (f) => f.homeTeam === "USA" || f.awayTeam === "USA",
);
```

This is senior-only in practice because it requires the exact team name `"USA"`.

This path is `syncNationalTeamFixtures()`. Per the supplied facts, it is not involved in the current issue because there are no unbound sentinels. No changes were made to it.

### Youth phantom-purge candidate query

```ts
.where(
  and(
    eq(fixturesTable.isNationalTeam, true),
    isNotNull(fixturesTable.apiFootballFixtureId),
  ),
)
```

The subsequent JavaScript logic identifies the youth cohort by team-name regex:

```ts
const ageGroupPattern = new RegExp(`\\b${ageGroup}\\b`);

if (
  ageGroupPattern.test(row.homeTeam) ||
  ageGroupPattern.test(row.awayTeam)
) {
  ownerSeenIds = seenIds;
  break;
}
```

Senior `"USA"` rows have no `U17`/`U20` suffix and are skipped by this logic.

### Youth sync existing-row lookup

```ts
.where(eq(fixturesTable.apiFootballFixtureId, f.fixture.id))
```

This is an exact provider-ID lookup and does not filter by age group.

---

## I. `usmntSync.ts`

**File:** `artifacts/api-server/src/lib/usmntSync.ts`

### Sentinel promotion query

```ts
.where(
  and(
    eq(fixturesTable.isNationalTeam, true),
    or(
      isNull(fixturesTable.apiFootballFixtureId),
      lt(fixturesTable.apiFootballFixtureId, 0),
    ),
  ),
)
.orderBy(asc(fixturesTable.kickoff))
```

This is the sentinel path. The supplied facts state that all 666 fixtures have positive IDs, so this returns no rows and exits via the fast path.

No changes were made to this path.

### Live-fixture polling query

```ts
.where(
  and(
    eq(fixturesTable.status, "live"),
    isNotNull(fixturesTable.apiFootballFixtureId),
  ),
)
```

This applies to all live fixtures, including any live youth fixture. It updates status, scores, and elapsed minute; it does not create or classify fixtures.

---

# 2. React components, hooks, and generated API code

## Fixtures page

**File:** `artifacts/usmnt-tracker/src/pages/Fixtures.tsx`

The page requests:

```ts
useListFixtures({ scope: "all" }, ...)
```

There is no national-team or age-group parameter.

Client-side filters are only:

### Player-pool filter

```ts
fixtures.filter((fixture) =>
  fixture.featuredPlayers.some((p) => poolFilter.includes(p.poolTier)),
)
```

### My Players filter

```ts
filteredFixtures.filter((fixture) =>
  fixture.featuredPlayers.some((p) => followedIds.has(p.id)),
)
```

### Upcoming display filter

```ts
filteredFixtures.filter(
  (f) =>
    f.status === "live" ||
    (
      f.status !== "finished" &&
      new Date(f.kickoff).getTime() > nowMs - TWO_HOURS_MS
    ),
)
```

### Finished display filter

```ts
filteredFixtures.filter(
  (f) => f.status === "finished" && new Date(f.kickoff) >= sevenDaysAgo,
)
```

None of these filters distinguish senior from youth.

**Conclusion:** the Fixtures page filters only at the client for pool, followed players, status, and date presentation. The API layer supplies all national-team rows. There is currently no age-group exclusion to remove.

## Dashboard component

The dashboard only sorts and truncates the already-filtered API data:

```ts
[...dashboard.todaysGames, ...dashboard.upcomingGames]
  .sort(...)
  .slice(0, 5)
```

No team-name filter.

## Schedule component

`Schedule.tsx` calls `useListScheduleEvents()` and renders the returned fixtures. No client-side age-group filter.

## FixtureCard

**File:** `artifacts/usmnt-tracker/src/components/FixtureCard.tsx`

The only national-team conditional is presentation:

```tsx
{fixture.isNationalTeam && (
  <Badge ...>
    INTERNATIONAL
  </Badge>
)}
```

This is not a filter.

## MatchDetail

**File:** `artifacts/usmnt-tracker/src/pages/MatchDetail.tsx`

Uses:

```ts
useGetFixture(fixtureId, ...)
```

The only national-team use is presentation:

```tsx
{fixture.isNationalTeam && (...)}
```

No senior/youth filtering.

## PlayerProfile

The match-history client filter is based on match-log classification:

```ts
.filter(
  match =>
    matchFilter === "all" ||
    (matchFilter === "usmnt") === match.isNationalTeam,
)
```

This is not team-name matching and is not a fixture age-group filter.

## Generated hooks

**File:** `lib/api-client-react/src/generated/api.ts`

The generated hooks/functions only construct API requests:

- `useListFixtures`
- `getListFixtures`
- `useGetFixture`
- `getFixture`
- `useListScheduleEvents`

They contain no fixture filtering logic beyond forwarding the API parameters.

---

# 3. OpenAPI specification

**File:** `lib/api-spec/openapi.yaml`

The list endpoint exposes only:

```yaml
- name: scope
  in: query
  schema:
    type: string
    enum: [today, upcoming, all]
- name: playerId
  in: query
  schema:
    type: integer
```

There is no senior/youth or age-group parameter.

The `Fixture` schema exposes:

```yaml
isNationalTeam: { type: boolean }
homeTeam: { type: string }
awayTeam: { type: string }
competition: { type: string }
```

There is no age-group field.

The dashboard schema exposes:

```yaml
todaysGames:
  type: array
  items:
    $ref: "#/components/schemas/Fixture"

upcomingGames:
  type: array
  items:
    $ref: "#/components/schemas/Fixture"
```

The schedule/event fixture arrays also use the same generic `Fixture` schema.

---

# 4. Every fixture-row write path

## A. Seed script

**File:** `scripts/src/seedUsmnt.ts:390`

The seed script directly inserts one senior national-team fixture:

```ts
.insert(fixturesTable)
.values({
  isNationalTeam: f.isNationalTeam,
  competition: f.competition,
  kickoff: isoDateTimeOffset(f.daysFromNow, f.hour),
  venue: f.venue,
  homeTeam: f.homeTeam,
  awayTeam: f.awayTeam,
  homeLogoUrl: TEAM_LOGOS[f.homeTeam] ?? null,
  awayLogoUrl: TEAM_LOGOS[f.awayTeam] ?? null,
  homeScore: f.homeScore,
  awayScore: f.awayScore,
  status: f.status,
  tvNetwork: f.tvNetwork,
  streamingService: f.streamingService,
  broadcastLink: f.broadcastLink,
})
```

The current seed definition is:

```ts
{
  isNationalTeam: true,
  competition: "FIFA World Cup",
  homeTeam: "USA",
  awayTeam: "Belgium",
  ...
}
```

The seed script currently does not define U17/U20 fixtures.

---

## B. Startup senior sentinel seed

**File:** `artifacts/api-server/src/index.ts`

The startup SQL inserts four senior fixtures with exact `"USA"` home-team names:

```sql
INSERT INTO fixtures (
  api_football_fixture_id,
  home_team,
  away_team,
  ...
  is_national_team,
  status
)
```

Examples:

```sql
( ... , 'USA', 'Peru', ... )
( ... , 'USA', 'Chile', ... )
( ... , 'USA', 'Mexico', ... )
( ... , 'USA', 'Canada', ... )
```

These are sentinel rows with negative IDs and are not involved according to the supplied facts because no unbound sentinels remain.

---

## C. Startup youth fixture seed

**File:** `artifacts/api-server/src/index.ts`

The startup block directly inserts U20/U17 rows:

```sql
INSERT INTO fixtures (
  api_football_fixture_id,
  home_team,
  away_team,
  home_logo_url,
  away_logo_url,
  competition,
  kickoff,
  venue,
  tv_network,
  streaming_service,
  is_national_team,
  status
)
VALUES
  (..., 'United States U20', 'Haiti U20', ..., 'CONCACAF U20', ..., true, 'scheduled'),
  (..., 'El Salvador U20', 'United States U20', ..., 'CONCACAF U20', ..., true, 'scheduled'),
  (..., 'United States U20', 'Cuba U20', ..., 'CONCACAF U20', ..., true, 'scheduled'),
  (..., 'United States U17', 'Montenegro U17', ..., 'World Cup - U17', ..., true, 'scheduled'),
  (..., 'United States U17', 'Chile U17', ..., 'World Cup - U17', ..., true, 'scheduled'),
  (..., 'Algeria U17', 'United States U17', ..., 'World Cup - U17', ..., true, 'scheduled')
```

This is one direct cause of the rows reaching the dashboard and Schedule API, because these rows have:

```sql
is_national_team = true
```

---

## D. Club fixture sync upsert

**File:** `artifacts/api-server/src/lib/apiFootballSync.ts`

The club sync inserts or updates rows from API-Football.

The insert/update path is:

```ts
await db.update(fixturesTable).set(values).where(eq(fixturesTable.id, existing.id));
```

or:

```ts
const [inserted] = await db
  .insert(fixturesTable)
  .values(values)
  .returning({ id: fixturesTable.id });
```

The `values` object sets national-team status using:

```ts
isNationalTeam:
  isUsMensNationalTeamName(f.teams.home.name) ||
  isUsMensNationalTeamName(f.teams.away.name),
```

Therefore this path can classify both senior and youth API-Football fixtures as national-team rows.

The provider-side upcoming filter before this upsert is:

```ts
seasonFixtures
  .filter(
    (f) =>
      f.fixture.status.short === "NS" &&
      new Date(f.fixture.date).getTime() > now,
  )
  .sort(...)
  .slice(0, 8)
```

---

## E. Senior national-team sync

**Function:** `syncNationalTeamFixtures()`
**File:** `artifacts/api-server/src/lib/apiFootballSync.ts`

This path updates existing rows only:

```ts
await db.update(fixturesTable)
  .set(updatePayload)
  .where(eq(fixturesTable.id, row.id));
```

It selects:

```ts
.where(eq(fixturesTable.isNationalTeam, true))
```

Then restricts in JavaScript to exact senior team names:

```ts
const usaRows = seededRows.filter(
  (f) => f.homeTeam === "USA" || f.awayTeam === "USA",
);
```

This is already a team-name workaround for senior rows.

It does not insert fixture rows.

---

## F. Youth national-team sync

**Function:** `syncYouthNtFixtures()`
**File:** `artifacts/api-server/src/lib/apiFootballSync.ts`

It fetches API-Football fixtures for:

```ts
const YOUTH_NT_TEAMS = [
  { teamId: 10306, label: "US U20" },
  { teamId: 12522, label: "US U17" },
];
```

It filters the returned provider fixtures with:

```ts
const usFixtures = afFixtures.filter(
  (f) =>
    isUsMensNationalTeamName(f.teams.home.name) ||
    isUsMensNationalTeamName(f.teams.away.name),
);
```

For an existing database row, it updates:

```ts
await db
  .update(fixturesTable)
  .set({
    status: newStatus,
    homeScore: newHomeScore,
    awayScore: newAwayScore,
    elapsedMinute: newElapsed,
  })
  .where(eq(fixturesTable.id, existing.id));
```

For a new row, it inserts:

```ts
await db.insert(fixturesTable).values({
  apiFootballFixtureId: f.fixture.id,
  isNationalTeam: true,
  competition: f.league.name,
  kickoff: new Date(f.fixture.date),
  venue: f.fixture.venue.name ?? "TBD",
  homeTeam: f.teams.home.name,
  awayTeam: f.teams.away.name,
  homeLogoUrl: f.teams.home.logo,
  awayLogoUrl: f.teams.away.logo,
  status: newStatus,
  elapsedMinute: newElapsed,
  tvNetwork: broadcast.tvNetwork,
  streamingService: broadcast.streamingService,
});
```

This is the direct live-sync path that creates future U17/U20 fixture rows with:

```ts
isNationalTeam: true
```

---

## G. Youth phantom purge

**Function:** `purgePhantomYouthNtFixtures()`
**File:** `artifacts/api-server/src/lib/apiFootballSync.ts`

It deletes, rather than inserts, rows after identifying U17/U20 by team-name regex. The deletion path is:

```ts
await db.delete(fixturesTable).where(eq(fixturesTable.id, row.id));
```

The youth/senior distinction is based on:

```ts
const ageGroupPattern = new RegExp(`\\b${ageGroup}\\b`);

if (
  ageGroupPattern.test(row.homeTeam) ||
  ageGroupPattern.test(row.awayTeam)
) {
  ownerSeenIds = seenIds;
  break;
}
```

Senior `"USA"` rows are excluded because they do not contain the relevant age-group suffix.

---

## H. Sentinel promotion in `usmntSync.ts`

**Function:** `promoteNtSentinelIds()`

This updates an existing fixture:

```ts
await db
  .update(fixturesTable)
  .set({ apiFootballFixtureId: bestId })
  .where(eq(fixturesTable.id, fixture.id));
```

It never inserts a row.

Its selection condition is:

```ts
and(
  eq(fixturesTable.isNationalTeam, true),
  or(
    isNull(fixturesTable.apiFootballFixtureId),
    lt(fixturesTable.apiFootballFixtureId, 0),
  ),
)
```

The supplied facts state that no fixtures meet this condition now.

---

## I. Live polling in `usmntSync.ts`

**Function:** `pollLiveFixtures()`

It updates existing live rows:

```ts
await db
  .update(fixturesTable)
  .set({
    status: freshStatus,
    homeScore: freshHomeScore,
    awayScore: freshAwayScore,
    elapsedMinute: freshElapsed,
  })
  .where(eq(fixturesTable.id, row.id));
```

It does not insert or classify fixtures.

---

## J. Fixture reconciliation

**File:** `artifacts/api-server/src/lib/fixtureReconciliation.ts`

This module updates existing fixture rows when API data changes:

```ts
.update(fixturesTable)
.set({ ... })
.where(eq(fixturesTable.id, tracked.id))
```

It also deletes stale/orphaned rows:

```ts
.delete(fixturesTable)
.where(inArray(fixturesTable.id, orphanIds))
```

It has no fixture-row insert path.

---

## K. Admin panel routes

**File:** `artifacts/api-server/src/routes/admin.ts`

The admin panel does not directly insert into `fixtures`.

It triggers these writers:

### Club fixture sync

```
POST /admin/trigger-fixtures-sync
```

Calls:

```ts
syncApiFootballFixtures(playerIds)
```

### Senior national-team sync

```
POST /admin/trigger-nt-sync
```

Calls:

```ts
syncNationalTeamFixtures()
```

### Youth national-team sync

```
POST /admin/trigger-youth-nt-sync
```

Calls:

```ts
syncYouthNtFixtures()
```

The youth admin endpoint is therefore an indirect fixture-row insert/update path.

---

# 5. Existing team-name workarounds

## Yes — backend sync logic already uses team names

### Senior exact-name check

```ts
f.homeTeam === "USA" || f.awayTeam === "USA"
```

Location:

- `artifacts/api-server/src/lib/apiFootballSync.ts`
- `syncNationalTeamFixtures()`

This selects senior rows only, but only in that sync path.

### Senior/youth national-team classifier

```ts
function isUsMensNationalTeamName(name: string): boolean {
  if (name === "USA") return true;
  return /^(USA|United States) U\d+$/.test(name);
}
```

This explicitly matches:

- `"USA"`
- `"USA U17"`
- `"USA U20"`
- `"United States U17"`
- `"United States U20"`

It is used by:

- club fixture sync classification
- youth national-team fixture filtering

### Youth purge classifier

```ts
const ageGroupPattern = new RegExp(`\\b${ageGroup}\\b`);

if (
  ageGroupPattern.test(row.homeTeam) ||
  ageGroupPattern.test(row.awayTeam)
) {
  ownerSeenIds = seenIds;
  break;
}
```

This is used to identify U17/U20 rows during phantom cleanup.

## No — the affected presentation surfaces do not use this workaround

The Dashboard API and Schedule API use only:

```ts
eq(fixturesTable.isNationalTeam, true)
```

Neither applies:

```ts
homeTeam === "USA"
```

nor a regular expression that excludes `U17`/`U20`.

The React Dashboard, Schedule, and FixtureCard components also do not perform team-name filtering.

## Other unrelated name matching

There are additional `"USA"` and national-team name checks in:

- `artifacts/api-server/src/lib/evaluateEligibility.ts`
- `artifacts/api-server/src/lib/commitmentTracker.ts`
- `artifacts/api-server/src/lib/playerDiscovery.ts`

Those concern player eligibility, nationality, or team discovery. They do not query or filter rows from `fixtures`.

---

# 6. Fixtures-page behavior

The Fixtures page is safe with respect to the stated requirement that all age groups continue appearing there:

1. It requests:

   ```ts
   useListFixtures({ scope: "all" })
   ```

2. The API's national-team branch is:

   ```ts
   eq(fixturesTable.isNationalTeam, true)
   ```

3. There is no age-group field or client-side senior-only filter.

4. The client-side filters are limited to:
   - player pool
   - followed players
   - live/upcoming time presentation
   - recent finished fixtures

Therefore, the Fixtures page currently receives and retains U17/U20 fixtures as intended. The unwanted youth leakage is specifically in the Dashboard and Schedule selection logic, where `isNationalTeam` is being treated as equivalent to "senior USMNT."
