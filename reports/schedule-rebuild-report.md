# USMNT schedule rebuild — implementation report

## Status

Dev is rebuilt and verified. The authorized continuation changed only how the November regression test obtains the events array; all assertions remain unchanged. The diagnosed shared-database race was left unfixed.

Committed and pushed: **45266c9b0c367025b48aee95dcf539e0eefcec92**.

[Green CI for that exact commit](https://github.com/thetrutru313/usmnt-tracker/actions/runs/37686087104).

Production was read **only after CI became green**. It has not been modified. The SQL below is emitted for the user to execute. No publish, migration, schema, route, hero, purge, or repair-logic change was made. No manual fixture changes were made; the authorized existing test suites performed their normal fixture setup and cleanup.

## 1. Task A findings and test changes

The initial application/test search found the three retired slugs only in the old seed array: `cnl-f4-gold-cup-2027` at original line 46, `wcq-begins-2027` at original line 58, and `wcq-2028-2029` at original line 82. Those seed definitions were replaced by the nine new entries in the data-only module. The supplied Prompt 18 also names them in its REMOVED list and explicit DELETE instruction; that input was retained unchanged. No application dependency or hardcoded application event count was found. Routes order the database rows dynamically. Negative sort orders used by existing route tests are isolation helpers and were left unchanged.

Changes to tests:

- `ntLevelFiltering.test.ts`: comment `10–90` changed to `10–140`; no assertion changed.
- `scheduleEventsData.test.ts`: added the seven requested tests. Its three retired-slug references are intentional negative checks, not dependencies on those rows.
- `novemberQuarterfinals.test.ts`: replaced events-array source slicing/transpilation/evaluation with a normal import of `scheduleEventsData`. No assertion, clock handling, transaction setup, or startup extraction changed. The initial search missed this source-layout dependency because it mentions neither the retired slugs nor an event-count/sort-order assumption.

### Source-file evaluation audit

There were two source-file extraction/evaluation sites in `novemberQuarterfinals.test.ts` before the authorized fix:

1. The seed events-array extraction from `scheduleEvents.ts`, ending in `new Function(... return events ...)`. This was replaced with the authorized import.
2. `startupSeed`: reads `src/index.ts`, slices from `type MatchDef =` through the next startup catch block, transpiles the actual November fixture-seeding block, wraps it as `async function seed(db, sql, logger)`, evaluates it with `new Function`, and executes it in the test transaction. This is the separate line 50–55 extraction reported before editing. **It remains unchanged.**

The repository audit found no other test or script that reads a source file as text and evaluates part of it. Schema-comment parsing in the new guard reads text but does not evaluate it. Playwright's `execSync('which chromium')` executes a shell lookup, not extracted source code.

## 2. Nine descriptions, verbatim

### cnl-finals-mar-2027

The semifinals, third-place match and final take place March 25–28, 2027, at SoFi Stadium in Inglewood, California. The USA plays in the Finals only if it wins its November quarterfinal against Haiti.

### friendlies-jun-2027

Nothing has been announced for this window. The FIFA international window runs June 7–15, 2027, immediately before the Gold Cup, with no Concacaf competition scheduled in it. Warm-up friendlies are possible, but none have been announced.

### gold-cup-2027

The 19th Gold Cup features 16 teams in June–July 2027, with Saudi Arabia participating as a guest. Concacaf has announced only June and July 2027; the June 18 – July 11 dates shown are not yet officially confirmed, and host venues have not been announced. The four League A quarterfinal winners qualify directly, so the USA qualifies by beating Haiti; a quarterfinal loser goes to the Gold Cup Prelims in March 2027.

### friendlies-sept-2027

Nothing has been announced for the USA in the first half of the September 20 – October 5, 2027 FIFA international window. Round One of World Cup qualifying is played then by the teams ranked 14–35, and the USA is not in it.

### wcq-r2-2027

Concacaf's top 13 ranked teams, including the USA, enter alongside the 11 Round One winners: 24 teams in six groups of four, playing home and away. Round Two begins in the second half of the September–October 2027 window and continues in November 2027 and March 2028. The top two in each group advance; groups and fixtures have not been drawn.

### wcq-final-jun-2028

The Final Round has 12 teams in three groups of four, playing home and away, and opens in the June 2028 window before pausing until autumn 2029. The top two in each group qualify for the 2030 World Cup, providing six direct berths.

### cnl-2028-29

The Nations League is confirmed for 2028/29 under the three-league system. Dates, format details for the USA and the Finals host have not been announced.

### gold-cup-2029

The Gold Cup is scheduled for June and July 2029. Nothing else has been announced.

### wcq-final-sept-2029

The Final Round resumes and finishes in the September–October 2029 window. The two best third-placed teams go to a home-and-away Play-In in November 2029 for a place in the intercontinental play-off.

## 3. Regression evidence and ordered verification

The before-change baseline used the old literal without running its executable seed or writing the database. Test 3 exercised the actual Schedule router through Supertest with seeded in-memory database responses and deliberately supplied candidate fixtures.

| Test | Before Task B | After Task B |
|---|---|---|
| 1 — separate Finals and Gold Cup with exact dates | FAIL: Finals lookup returned undefined | PASS |
| 2 — no retired slugs | FAIL: all three retired rows were returned | PASS |
| 3 — three qualifying blocks, no attached fixtures | FAIL: returned `wcq-begins-2027` and `wcq-2028-2029` instead of the three new slugs | PASS |
| 4 — unique slugs and documented kinds/statuses | PASS | PASS |
| 5 — increasing sort order and dated chronology | PASS | PASS |
| 6 — no bounded-window overlap including 30 hours | PASS | PASS |
| 7 — bounded start date no later than end date | PASS | PASS |

Before-change total: **3 failed, 4 passed**. No guard was made to fail artificially.

The original full API attempt stopped with 833 passing and four failing tests: three November test-setup failures caused by B1, plus the diagnosed repair-writer race described below.

The authorized isolated diagnostic ran once:

```sh
API_FOOTBALL_KEY=ci-placeholder-api-football-key pnpm --filter @workspace/api-server exec vitest run src/lib/__tests__/phantomYouthNtFixturePurge.test.ts
```

Result: **one file passed; all three cases passed**.

The single authorized subsequent full verification attempt ran in this exact order:

| Command | Result |
|---|---|
| `pnpm run lint` | PASS; 0 errors, 8 existing warnings |
| `pnpm run typecheck` | PASS |
| `pnpm run build` | PASS |
| `API_FOOTBALL_KEY=ci-placeholder-api-football-key pnpm --filter @workspace/api-server run test` | PASS; 105 files, 837 tests |
| `pnpm --filter @workspace/usmnt-tracker run test` | PASS; 15 files, 236 tests |

There was no retry of that full attempt. CI then passed for the exact pushed commit linked above.

## 4. Dev rows and Schedule page

Before seeding, dev contained eight rows, and all five KEEP entries matched the seed's business fields. The upsert produced 17 rows; the explicitly authorized deletion removed exactly three. The final query returned **14 rows**, and a programmatic comparison confirmed every business field, including each description, against the target seed module in order.

Query:

```sql
SELECT id, sort_order, slug, name, kind, status, start_date, end_date, date_label, description FROM schedule_events ORDER BY sort_order, start_date;
```

Query result, verbatim CSV. Empty date fields represent SQL NULL:

```csv
id,sort_order,slug,name,kind,status,start_date,end_date,date_label,description
1,10,friendlies-sept-2026,September Friendlies,friendly,confirmed,2026-09-26,2026-09-29,"Sept 26 & 29, 2026",The first international window of the post-World Cup cycle. Pochettino uses this window to begin auditions for the next generation as Nations League group stage play begins for CONCACAF's lower-ranked nations.
2,20,friendlies-oct-2026,October Friendlies,friendly,confirmed,2026-10-03,2026-10-06,"Oct 3 & 6, 2026","Second window of the fall friendly run. With the Nations League group stage still ongoing for smaller CONCACAF sides, the USMNT continues building squad depth ahead of their quarterfinal entry."
852,30,cnl-qf-nov-2026,Nations League Quarterfinals,nations-league,confirmed,2026-11-13,2026-11-18,"Nov 14 & 17, 2026","The USMNT faces Haiti in a two-legged Nations League quarterfinal on November 14 and 17. The first leg is away at a neutral site, with venue and kickoff time still to be announced; the return leg is at TQL Stadium in Cincinnati at 7:00 PM EST. Both matches air on TNT and stream on HBO Max."
1003,40,cnl-finals-mar-2027,Nations League Finals,nations-league,confirmed,2027-03-25,2027-03-28,"Mar 25–28, 2027","The semifinals, third-place match and final take place March 25–28, 2027, at SoFi Stadium in Inglewood, California. The USA plays in the Finals only if it wins its November quarterfinal against Haiti."
1004,50,friendlies-jun-2027,Possible Friendlies — June Window,friendly,tbd,2027-06-07,,"June 7–15, 2027 (open window)","Nothing has been announced for this window. The FIFA international window runs June 7–15, 2027, immediately before the Gold Cup, with no Concacaf competition scheduled in it. Warm-up friendlies are possible, but none have been announced."
1005,60,gold-cup-2027,Gold Cup,gold-cup,approximate,2027-06-18,2027-07-11,"June 18 – July 11, 2027","The 19th Gold Cup features 16 teams in June–July 2027, with Saudi Arabia participating as a guest. Concacaf has announced only June and July 2027; the June 18 – July 11 dates shown are not yet officially confirmed, and host venues have not been announced. The four League A quarterfinal winners qualify directly, so the USA qualifies by beating Haiti; a quarterfinal loser goes to the Gold Cup Prelims in March 2027."
1006,70,friendlies-sept-2027,Possible Friendlies — September Window,friendly,tbd,2027-09-20,,Late Sept 2027 (open window),"Nothing has been announced for the USA in the first half of the September 20 – October 5, 2027 FIFA international window. Round One of World Cup qualifying is played then by the teams ranked 14–35, and the USA is not in it."
1007,80,wcq-r2-2027,2030 World Cup Qualifying — Round Two,world-cup-qualifying,approximate,2027-09-28,,Late Sept 2027 – Mar 2028,"Concacaf's top 13 ranked teams, including the USA, enter alongside the 11 Round One winners: 24 teams in six groups of four, playing home and away. Round Two begins in the second half of the September–October 2027 window and continues in November 2027 and March 2028. The top two in each group advance; groups and fixtures have not been drawn."
1008,90,wcq-final-jun-2028,2030 World Cup Qualifying — Final Round Begins,world-cup-qualifying,approximate,2028-05-29,,June 2028,"The Final Round has 12 teams in three groups of four, playing home and away, and opens in the June 2028 window before pausing until autumn 2029. The top two in each group qualify for the 2030 World Cup, providing six direct berths."
7,100,copa-america-2028,Copa América 2028,copa-america,tbd,2028-06-01,,Summer 2028 (Pending Invite),"CONMEBOL has historically extended invitations to the USA and Mexico for Copa América. As co-hosts of the 2026 World Cup, the USMNT is a likely invitee — a tournament that would provide elite competition during the qualifying window."
1010,110,cnl-2028-29,Nations League 2028/29,nations-league,approximate,2028-09-18,,2028–29 (dates TBA),"The Nations League is confirmed for 2028/29 under the three-league system. Dates, format details for the USA and the Finals host have not been announced."
1011,120,gold-cup-2029,Gold Cup 2029,gold-cup,approximate,2029-06-01,,June–July 2029,The Gold Cup is scheduled for June and July 2029. Nothing else has been announced.
1012,130,wcq-final-sept-2029,2030 World Cup Qualifying — Final Round Concludes,world-cup-qualifying,approximate,2029-09-24,,Sept–Oct 2029,The Final Round resumes and finishes in the September–October 2029 window. The two best third-placed teams go to a home-and-away Play-In in November 2029 for a place in the intercontinental play-off.
9,140,world-cup-2030,2030 FIFA World Cup,world-cup,tbd,2030-06-01,,Summer 2030,"The centenary World Cup, hosted across Spain, Portugal, Morocco, Argentina, Uruguay, and Paraguay. The USMNT's four-year mission — built on the momentum of hosting in 2026 — culminates here."
```

### Dev Schedule page

The read-only browser check loaded the actual page with non-GET/HEAD requests blocked. It confirmed every event heading, the grouping below, no fixture attachment to any start-only event, and that every returned fixture on a bounded event was inside its allowed 30-hour-extended window. It recorded no page errors. The anonymous-user creation POST was blocked rather than allowed to write.

- **2027:** Nations League Finals; Possible Friendlies — June Window; Gold Cup; Possible Friendlies — September Window; 2030 World Cup Qualifying — Round Two.
- **2028–2030:** Final Round Begins; Copa América 2028; Nations League 2028/29; Gold Cup 2029; Final Round Concludes; 2030 FIFA World Cup.
- Only the November 2026 quarterfinal block currently has match cards: its two existing Haiti legs. All other blocks have zero fixtures, including all nine new events.

The first page-check script encountered an ambiguous heading because both the layout's h2 and page's h1 are named USMNT Schedule. The selector was tightened to the page's level-1 heading; all data/card checks were retained, and no application code changed. A screenshot of the actual 2027 section was inspected. An additional screenshot of the read-only Schedule API confirmed its response without creating an anonymous user.

## 5. Production snapshot and Task D SQL

Production was queried read-only after green CI. Its eight rows match the expected starting state: each retired slug occurs exactly once, all nine new slugs are absent, and all five KEEP entries match the target business fields, except the expected old sort orders 70 for Copa and 90 for the World Cup.

Query:

```sql
SELECT id, sort_order, slug, name, kind, status, start_date, end_date, date_label, description FROM schedule_events ORDER BY sort_order, start_date;
```

Current production rows, verbatim CSV. Empty date fields represent SQL NULL:

```csv
id,sort_order,slug,name,kind,status,start_date,end_date,date_label,description
1,10,friendlies-sept-2026,September Friendlies,friendly,confirmed,2026-09-26,2026-09-29,"Sept 26 & 29, 2026",The first international window of the post-World Cup cycle. Pochettino uses this window to begin auditions for the next generation as Nations League group stage play begins for CONCACAF's lower-ranked nations.
2,20,friendlies-oct-2026,October Friendlies,friendly,confirmed,2026-10-03,2026-10-06,"Oct 3 & 6, 2026","Second window of the fall friendly run. With the Nations League group stage still ongoing for smaller CONCACAF sides, the USMNT continues building squad depth ahead of their quarterfinal entry."
28,30,cnl-qf-nov-2026,Nations League Quarterfinals,nations-league,confirmed,2026-11-13,2026-11-18,"Nov 14 & 17, 2026","The USMNT faces Haiti in a two-legged Nations League quarterfinal on November 14 and 17. The first leg is away at a neutral site, with venue and kickoff time still to be announced; the return leg is at TQL Stadium in Cincinnati at 7:00 PM EST. Both matches air on TNT and stream on HBO Max."
5,50,cnl-f4-gold-cup-2027,Nations League Final Four + Gold Cup,gold-cup,approximate,2027-06-01,2027-07-15,Summer 2027 (June–July),"The Nations League Final Four serves as the gateway to the Gold Cup. The four semifinalists compete for the Nations League title and automatic berths in the 2027 Gold Cup, which follows immediately in the same window."
6,60,wcq-begins-2027,2030 World Cup Qualifying — Begins,world-cup-qualifying,approximate,2027-09-01,,Fall 2027,"CONCACAF's new World Cup qualifying format kicks off. With 6 automatic berths for the 2030 World Cup (up from 3.5 in 2022), the path is wider — but so is the competition with an expanded CONCACAF player pool."
7,70,copa-america-2028,Copa América 2028,copa-america,tbd,2028-06-01,,Summer 2028 (Pending Invite),"CONMEBOL has historically extended invitations to the USA and Mexico for Copa América. As co-hosts of the 2026 World Cup, the USMNT is a likely invitee — a tournament that would provide elite competition during the qualifying window."
8,80,wcq-2028-2029,2030 World Cup Qualifying,world-cup-qualifying,tbd,,,2027–2029,"CONCACAF qualifying continues across multiple windows through 2029. Format details TBD by CONCACAF, but the USA enters as a strong favorite given home-soil momentum from 2026."
9,90,world-cup-2030,2030 FIFA World Cup,world-cup,tbd,2030-06-01,,Summer 2030,"The centenary World Cup, hosted across Spain, Portugal, Morocco, Argentina, Uruguay, and Paraguay. The USMNT's four-year mission — built on the momentum of hosting in 2026 — culminates here."
```

### SQL for the user to execute in production — NOT EXECUTED

Execute the following **single DO statement** in the production database console. It asserts the observed starting state, requires each retired row and both KEEP rows to exist once, rejects every new slug if present, checks the existing KEEP sort orders, and checks row counts for DELETE 3, INSERT 9, and UPDATE 2. It also checks the starting and final totals. Any mismatch raises an exception and aborts the statement.

There is no LOCK TABLE and no explicit transaction command. The id column is omitted from INSERT. The only fields updated on the two KEEP rows are their sort orders. The nine descriptions were generated directly from the seed data, with SQL literal escaping round-tripped back to byte-identical values.

```sql
DO $schedule_rebuild$
DECLARE
  checked_slug text;
  affected integer;
BEGIN
  SELECT count(*) INTO affected FROM schedule_events;
  IF affected <> 8 THEN
    RAISE EXCEPTION 'Expected 8 starting schedule rows, found %', affected;
  END IF;

  FOREACH checked_slug IN ARRAY ARRAY['cnl-f4-gold-cup-2027', 'wcq-begins-2027', 'wcq-2028-2029', 'copa-america-2028', 'world-cup-2030']
  LOOP
    SELECT count(*) INTO affected FROM schedule_events WHERE slug = checked_slug;
    IF affected <> 1 THEN
      RAISE EXCEPTION 'Expected exactly one existing row for %, found %', checked_slug, affected;
    END IF;
  END LOOP;

  FOREACH checked_slug IN ARRAY ARRAY['cnl-finals-mar-2027', 'friendlies-jun-2027', 'gold-cup-2027', 'friendlies-sept-2027', 'wcq-r2-2027', 'wcq-final-jun-2028', 'cnl-2028-29', 'gold-cup-2029', 'wcq-final-sept-2029']
  LOOP
    SELECT count(*) INTO affected FROM schedule_events WHERE slug = checked_slug;
    IF affected <> 0 THEN
      RAISE EXCEPTION 'New slug % must be absent, found % rows', checked_slug, affected;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM schedule_events WHERE slug = 'copa-america-2028' AND sort_order = 70)
     OR NOT EXISTS (SELECT 1 FROM schedule_events WHERE slug = 'world-cup-2030' AND sort_order = 90) THEN
    RAISE EXCEPTION 'KEEP sort orders differ from the production snapshot';
  END IF;

  DELETE FROM schedule_events
  WHERE slug IN ('cnl-f4-gold-cup-2027', 'wcq-begins-2027', 'wcq-2028-2029');
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 3 THEN
    RAISE EXCEPTION 'Expected DELETE 3, got %', affected;
  END IF;

  INSERT INTO schedule_events
    (slug, name, kind, status, start_date, end_date, date_label, description, sort_order)
  VALUES
    ('cnl-finals-mar-2027', 'Nations League Finals', 'nations-league', 'confirmed', '2027-03-25', '2027-03-28', 'Mar 25–28, 2027', 'The semifinals, third-place match and final take place March 25–28, 2027, at SoFi Stadium in Inglewood, California. The USA plays in the Finals only if it wins its November quarterfinal against Haiti.', 40),
    ('friendlies-jun-2027', 'Possible Friendlies — June Window', 'friendly', 'tbd', '2027-06-07', NULL, 'June 7–15, 2027 (open window)', 'Nothing has been announced for this window. The FIFA international window runs June 7–15, 2027, immediately before the Gold Cup, with no Concacaf competition scheduled in it. Warm-up friendlies are possible, but none have been announced.', 50),
    ('gold-cup-2027', 'Gold Cup', 'gold-cup', 'approximate', '2027-06-18', '2027-07-11', 'June 18 – July 11, 2027', 'The 19th Gold Cup features 16 teams in June–July 2027, with Saudi Arabia participating as a guest. Concacaf has announced only June and July 2027; the June 18 – July 11 dates shown are not yet officially confirmed, and host venues have not been announced. The four League A quarterfinal winners qualify directly, so the USA qualifies by beating Haiti; a quarterfinal loser goes to the Gold Cup Prelims in March 2027.', 60),
    ('friendlies-sept-2027', 'Possible Friendlies — September Window', 'friendly', 'tbd', '2027-09-20', NULL, 'Late Sept 2027 (open window)', 'Nothing has been announced for the USA in the first half of the September 20 – October 5, 2027 FIFA international window. Round One of World Cup qualifying is played then by the teams ranked 14–35, and the USA is not in it.', 70),
    ('wcq-r2-2027', '2030 World Cup Qualifying — Round Two', 'world-cup-qualifying', 'approximate', '2027-09-28', NULL, 'Late Sept 2027 – Mar 2028', 'Concacaf''s top 13 ranked teams, including the USA, enter alongside the 11 Round One winners: 24 teams in six groups of four, playing home and away. Round Two begins in the second half of the September–October 2027 window and continues in November 2027 and March 2028. The top two in each group advance; groups and fixtures have not been drawn.', 80),
    ('wcq-final-jun-2028', '2030 World Cup Qualifying — Final Round Begins', 'world-cup-qualifying', 'approximate', '2028-05-29', NULL, 'June 2028', 'The Final Round has 12 teams in three groups of four, playing home and away, and opens in the June 2028 window before pausing until autumn 2029. The top two in each group qualify for the 2030 World Cup, providing six direct berths.', 90),
    ('cnl-2028-29', 'Nations League 2028/29', 'nations-league', 'approximate', '2028-09-18', NULL, '2028–29 (dates TBA)', 'The Nations League is confirmed for 2028/29 under the three-league system. Dates, format details for the USA and the Finals host have not been announced.', 110),
    ('gold-cup-2029', 'Gold Cup 2029', 'gold-cup', 'approximate', '2029-06-01', NULL, 'June–July 2029', 'The Gold Cup is scheduled for June and July 2029. Nothing else has been announced.', 120),
    ('wcq-final-sept-2029', '2030 World Cup Qualifying — Final Round Concludes', 'world-cup-qualifying', 'approximate', '2029-09-24', NULL, 'Sept–Oct 2029', 'The Final Round resumes and finishes in the September–October 2029 window. The two best third-placed teams go to a home-and-away Play-In in November 2029 for a place in the intercontinental play-off.', 130);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 9 THEN
    RAISE EXCEPTION 'Expected INSERT 9, got %', affected;
  END IF;

  UPDATE schedule_events
  SET sort_order = CASE slug
    WHEN 'copa-america-2028' THEN 100
    WHEN 'world-cup-2030' THEN 140
  END
  WHERE slug IN ('copa-america-2028', 'world-cup-2030');
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 2 THEN
    RAISE EXCEPTION 'Expected UPDATE 2, got %', affected;
  END IF;

  SELECT count(*) INTO affected FROM schedule_events;
  IF affected <> 14 THEN
    RAISE EXCEPTION 'Expected 14 final schedule rows, found %', affected;
  END IF;
END;
$schedule_rebuild$;
```

### Separate read-only SELECT to run afterwards

```sql
SELECT id, sort_order, slug, name, kind, status, start_date, end_date, date_label, description
FROM schedule_events
ORDER BY sort_order, start_date;
```

**Stop here:** production has not been written or verified after execution. The user runs the DO block and follow-up SELECT. Only after notification will production be checked again, read-only.

## 6. Hero selection — reasoning only, not a test

Under the unchanged rule, bounded events remain eligible while end-date midnight UTC plus 30 hours is greater than NOW(). Start-only events remain eligible while their start date is today or later. Undated events remain eligible. The first eligible row by sort order wins. These conclusions assume the target 14 rows and the indicated calendar dates.

| Date | Selected event | Reasoning |
|---|---|---|
| 2026-11-20 | `cnl-finals-mar-2027` — Nations League Finals | November quarterfinals expire at 2026-11-19 06:00 UTC; Finals is next eligible. |
| 2027-03-30 | `friendlies-jun-2027` — Possible Friendlies — June Window | Finals expire at 2027-03-29 06:00 UTC; the June start is still upcoming. |
| 2027-06-16 | `gold-cup-2027` — Gold Cup | The June friendly block is start-only and stopped being eligible after its June 7 start date; Gold Cup is next. |
| 2027-07-13 | `friendlies-sept-2027` — Possible Friendlies — September Window | Gold Cup expires at 2027-07-12 06:00 UTC; September is next. |
| 2027-10-10 | `wcq-final-jun-2028` — Final Round Begins | Both September 2027 start-only rows have already passed their start dates; the May 29, 2028 start is next eligible. |

These are selection-rule deductions, not time-travel runtime test results. The open-window date labels do not extend start-only hero eligibility.

## 7. Unexpected findings and read-only race diagnosis

### Established cause: another test's NT repair writer

The original full-run log contains:

```text
[20:38:37.900] INFO (7587): NT repair pass: backfilled fixture_players links for national-team fixture
    fixtureId: 18916
    competition: "World Cup - U20"
    linked: 1
```

The failing assertion identifies that exact fixture, 18916, and found two links instead of one. The same writer process 7587 logged links for `__NTRP_Competition_Returning__` fixtures immediately beforehand, identifying the parallel national-team repair test scenario. The purge file's own log was from process 7602. This is direct evidence of another writer, not a guess based only on an isolated passing result.

Case 2 of `phantomYouthNtFixturePurge.test.ts` inserts a finished `World Cup - U20` national-team fixture and a player link. It retains those rows until the file-level afterAll, so that player qualifies as a veteran while Case 3's upcoming U20 fixture exists. The global repair pass can then insert the second link on Case 3's fixture.

### Current dev precondition query and result

```sql
SELECT f.id AS fixture_id, f.status, f.competition, f.is_national_team, fp.player_id, fp.club_id FROM fixtures f JOIN fixture_players fp ON fp.fixture_id = f.id WHERE f.is_national_team = TRUE AND f.status = 'finished' AND f.competition = 'World Cup - U20' ORDER BY f.id, fp.player_id;
```

```csv
fixture_id,status,competition,is_national_team,player_id,club_id
```

The query returned **zero rows** after cleanup. That does not negate the mid-run precondition: Case 2 creates it transiently, and the old log records the actual repair insertion. No diagnostic database writes were performed.

### Code paths and every direct repair caller

`runNationalTeamRepairPass` selects all scheduled/live NT fixtures, finds distinct players linked to finished NT fixtures in the same competition, and inserts missing fixture_players links with club_id NULL. It does not restrict itself to the calling test's fixtures or read schedule_events.

Every direct caller found:

- `apiFootballSync.ts`, inside `syncApiFootballFixtures`, at line 1635.
- `nationalTeamRepairPass.test.ts`, returning-player case, at line 207.
- `nationalTeamRepairPass.test.ts`, over-linking guard, at line 259.

Indirect production entry points through `syncApiFootballFixtures`:

- `startApiFootballSyncSchedule`: immediate/hourly fixture sync; started by `src/index.ts`.
- `routes/admin.ts`: POST trigger-fixtures-sync handler.
- `playerClubSync.ts`: post-transfer fixture synchronization.

Tests that call the real `syncApiFootballFixtures` and can therefore invoke its global repair pass:

- `squadCacheStampOnSuccess.test.ts` — three calls.
- `transferPrecedenceGuard.test.ts` — two calls.
- `seasonStatsFallbackMultiClub.test.ts` — one call.
- `playerCentricSyncIntegration.test.ts` — one call.
- `internationalWindowFallback.test.ts` — one call.

Other fixture-link insertion paths found: the normal club fixture-sync upsert/link loop; `runRepairPass`, which matches scheduled/live rows by the fresh feed's API fixture IDs; the explicit `seedUsmnt.ts` featured-player fixture seeding; and test setup helpers inserting their own links. The observed extra row is specifically accounted for by the NT repair log above, not these alternatives. The purge path does not insert player links.

### Running server and parallel/shared database

The dev API server was running: its startup log records process 5522 listening on port 8080 at 19:49:02.989, before the original full suite began at 20:37:28; its parent dev process was still running when inspected. The suite's different writer processes are visible in the log.

The API Vitest configuration sets only environment=node and does not disable file parallelism. The installed Vitest default is fileParallelism=true. The DB module creates its pool from the inherited DATABASE_URL; no per-worker database is configured. The dev server and integration test workers therefore share the development database. The observed insertion was attributable to the repair-test worker; the server was another possible writer but was not blamed for this insertion.

### Did this change set cause the extra link?

**No.** The schedule change writes schedule_events only. The new route regression uses mocked select results and in-memory candidates. The November test uses transaction-local temporary fixture tables, and the authorized fix merely imports its events array. Neither calls or modifies the NT repair pass. The old log identifies an unchanged global repair writer inserting the additional link.

The separate pre-existing shared-database race remains **unfixed**, as authorized. Its diagnosis was recorded in project memory. No purge test, purge logic, repair pass, parallelism setting, or assertion was altered to get a pass.

Other reported surprises: the initial dependency search missed the November source-layout dependency; an early patch application needed corrected context; the read-only page-check selector needed a level-1 heading constraint; and the existing lint warnings remain. The Git safety gate required the documented DANGEROUSLY_ALLOW_GIT=1 opt-in for index/write operations. None of these led to a removed or weakened check.

Nothing required for the current dev/commit/CI/SQL-emission stage was skipped. Production execution and its subsequent read-only verification are intentionally pending user execution, not claimed complete.
