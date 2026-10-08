# Squad player additions and API-ID correction

## Step 0 — read-only evidence

**Confirmed:** all preflight checks passed in production and development.

| Check | Production | Development |
|---|---|---|
| Mathis Albert | Pool ID 25; birth date NULL; Borussia Dortmund, club ID 10, API team ID 165; API player ID NULL | Same |
| API player IDs 102508 / 266733 / 486522 | All absent | All absent |
| API team ID 60 | Absent | Absent |
| Club name contains “brom”, case-insensitive | No rows | No rows |
| Nashville SC, API team ID 9569 | Club ID 327 | Club ID 16186 |
| `george-campbell` / `brian-schwake` | Both absent | Both absent |
| Four target fixtures | All four present | All four present |
| `fixtures.squad_synced_at` | Nullable timestamptz exists | Nullable timestamptz exists |

### Pool conventions

**Confirmed:** executing the existing `slugify` function gives `george-campbell`
and `brian-schwake`. Existing position values are `DF`, `FW`, `GK`, `MF`;
category values are `current`, `fringe`, `prospect`. Campbell uses `DF`, Schwake
uses `GK`, and both use the approved `fringe` category.

The candidate promotion path sets name, slug, position, category, club, age,
API player ID, caps/goals 0, bio empty, roster false, and optional eligibility
confidence. This SQL follows those conventions, with the requested birth dates
and computed ages. It does not invent candidate confidence.

**Confirmed database defaults, identical in dev and production:**

- IDs: sequence-generated; omitted from inserts.
- `national_team_caps`, `national_team_goals`: 0.
- `world_cup_roster`, `needs_review`: false.
- `bio`: empty string.
- `created_at`: `now()`.
- Other omitted player columns are nullable, with no non-null default:
  `photo_url`, `contract_until`, `market_value_usd`, `youth_national_team`,
  `debut_date`, `potential_call_up_score`, `wikipedia_title`,
  `squad_last_checked_at`, `usmnt_status`, `eligibility_confidence`,
  `club_override_id`, `club_override_set_at`.
- Club IDs and creation timestamps use their sequence/`now()` defaults.

### English club conventions and West Brom proposal

**Confirmed:** existing English rows use short club names, country `England`,
league `Premier League` or `Championship`, and logos shaped as
`https://media.api-sports.io/football/teams/<API-team-ID>.png`.

Examples, identical in both databases: Bournemouth / Premier League / England /
team 35 logo; Norwich City / Championship / England / team 71 logo;
Middlesbrough / Championship / England / team 70 logo.

**Confirmed provider results:** `/teams?id=60` returned West Brom, England,
and `https://media.api-sports.io/football/teams/60.png`.
`/leagues?team=60&season=2026` returned Championship (league ID 40), plus
League Cup and Friendlies Clubs. Proposed inserted values are therefore:
`West Brom`, `Championship`, `England`, the team 60 logo URL, API team ID 60.
Exactly two API calls were made for this evidence.

## Exact SQL — unchanged for dev and production

This is a single statement. `BEGIN` below is the required PL/pgSQL block
delimiter, not a separate transaction command. There are no transaction-control
or locking statements. Run only after reviewing the preflight evidence.

```sql
DO $add_squad_players$
DECLARE
  v_west_brom_id integer;
  v_nashville_id integer;
  v_albert_id integer;
  v_rows integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM players
    WHERE api_football_player_id IN (102508, 266733, 486522)
  ) THEN
    RAISE EXCEPTION 'Guard failed: one or more squad API player IDs already exist';
  END IF;

  IF (
    SELECT count(*) FROM players
    WHERE name = 'Mathis Albert' AND api_football_player_id IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'Guard failed: expected exactly one Mathis Albert with NULL API ID';
  END IF;

  SELECT p.id INTO v_albert_id
  FROM players p
  JOIN clubs c ON c.id = p.club_id
  WHERE p.name = 'Mathis Albert'
    AND p.api_football_player_id IS NULL
    AND (p.date_of_birth IS NULL OR p.date_of_birth = '2009-05-21')
    AND c.name = 'Borussia Dortmund';
  IF v_albert_id IS NULL THEN
    RAISE EXCEPTION 'Guard failed: Mathis Albert birth date or club does not match';
  END IF;

  IF (
    SELECT count(*) FROM clubs WHERE api_football_team_id = 9569
  ) <> 1 THEN
    RAISE EXCEPTION 'Guard failed: expected exactly one Nashville SC club';
  END IF;
  SELECT id INTO v_nashville_id
  FROM clubs WHERE api_football_team_id = 9569;

  IF EXISTS (
    SELECT 1 FROM players
    WHERE slug IN ('george-campbell', 'brian-schwake')
  ) THEN
    RAISE EXCEPTION 'Guard failed: one or more new player slugs already exist';
  END IF;

  IF (
    SELECT count(*) FROM fixtures
    WHERE api_football_fixture_id IN (1628997, 1629002, 1629004, 1629007)
  ) <> 4 OR (
    SELECT count(DISTINCT api_football_fixture_id) FROM fixtures
    WHERE api_football_fixture_id IN (1628997, 1629002, 1629004, 1629007)
  ) <> 4 THEN
    RAISE EXCEPTION 'Guard failed: expected exactly the four target fixtures';
  END IF;

  SELECT id INTO v_west_brom_id
  FROM clubs WHERE api_football_team_id = 60;
  IF v_west_brom_id IS NULL THEN
    INSERT INTO clubs (name, league, country, logo_url, api_football_team_id)
    VALUES (
      'West Brom', 'Championship', 'England',
      'https://media.api-sports.io/football/teams/60.png', 60
    )
    RETURNING id INTO v_west_brom_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'Write count failed: expected 1 West Brom club, got %', v_rows;
    END IF;
  END IF;

  INSERT INTO players (
    name, slug, position, category, club_id, api_football_player_id,
    age, date_of_birth, national_team_caps, national_team_goals,
    world_cup_roster, bio
  )
  VALUES
    (
      'George Campbell', 'george-campbell', 'DF', 'fringe',
      v_west_brom_id, 102508,
      extract(year FROM age(current_date, DATE '2001-06-22'))::integer,
      '2001-06-22', 0, 0, false, ''
    ),
    (
      'Brian Schwake', 'brian-schwake', 'GK', 'fringe',
      v_nashville_id, 266733,
      extract(year FROM age(current_date, DATE '2001-08-24'))::integer,
      '2001-08-24', 0, 0, false, ''
    );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 2 THEN
    RAISE EXCEPTION 'Write count failed: expected 2 player inserts, got %', v_rows;
  END IF;

  UPDATE players
  SET api_football_player_id = 486522
  WHERE id = v_albert_id
    AND name = 'Mathis Albert'
    AND api_football_player_id IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Write count failed: expected 1 player update, got %', v_rows;
  END IF;

  UPDATE fixtures
  SET squad_synced_at = NULL
  WHERE api_football_fixture_id IN (1628997, 1629002, 1629004, 1629007);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 4 THEN
    RAISE EXCEPTION 'Write count failed: expected 4 fixture updates, got %', v_rows;
  END IF;
END;
$add_squad_players$;
```

## Read-only verification SELECT — do not run here in production

The fixtures remain NULL until the next squad sync runs; they should then
have timestamps. This SELECT is emitted for the user, not executed against
production during this task.

```sql
SELECT jsonb_build_object(
  'players', (
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'slug', p.slug,
      'api_football_player_id', p.api_football_player_id,
      'position', p.position, 'category', p.category,
      'age', p.age, 'date_of_birth', p.date_of_birth,
      'club_id', c.id, 'club', c.name,
      'national_team_caps', p.national_team_caps,
      'national_team_goals', p.national_team_goals,
      'world_cup_roster', p.world_cup_roster
    ) ORDER BY p.name)
    FROM players p JOIN clubs c ON c.id = p.club_id
    WHERE p.api_football_player_id IN (102508, 266733, 486522)
  ),
  'west_brom', (
    SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'league', league, 'country', country,
      'logo_url', logo_url, 'api_football_team_id', api_football_team_id
    ))
    FROM clubs WHERE api_football_team_id = 60
  ),
  'fixtures', (
    SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'api_football_fixture_id', api_football_fixture_id,
      'squad_synced_at', squad_synced_at
    ) ORDER BY api_football_fixture_id)
    FROM fixtures
    WHERE api_football_fixture_id IN (1628997, 1629002, 1629004, 1629007)
  )
) AS verification;
```

## Step 2 — dev application and verification

### 2a — SQL application

**Confirmed:** the exact block above returned `DO` successfully in development.
Every `GET DIAGNOSTICS` assertion passed: one West Brom club inserted, two
players inserted, one Albert row updated, and four fixtures updated.

Dev player IDs are George Campbell 19077 and Brian Schwake 19078. Both ages
computed to 25, both are fringe, both have the approved birth date and club,
both have caps/goals 0, and both have roster false. Mathis Albert remains row 25;
only his API ID was updated. His existing birth date remains NULL and his
category remains prospect.

West Brom's sequence-assigned dev club ID is 17156. The exact emitted
verification SELECT was also executed successfully in dev only.

### 2b — one explicit senior squad sync

**Confirmed:** ran `syncSeniorNtSquads()` exactly once in an isolated temporary
runner using the existing implementation and dev database. No startup schedules
were launched.

| Returned measure | Expected | Actual |
|---|---:|---:|
| Fixtures squad-synced | 4 | 4 |
| Links inserted | 12 | 12 |
| Logs inserted | 8 | 8 |
| Campbell new logs | 2 | 2 |
| Albert new logs | 4 | 4 |
| Schwake new logs | 2 | 2 |
| Fixtures linked from logs | Not specified | 0 |
| Links removed | Not specified | 0 |
| API calls made | Not specified | 8 |

No differences from the specified expectations. All eight provider calls
returned HTTP 200: `/fixtures/players` and `/fixtures?id=` for each target
fixture, newest first.

### 2c — fixture results

**Confirmed:** all four have the expected 26 links. “With log” means a
national-team log for that exact API fixture ID; counting uses `EXISTS` to
avoid duplicate-log inflation.

| Opponent | API fixture ID | Dev fixture ID | Links | With log | Without log |
|---|---:|---:|---:|---:|---:|
| Peru | 1628997 | 19167 | 26 | 21 | 5 |
| Chile | 1629002 | 19168 | 26 | 20 | 6 |
| Mexico | 1629004 | 19169 | 26 | 16 | 10 |
| Canada | 1629007 | 19170 | 26 | 19 | 7 |

All four were stamped `2026-10-08T01:53:13.042Z`.

The eight new logs contain Campbell: Peru 87, Canada 74; Albert: Peru 29,
Chile 19, Mexico 2, Canada 61; Schwake: Chile 45, Canada 90.

### 2d — HTTP route verification

**Confirmed:** a real HTTP `GET /api/fixtures/19170` against the unchanged
Express app and development database returned 200 and 26 tracked players.

| Player | Appears? | Expected minutes | Actual minutes |
|---|---|---:|---:|
| George Campbell | Yes | 74 | 74 |
| Mathis Albert | Yes | 61 | 61 |
| Brian Schwake | Yes | 90 | 90 |

The request used Supertest's temporary HTTP listener, not a mocked handler or
mocked database. The proxy URL returned 502 because the managed workflows were
not started. The isolated HTTP check avoided launching unrelated startup syncs;
the browser/proxy path was not verified.

### 2e — second SQL execution

**Confirmed:** executing the identical block again failed at its first guard:

`Guard failed: one or more squad API player IDs already exist`

Before/after row counts and MD5 fingerprints of every full row, ordered by ID,
were identical for all potentially written tables:

| Table | Rows before and after |
|---|---:|
| clubs | 102 |
| players | 79 |
| fixtures | 962 |
| fixture_players | 1694 |
| match_logs | 1338 |

The guard rejects the second execution before any write or sequence allocation.

## API calls, scope, and verification limits

- **Confirmed:** 10 task-initiated API-Football calls total: 2 for English-club
  evidence, 4 squad-player requests, and 4 fixture-stat requests. No retries,
  lineup requests, or startup background syncs.
- **Confirmed:** production was accessed only with read-only evidence SELECTs.
  Neither the emitted DO block nor the emitted verification SELECT was run in
  production.
- **Confirmed:** no application, schema, migration, test, dependency, workflow,
  or environment configuration files changed; nothing was published.
- **Confirmed:** only documentation is being committed: this report and an
  internal Git logging safety note/index. Existing implementation
  was exercised directly; full application test suites were not rerun because
  there were no application-code changes.
- **Unable to verify without running the production application after the
  user's SQL:** production squad-sync outcome and production HTTP response.
- **Unable to verify without starting the managed dev workflows:** browser and
  proxy rendering. The development Express HTTP response itself was verified.
- Provider registrations and minutes are confirmed API-reported results, not
  an independent federation/club-record check.

Commit and push details are supplied in the final delivery message.
