# Prompt 26 — Noahkai Banks removal

## Completion and safety

**Confirmed:** removed Banks from the development player pool, removed his
attached rows, deleted exclusive club fixtures and Banks-only articles, and
created a manually overridden dismissal that blocks rediscovery.

**Confirmed:** the only application-source change is removing his entry from
`scripts/src/seedUsmnt.ts`. No discovery, RSS, route, frontend, or test code was
changed. The SQL is in `reports/remove-banks.sql` and is reproduced in the final
delivery. Other changed files are documentation, memory, and Library metadata.

**Confirmed:** production access consisted only of SELECT statements through
the production read-only database facility. No production DML, DDL, DO blocks,
side-effecting functions, HTTP browser loads, or publishing were performed by
the agent. The user runs the production block.

The production HTTP rule permits direct GETs only, not browser loads; the user
clarified that separately authorized read-only database SELECTs remain allowed.
That distinction is recorded in the existing safety note.

**Confirmed:** pushed commit `5a8a363a36e01d4b471e77152c60adb854eaaaa3` to `main`. [GitHub CI passed](https://github.com/thetrutru313/usmnt-tracker/actions/runs/39460899155). The working tree was clean at completion.

## Step 0a — identity in both databases

| Environment | Banks matches | ID | Name | Slug | API player ID | Club |
|---|---:|---:|---|---|---:|---|
| Development | 1 | 26 | Noahkai Banks | noahkai-banks | 413065 | FC Augsburg |
| Production | 1 | 26 | Noahkai Banks | noahkai-banks | 413065 | FC Augsburg |

Club ID happens to be 22 in both snapshots. Neither player ID nor club ID is
hard-coded in the removal block: it selects the player by API ID **and** slug
and retains his actual row values.

## Steps 0b and 0c — references and counts

**Confirmed in schema source and both database catalogs:** exactly these eight
columns reference/store the local player ID. Seven have foreign keys to
`players.id`; `news_article_players.player_id` does not. None of the relevant
foreign keys cascade. No unlisted local player-ID column was found.

| Table / column | FK to players.id | Dev before | Production before | Dev after |
|---|---|---:|---:|---:|
| user_follows.player_id | Yes | 1 | 1 | 0 |
| news_article_players.player_id | No | 15 | 59 | 0 |
| fixture_players.player_id | Yes | 20 | 21 | 0 |
| player_stats.player_id | Yes | 6 | 6 | 0 |
| match_logs.player_id | Yes | 5 | 5 | 0 |
| player_status_history.player_id | Yes | 0 | 0 | 0 |
| transfers.player_id | Yes | 0 | 0 | 0 |
| injuries.player_id | Yes | 2 | 2 | 0 |

`players.api_football_player_id` and
`player_candidates.api_football_player_id` store provider IDs, not local
`players.id` references. Eligibility signals and duplicate-candidate pointers
refer to candidate IDs, not tracked-player IDs.

## Steps 0d–0g — fixtures, national teams, club, candidate

| Finding | Development | Production |
|---|---|---|
| Linked club fixtures | 20: 12 finished, 8 scheduled | 21: 13 finished, 8 scheduled |
| Exclusive club fixtures | 14: 7 finished, 7 scheduled | 14: 8 finished, 6 scheduled |
| Shared club fixtures | 6: 5 finished, 1 scheduled | 7: 5 finished, 2 scheduled |
| National-team fixture links | 0 | 0 |
| National-team match logs | 0 | 0 |
| Other players at his club | 0 | 0 |
| Candidate for API ID 413065 before removal | None | None |

**Confirmed in development after removal:** all 14 recorded exclusive fixtures
are gone, all 6 shared fixtures remain, and the national-team fixture count
stayed at 45 across the removal. The club itself is retained.

## Step 0h and Task A — repository search and code change

The repository search covered application code, scripts, seeds, tests, static
frontend data, and hidden project content, excluding generated output,
dependencies, Git internals, local tooling, and the uploaded prompt itself.

**Confirmed:** the only code hit was the player object at the original
`scripts/src/seedUsmnt.ts:268`, containing `Noahkai Banks` and `noahkai-banks`.
That entire object was removed. A post-change code search for both name forms
returned no hits.

No test used him as sample data, so there were **no fictional-name replacements**
and no test edits. The new report, SQL, and exclusion-policy documentation
intentionally identify the removed player; these are not runtime player data.

## N1–N3 — news evidence before changes

Counts below are distinct articles, independently checked against tag-row counts.

| Environment | Tagged total | Banks-only | Shared | Untagged headline/summary mentions |
|---|---:|---:|---:|---:|
| Development | 15 | 14 | 1 | 0 |
| Production | 59 | 58 | 1 | 0 |

**N2:** no matching untagged headlines existed in either snapshot, so there are
no headlines to list. Those articles would not be deleted if present.

**N3 confirmed:** source and both catalogs show only
`news_article_players.article_id` referencing `news_articles.id`. No additional
article-ID storage column or foreign-key reference was found.

**Confirmed in development:** the 14 recorded Banks-only articles are gone.
The one shared article remains with two other-player tags. Exactly one
remaining article has Banks in its headline/summary, and it is that preserved
shared article. No name-matching article exists outside that preserved set.

Production has not been changed: its snapshot identifies 58 Banks-only articles
for deletion and one shared article for preservation.

## N4 — RSS reinsertion, report only

**Confirmed from `rssIngest.ts`:** dedupe uses URLs of current `news_articles`
rows. Deletion removes that URL from the dedupe set; there is no URL tombstone.
The ingestion relevance filter then accepts an item only if it names a current
tracked player or matches a USMNT keyword. Eligible items must also survive
within-run title dedupe and the per-run insertion cap.

**Possible:** a deleted article can return if it is still in a feed and passes
those gates. Reinsertion is not guaranteed merely by URL presence.

After removal, Banks is absent from the tracked-player list used for tagging,
so a later ingestion cannot give the article his player tag. With no other
tracked full-name match it would be untagged; otherwise it could tag the other
matched players. Actual current feeds were not fetched to test this scenario.
No RSS or URL-exclusion code was changed.

## Task B — unchanged dev/production SQL

`reports/remove-banks.sql` contains one `DO $remove_banks$ ... $remove_banks$;`
statement. The body contains the required PL/pgSQL BEGIN delimiter, not a
transaction BEGIN statement; there is no transaction wrapper or LOCK statement.

It:

1. Raises unless API ID 413065 plus slug `noahkai-banks` selects exactly one row.
2. Records exclusive club-fixture IDs and Banks-only article IDs before removing
   associations.
3. Deletes his eight sets of child rows explicitly. After removing his article
   tags, deletes only recorded Banks-only articles still having zero tags.
4. Deletes only recorded club fixtures that are non-national and still unlinked.
5. Deletes exactly one player, raising otherwise.
6. Inserts or updates the blocking candidate.
7. Raises unless all eight player-reference counts are zero, no recorded
   Banks-only article remains, no player has his API ID, and exactly one
   correctly dismissed/overridden candidate remains.

### Candidate conventions used

- Required name and club ID come from the selected player.
- API ID comes from that same row.
- For a new row, `eligibility_basis = 'dual_national_unconfirmed'`, one of the
  discovery pipeline's existing canonical legacy values. It is not a new
  eligibility claim. Existing candidates retain their existing basis.
- `status = 'dismissed'`, `is_manual_override = true`,
  `usmnt_status = 'DECLARED_OTHER'`.
- Exact notes: `Committed to Germany — removed from pool October 2026`.
- Other required columns use schema defaults: season starts/minutes 0,
  discovery time now, and generated candidate ID. Optional fields remain null
  unless an existing row already has them.

The actual development candidate has all specified values and retains club ID
22. That ID is copied, not hard-coded.

## C1 — execution and notice-output limitation

**Confirmed:** the actual SQL file ran successfully in development. The database
tool returned exit code 0, success true, and the command tag:

```text
DO
```

**Unable to verify the original NOTICE transcript:** this tool did not include
the `RAISE NOTICE` lines in its result. They cannot truthfully be presented as
captured output. The block contains the requested per-step notices, but the
following are state evidence, not a fabricated transcript:

- 14 exclusive fixtures and 14 Banks-only articles recorded before execution;
  none remains afterward.
- All eight table-reference counts are now zero (pre-removal counts above).
- One player removed; zero players remain with API ID 413065.
- Exactly one blocking candidate exists with the requested values.
- All recorded shared fixtures/articles and all national-team fixtures survive.

No destructive work was replayed or guards weakened to recover missing notice
text. The user should see the notices when running the SQL through a client
that exposes PostgreSQL NOTICE messages.

## C2 — second run

**Confirmed:** the exact same SQL file failed at its first guard:

```text
ERROR: Expected exactly one player for API ID 413065 and slug noahkai-banks; found 0
CONTEXT: PL/pgSQL function inline_code_block line 15 at RAISE
```

Before/after snapshots of all 13 affected-table row counts and the complete
blocking-candidate row were identical. The guard runs before any mutation.

## C3 — development API verification

**Confirmed:** the following checks all passed after the development restart.
Structured player references were checked separately from permitted article
text, so unrelated article/fixture IDs equal to 26 are not mistaken for a
player reference.

| Request | Status | Result |
|---|---:|---|
| GET /api/players | 200 | No Banks player or reference |
| GET /api/players?search=Banks | 200 | Empty |
| GET /api/players?search=Noahkai | 200 | Empty |
| GET /api/search?q=Banks | 200 | No player results |
| GET /api/search?q=Noahkai | 200 | No player results |
| GET /api/players/26 | 404 | Removed profile unavailable |
| GET /api/dashboard | 200 | No player references/name |
| GET /api/fixtures | 200 | No player references/name |
| GET /api/fixtures?scope=all | 200 | No player references/name |
| GET /api/fixtures?playerId=26 | 200 | Empty |
| GET /api/injuries | 200 | No player references/name |
| GET /api/transfers | 200 | No player references/name |
| GET /api/news | 200 | No player references/name in returned 50 |
| GET /api/news?limit=200 | 200 | No player references/name in returned 200 |
| GET /api/news?playerId=26 | 200 | Empty |

The all-article database check additionally covers the retained older shared
article outside those returned news batches.

An exploratory request used unsupported `scope=past` and correctly returned
400. The final verification uses the documented `scope=all`, covering historical
as well as future fixtures; no endpoint validation or assertion was weakened.

The development Player Pool page rendered normally in a screenshot. Existing
CSP inline-script and resource-404 warnings remain outside this removal's scope.

## C4 — actual known-ID logic and rescore guard

**Confirmed:** executed the actual known-ID Set construction and roster-filter
statements extracted from `discoverUSProspects`, erasing only the TypeScript
generic annotation. Inputs used the persisted dismissed/overridden candidate,
no tracked player, and a roster containing 413065 plus an unknown control ID.

```text
known:   [413065]
unknown: [900413065]
```

Banks was skipped; the unknown control remained eligible for processing. No live
discovery run or API-Football call was needed.

The stored-signal rescore selection predicate also returns **0** eligible rows
for his API ID because his manual override is true.

## Final checks

| Check | Result |
|---|---|
| Lint | Passed: 0 errors, 8 unchanged warnings |
| Workspace typecheck | Passed |
| Full API suite | Passed: 863 tests, 110 files |
| Full frontend suite | Passed: 255 tests, 16 files |
| Recursive workspace build | Passed |
| Development API restart | Running |
| Development API removal checks | All 15 passed |
| Same-block second run | First guard rejected it; no changes |
| Actual discovery known-ID logic | Skips persisted blocked API ID |

## Not performed / unable to verify

- Production removal and subsequent production behavior: intentionally left to
  the user; no production writes were made.
- Original per-step NOTICE text: not exposed by the database tool; state-derived
  evidence is reported separately above.
- Future RSS reinsertion or future discovery schedules: code paths and current
  exclusion were verified, not a future scheduled run.


## Complete revised SQL

This block was tested in development. It has **not** been run in production by the agent.

```sql
-- Run unchanged in development or production.
-- The agent runs this in development only; the user runs it in production.
-- BEGIN is a PL/pgSQL body delimiter, not a transaction BEGIN statement.
DO $remove_banks$
DECLARE
  victim players%ROWTYPE;
  matching_count bigint;
  affected_count bigint;
  remaining_count bigint;
  club_fixture_ids integer[];
  his_only_article_ids integer[];
  referencing_table text;
BEGIN
  SELECT count(*) INTO matching_count
  FROM players
  WHERE api_football_player_id = 413065 AND slug = 'noahkai-banks';
  IF matching_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one player for API ID 413065 and slug noahkai-banks; found %', matching_count;
  END IF;
  SELECT * INTO STRICT victim
  FROM players
  WHERE api_football_player_id = 413065 AND slug = 'noahkai-banks';
  RAISE NOTICE 'Guard: matched % player', matching_count;

  SELECT COALESCE(array_agg(f.id), ARRAY[]::integer[]) INTO club_fixture_ids
  FROM fixtures f
  WHERE f.is_national_team = false
    AND EXISTS (
      SELECT 1 FROM fixture_players own
      WHERE own.fixture_id = f.id AND own.player_id = victim.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM fixture_players other
      WHERE other.fixture_id = f.id AND other.player_id <> victim.id
    );
  RAISE NOTICE 'Recorded exclusive club fixtures: %', cardinality(club_fixture_ids);

  SELECT COALESCE(array_agg(n.id), ARRAY[]::integer[]) INTO his_only_article_ids
  FROM news_articles n
  WHERE EXISTS (
    SELECT 1 FROM news_article_players own
    WHERE own.article_id = n.id AND own.player_id = victim.id
  )
    AND NOT EXISTS (
      SELECT 1 FROM news_article_players other
      WHERE other.article_id = n.id AND other.player_id <> victim.id
    );
  RAISE NOTICE 'Recorded Banks-only articles: %', cardinality(his_only_article_ids);

  DELETE FROM user_follows WHERE player_id = victim.id;
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RAISE NOTICE 'Deleted user_follows: %', affected_count;

  DELETE FROM news_article_players WHERE player_id = victim.id;
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RAISE NOTICE 'Deleted news_article_players: %', affected_count;

  DELETE FROM news_articles n
  WHERE n.id = ANY(his_only_article_ids)
    AND NOT EXISTS (
      SELECT 1 FROM news_article_players nap WHERE nap.article_id = n.id
    );
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RAISE NOTICE 'Deleted Banks-only news_articles: %', affected_count;

  DELETE FROM fixture_players WHERE player_id = victim.id;
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RAISE NOTICE 'Deleted fixture_players: %', affected_count;

  DELETE FROM player_stats WHERE player_id = victim.id;
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RAISE NOTICE 'Deleted player_stats: %', affected_count;

  DELETE FROM match_logs WHERE player_id = victim.id;
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RAISE NOTICE 'Deleted match_logs: %', affected_count;

  DELETE FROM player_status_history WHERE player_id = victim.id;
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RAISE NOTICE 'Deleted player_status_history: %', affected_count;

  DELETE FROM transfers WHERE player_id = victim.id;
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RAISE NOTICE 'Deleted transfers: %', affected_count;

  DELETE FROM injuries WHERE player_id = victim.id;
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RAISE NOTICE 'Deleted injuries: %', affected_count;

  DELETE FROM fixtures f
  WHERE f.id = ANY(club_fixture_ids)
    AND f.is_national_team = false
    AND NOT EXISTS (
      SELECT 1 FROM fixture_players fp WHERE fp.fixture_id = f.id
    );
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RAISE NOTICE 'Deleted exclusive orphaned club fixtures: %', affected_count;

  DELETE FROM players WHERE id = victim.id;
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RAISE NOTICE 'Deleted players: %', affected_count;
  IF affected_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one deleted player; got %', affected_count;
  END IF;

  INSERT INTO player_candidates (
    name, club_id, api_football_player_id, eligibility_basis,
    status, is_manual_override, usmnt_status, status_notes
  ) VALUES (
    victim.name, victim.club_id, victim.api_football_player_id,
    'dual_national_unconfirmed', 'dismissed', true, 'DECLARED_OTHER',
    'Committed to Germany — removed from pool October 2026'
  )
  ON CONFLICT (api_football_player_id) DO UPDATE SET
    name = EXCLUDED.name,
    club_id = EXCLUDED.club_id,
    status = EXCLUDED.status,
    is_manual_override = EXCLUDED.is_manual_override,
    usmnt_status = EXCLUDED.usmnt_status,
    status_notes = EXCLUDED.status_notes;
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RAISE NOTICE 'Inserted or updated blocking candidate: %', affected_count;

  FOREACH referencing_table IN ARRAY ARRAY[
    'user_follows', 'news_article_players', 'fixture_players', 'player_stats',
    'match_logs', 'player_status_history', 'transfers', 'injuries'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE player_id = $1', referencing_table)
      INTO remaining_count USING victim.id;
    IF remaining_count <> 0 THEN
      RAISE EXCEPTION 'Remaining references in %: %', referencing_table, remaining_count;
    END IF;
    RAISE NOTICE 'Final references in %: %', referencing_table, remaining_count;
  END LOOP;

  SELECT count(*) INTO remaining_count
  FROM news_articles WHERE id = ANY(his_only_article_ids);
  IF remaining_count <> 0 THEN
    RAISE EXCEPTION 'Recorded Banks-only articles remain: %', remaining_count;
  END IF;
  RAISE NOTICE 'Final recorded Banks-only articles remaining: %', remaining_count;

  SELECT count(*) INTO remaining_count
  FROM players WHERE api_football_player_id = victim.api_football_player_id;
  IF remaining_count <> 0 THEN
    RAISE EXCEPTION 'Players with removed API ID remain: %', remaining_count;
  END IF;
  RAISE NOTICE 'Final players with removed API ID: %', remaining_count;

  SELECT count(*) INTO remaining_count
  FROM player_candidates WHERE api_football_player_id = victim.api_football_player_id;
  IF remaining_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM player_candidates
    WHERE api_football_player_id = victim.api_football_player_id
      AND status = 'dismissed' AND is_manual_override = true
      AND usmnt_status = 'DECLARED_OTHER'
      AND status_notes = 'Committed to Germany — removed from pool October 2026'
  ) THEN
    RAISE EXCEPTION 'Expected exactly one dismissed, manually overridden DECLARED_OTHER candidate';
  END IF;
  RAISE NOTICE 'Final blocking candidates: %', remaining_count;
END;
$remove_banks$;
```
