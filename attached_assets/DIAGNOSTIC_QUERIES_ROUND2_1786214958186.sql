-- ============================================================================
-- USMNT Tracker — data consistency diagnostics, ROUND 2
-- 8 August 2026
--
-- ALL QUERIES READ-ONLY. Run against PRODUCTION (neondb).
--
-- ---------------------------------------------------------------------------
-- CORRECTION FIRST — READ THIS BEFORE ACTING ON ROUND 1
-- ---------------------------------------------------------------------------
-- Round 1's Q1, Q1b and Q1c were WRONG. They grouped player_stats by
-- (player_id, period_type). That is not the row identity.
--
-- `replaceSeasonHistoryRows` (playerStatsSync.ts:529-535) deliberately writes
-- ONE ROW PER SEASON YEAR for period_type 'season_all' — that is what powers
-- the club-season selector on the player profile. 'national_team_cycle' is
-- likewise one row per cycle. Multiple rows per (player, period_type) are
-- CORRECT for those two types.
--
-- So Round 1's "64 duplicate groups in season_all" almost certainly counted
-- legitimate multi-season history as duplication (162 rows / 64 players
-- averages 2.5 seasons each — exactly what real history looks like).
--
-- ** DO NOT ADD  UNIQUE (player_id, period_type). **
-- Round 1's Q1c reported 84 rows blocking it. Had anyone "cleaned up" those
-- 84 to make that constraint apply, it would have DELETED every player's
-- season history except one year per player. The correct key includes season:
--   UNIQUE (player_id, period_type, season)
--
-- Q14 below is the corrected duplicate check. Run it before touching any
-- constraint.
-- ============================================================================


-- ============================================================================
-- Q14 — Duplicate player_stats rows, CORRECTED
--
-- Groups by the real row identity: (player_id, period_type, season).
--
-- DECIDES: whether genuine duplicates exist at all.
-- Empty result -> Round 1's finding was an artefact of my grouping, the table
--                 is clean, and the missing ORDER BY at queries.ts:111 is
--                 latent rather than live.
-- Rows returned -> real duplicates; go to Q15.
-- ============================================================================

SELECT
  period_type,
  COUNT(*)      AS duplicate_groups,
  SUM(copies)   AS total_rows_involved,
  MAX(copies)   AS worst_case_copies
FROM (
  SELECT player_id, period_type, season, COUNT(*) AS copies
  FROM player_stats
  GROUP BY player_id, period_type, season
  HAVING COUNT(*) > 1
) d
GROUP BY period_type
ORDER BY duplicate_groups DESC;


-- ============================================================================
-- Q15 — Do any real duplicates disagree?
--
-- Round 1's Q1b was filtered to ('last5','previous5','season') and so was
-- structurally incapable of returning anything once Q1 showed duplicates only
-- in the other two types. This version covers ALL period types.
--
-- DECIDES: whether any displayed value is currently non-deterministic.
-- ============================================================================

SELECT
  p.id AS player_id,
  p.name,
  ps.period_type,
  ps.season,
  COUNT(*)                                 AS copies,
  MIN(ps.minutes)                          AS min_minutes,
  MAX(ps.minutes)                          AS max_minutes,
  MIN(ps.goals)                            AS min_goals,
  MAX(ps.goals)                            AS max_goals,
  MIN(ps.avg_rating)                       AS min_avg_rating,
  MAX(ps.avg_rating)                       AS max_avg_rating,
  MAX(ps.created_at) - MIN(ps.created_at)  AS age_spread
FROM player_stats ps
JOIN players p ON p.id = ps.player_id
GROUP BY p.id, p.name, ps.period_type, ps.season
HAVING COUNT(*) > 1
   AND (
        MIN(ps.avg_rating) IS DISTINCT FROM MAX(ps.avg_rating)
     OR MIN(ps.minutes) <> MAX(ps.minutes)
     OR MIN(ps.goals)   <> MAX(ps.goals)
   )
ORDER BY copies DESC, p.name;


-- ============================================================================
-- Q16 — Pre-flight for the CORRECT constraint
--
-- UNIQUE (player_id, period_type, season) is the right key. Zero means it can
-- be added directly with no cleanup.
-- ============================================================================

SELECT COUNT(*) AS rows_blocking_correct_constraint
FROM (
  SELECT player_id, period_type, season
  FROM player_stats
  GROUP BY player_id, period_type, season
  HAVING COUNT(*) > 1
) blockers;


-- ============================================================================
-- Q17 — Sanity check: is multi-row season_all actually normal?
--
-- Confirms the correction above against your data. Expect most players to
-- have 1-4 season_all rows, each with a DISTINCT season value.
--
-- DECIDES: nothing on its own — it is the evidence that Q1 was measuring
-- history rather than duplication.
-- ============================================================================

SELECT
  seasons_held,
  COUNT(*) AS players
FROM (
  SELECT player_id, COUNT(DISTINCT season) AS seasons_held, COUNT(*) AS rows_held
  FROM player_stats
  WHERE period_type = 'season_all'
  GROUP BY player_id
) x
GROUP BY seasons_held
ORDER BY seasons_held;


-- ============================================================================
-- Q18 — The 8 orphaned fixture_players rows (Q9 returned 8, I predicted 0)
--
-- fixture_players.player_id has no FK. These rows point at players that no
-- longer exist. They keep EXISTS true — so the fixture stays visible — while
-- the chip query's INNER JOIN yields nothing. A permanently chipless card.
--
-- DECIDES: which fixtures are affected, whether the orphans are the ONLY link
-- on those fixtures (permanently chipless) or sit alongside valid links
-- (harmless), and what player_ids were deleted.
-- ============================================================================

SELECT
  fp.id                AS link_id,
  fp.player_id         AS missing_player_id,
  fp.club_id           AS link_club_id,
  f.id                 AS fixture_id,
  f.home_team,
  f.away_team,
  f.competition,
  f.kickoff,
  f.status,
  f.is_national_team,
  (SELECT COUNT(*) FROM fixture_players fp2
     JOIN players p2 ON p2.id = fp2.player_id
    WHERE fp2.fixture_id = f.id)  AS valid_links_on_same_fixture
FROM fixture_players fp
LEFT JOIN players p ON p.id = fp.player_id
JOIN fixtures f ON f.id = fp.fixture_id
WHERE p.id IS NULL
ORDER BY f.kickoff DESC;


-- ============================================================================
-- Q19 — The 44 future orphan fixtures: are they reserve-team rows?
--
-- Q5 found 44 future non-NT fixtures with zero links. They are correctly
-- hidden today, but each becomes a chipless card the moment its kickoff
-- passes (the lt(kickoff, now) branch of the visibility filter), until a
-- purge run removes it.
--
-- The Q5b listing is dominated by "II" / reserve sides and MLS Next Pro,
-- which is the signature of the reserve guard at apiFootballSync.ts:1481
-- (isReserveFixture -> eligibleIds = []) inserting a fixture with no links
-- on purpose.
--
-- DECIDES: whether the fix is to stop INSERTING reserve fixtures at all,
-- rather than to purge them after the fact.
-- ============================================================================

SELECT
  f.competition,
  COUNT(*) AS orphan_fixtures,
  COUNT(*) FILTER (
    WHERE f.home_team ~ '(II|B)$' OR f.away_team ~ '(II|B)$'
  ) AS looks_like_reserve_side,
  MIN(f.kickoff) AS earliest,
  MAX(f.kickoff) AS latest
FROM fixtures f
WHERE NOT EXISTS (SELECT 1 FROM fixture_players fp WHERE fp.fixture_id = f.id)
  AND f.is_national_team = false
  AND f.kickoff >= now()
GROUP BY f.competition
ORDER BY orphan_fixtures DESC;


-- ============================================================================
-- Q20 — How long do orphans survive after kickoff?
--
-- purgeStaleOrphanedPastFixtures only removes past orphans still at
-- scheduled/live. A past orphan that a sync marked 'finished' before the
-- purge ran is never cleaned, and shows in Recent Results for 7 days.
--
-- DECIDES: whether the purge is keeping up, or whether finished orphans are
-- accumulating permanently.
-- ============================================================================

SELECT
  f.status,
  COUNT(*)       AS past_orphans,
  MIN(f.kickoff) AS oldest,
  MAX(f.kickoff) AS newest,
  COUNT(*) FILTER (WHERE f.kickoff >= now() - interval '7 days') AS in_recent_results_window
FROM fixtures f
WHERE NOT EXISTS (SELECT 1 FROM fixture_players fp WHERE fp.fixture_id = f.id)
  AND f.is_national_team = false
  AND f.kickoff < now()
GROUP BY f.status
ORDER BY past_orphans DESC;


-- ============================================================================
-- RE-RUNS — Q11, Q12 and Q13 results did not arrive. Repeated verbatim.
-- ============================================================================

-- Q11 — Admin club overrides currently in force
SELECT
  p.id,
  p.name,
  co.name                     AS override_club,
  c.name                      AS actual_club_id_value,
  p.club_override_set_at,
  CASE WHEN p.club_id = p.club_override_id
       THEN 'consistent'
       ELSE 'DRIFTED - override not reflected in club_id'
  END                         AS state
FROM players p
JOIN clubs c  ON c.id  = p.club_id
JOIN clubs co ON co.id = p.club_override_id
WHERE p.club_override_id IS NOT NULL
ORDER BY p.club_override_set_at DESC;


-- Q12 — Match-log result format (confirms the colour-coding bug)
-- EXPECTED: bare_letter_rows = 0, scoreline_rows = everything.
SELECT
  COUNT(*)                                           AS total_logs,
  COUNT(*) FILTER (WHERE result IN ('W', 'L', 'D'))  AS bare_letter_rows_would_colour_correctly,
  COUNT(*) FILTER (WHERE result ~ '^[WLD] ')         AS scoreline_rows_always_render_yellow,
  COUNT(*) FILTER (WHERE result = '')                AS empty_result_rows
FROM match_logs;


-- Q13 — Sync freshness
SELECT
  sync_name,
  last_run_at,
  now() - last_run_at AS age
FROM sync_metadata
ORDER BY last_run_at DESC NULLS LAST;
