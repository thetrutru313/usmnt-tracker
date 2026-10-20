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
