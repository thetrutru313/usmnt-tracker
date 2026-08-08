-- ============================================================================
-- USMNT Tracker — data consistency diagnostics
-- Companion to DATA_CONSISTENCY_AUDIT.md
-- 7 August 2026, written against schema at commit 784fdc6
--
-- ALL QUERIES ARE READ-ONLY. No INSERT/UPDATE/DELETE/DDL anywhere in this file.
-- Safe to run against production via Replit's executeSql (which is read-only
-- for production anyway).
--
-- Run against PRODUCTION (neondb), not dev (heliumdb). The whole point is to
-- learn what your users are actually seeing. Dev will give different answers.
--
-- Each query states what its answer DECIDES. Run Q1 first — it is the one
-- that determines whether the form-badge fix is urgent or merely correct.
-- ============================================================================


-- ============================================================================
-- Q1 — Do duplicate player_stats rows exist?
--
-- DECIDES: whether the missing ORDER BY at queries.ts:111 is currently
-- producing wrong badges, or is a latent bug that has not fired yet.
--
-- Zero rows returned  -> the badge is currently correct; the fix is still
--                        right (the race is reachable) but not urgent.
-- Rows returned       -> go straight to Q1b.
-- ============================================================================

SELECT
  period_type,
  COUNT(*)                                   AS duplicate_groups,
  SUM(copies)                                AS total_rows_involved,
  MAX(copies)                                AS worst_case_copies
FROM (
  SELECT player_id, period_type, COUNT(*) AS copies
  FROM player_stats
  GROUP BY player_id, period_type
  HAVING COUNT(*) > 1
) d
GROUP BY period_type
ORDER BY duplicate_groups DESC;


-- ============================================================================
-- Q1b — Do those duplicates actually DISAGREE?
--
-- This is the decisive query, not Q1. Duplicate rows holding identical values
-- are harmless: whichever one Postgres returns, the badge is the same.
-- Duplicates that disagree on minutes or avg_rating mean the badge is being
-- picked arbitrarily right now, and can differ between two page loads.
--
-- DECIDES: urgency of Tier-1 fixes 2 and 3.
-- Any row here is a player whose badge is currently non-deterministic.
-- ============================================================================

SELECT
  p.id                                        AS player_id,
  p.name,
  ps.period_type,
  COUNT(*)                                    AS copies,
  MIN(ps.minutes)                             AS min_minutes,
  MAX(ps.minutes)                             AS max_minutes,
  MIN(ps.avg_rating)                          AS min_avg_rating,
  MAX(ps.avg_rating)                          AS max_avg_rating,
  MIN(ps.created_at)                          AS oldest_row,
  MAX(ps.created_at)                          AS newest_row,
  MAX(ps.created_at) - MIN(ps.created_at)     AS age_spread
FROM player_stats ps
JOIN players p ON p.id = ps.player_id
WHERE ps.period_type IN ('last5', 'previous5', 'season')
GROUP BY p.id, p.name, ps.period_type
HAVING COUNT(*) > 1
   AND (
        MIN(ps.avg_rating) IS DISTINCT FROM MAX(ps.avg_rating)
     OR MIN(ps.minutes)    <>              MAX(ps.minutes)
   )
ORDER BY copies DESC, p.name;


-- ============================================================================
-- Q1c — Pre-flight for the unique constraint (Tier-1 fix 3)
--
-- Before adding UNIQUE (player_id, period_type), confirm nothing violates it.
-- A non-zero answer means the constraint creation WILL fail, and the
-- duplicates must be cleaned first.
--
-- DECIDES: whether the constraint can be added directly or needs a cleanup
-- step in front of it.
-- ============================================================================

SELECT COUNT(*) AS rows_that_would_block_the_constraint
FROM (
  SELECT player_id, period_type
  FROM player_stats
  GROUP BY player_id, period_type
  HAVING COUNT(*) > 1
) blockers;


-- ============================================================================
-- Q2 — Which players' Transfers page disagrees with their profile?
--
-- The Transfers page renders transfers.to_club (free text).
-- The profile renders clubs.name via players.club_id.
-- This lists every player where those two differ right now.
--
-- DECIDES: how widespread §1.1 is, and gives you named players to spot-check
-- in the UI.
-- ============================================================================

WITH latest_transfer AS (
  SELECT DISTINCT ON (t.player_id)
    t.player_id,
    t.from_club,
    t.to_club,
    t.announced_at,
    t.transfer_type
  FROM transfers t
  WHERE t.status = 'confirmed'
  ORDER BY t.player_id, t.announced_at DESC
)
SELECT
  p.id                        AS player_id,
  p.name,
  lt.to_club                  AS transfers_page_shows,
  c.name                      AS profile_and_fixtures_show,
  lt.from_club                AS moved_from,
  lt.announced_at,
  lt.transfer_type,
  co.name                     AS admin_override_club,
  p.squad_last_checked_at,
  c.api_football_team_id      AS current_club_af_team_id
FROM latest_transfer lt
JOIN players p ON p.id = lt.player_id
JOIN clubs   c ON c.id = p.club_id
LEFT JOIN clubs co ON co.id = p.club_override_id
WHERE c.name IS DISTINCT FROM lt.to_club
ORDER BY lt.announced_at DESC;


-- ============================================================================
-- Q2b — WHICH silent guard branch is firing, for each player from Q2
--
-- The transfer-precedence guard (apiFootballSync.ts:1229-1272) has three
-- skip paths and none of them logs. This reconstructs which one applies.
--
-- DECIDES: what to actually fix. The three causes need different repairs:
--   'club row has NULL api_football_team_id' -> ensureClubForTeam backfill bug
--   'no clubs row matches to_club string'    -> club naming / text mismatch
--   'name matches - guard should have fired'  -> a different bug entirely,
--                                                investigate further
-- ============================================================================

WITH latest_transfer AS (
  SELECT DISTINCT ON (t.player_id)
    t.player_id, t.to_club, t.announced_at
  FROM transfers t
  WHERE t.status = 'confirmed'
  ORDER BY t.player_id, t.announced_at DESC
)
SELECT
  p.name,
  lt.to_club                       AS transfer_destination_text,
  c.name                           AS current_club_name,
  dest.id                          AS matching_club_row_id,
  dest.api_football_team_id        AS matching_club_af_team_id,
  CASE
    WHEN dest.id IS NULL
      THEN 'no clubs row matches to_club string'
    WHEN dest.api_football_team_id IS NULL
      THEN 'club row has NULL api_football_team_id'
    WHEN c.name = lt.to_club
      THEN 'club_id already correct - not a mismatch'
    ELSE 'name matches - guard should have fired, investigate'
  END                              AS likely_guard_skip_reason
FROM latest_transfer lt
JOIN players p ON p.id = lt.player_id
JOIN clubs   c ON c.id = p.club_id
LEFT JOIN clubs dest ON dest.name = lt.to_club
WHERE c.name IS DISTINCT FROM lt.to_club
ORDER BY likely_guard_skip_reason, p.name;


-- ============================================================================
-- Q3 — Is the Transfers page accumulating duplicate rows for one move?
--
-- announced_at falls back to new Date() (sync wall clock) when the API date
-- is null (playerClubSync.ts:821), and the dedup key is
-- (player_id, announced_at). So a null-dated move writes a NEW row daily.
--
-- DECIDES: whether §1.1's duplicate-row prediction is real. If it is, the
-- Transfers page is showing the same move many times.
-- ============================================================================

SELECT
  p.name,
  t.from_club,
  t.to_club,
  COUNT(*)                AS row_count,
  MIN(t.announced_at)     AS first_recorded,
  MAX(t.announced_at)     AS last_recorded,
  MAX(t.announced_at) - MIN(t.announced_at) AS spread
FROM transfers t
JOIN players p ON p.id = t.player_id
GROUP BY p.name, t.from_club, t.to_club
HAVING COUNT(*) > 1
ORDER BY row_count DESC, p.name;


-- ============================================================================
-- Q3b — How many transfer dates are real API dates vs sync wall-clock?
--
-- API-Football supplies date-only values, which land at midnight UTC.
-- The new Date() fallback lands at whatever time the sync happened to run.
-- A non-midnight time component is therefore a strong signal of the fallback.
--
-- DECIDES: how much of the transfers table has synthetic dates, i.e. how
-- exposed you are to the daily-duplicate behaviour in Q3.
-- ============================================================================

SELECT
  COUNT(*)                                                                   AS total_transfers,
  COUNT(*) FILTER (WHERE (announced_at AT TIME ZONE 'UTC')::time = '00:00:00') AS midnight_utc_likely_real_api_date,
  COUNT(*) FILTER (WHERE (announced_at AT TIME ZONE 'UTC')::time <> '00:00:00') AS non_midnight_likely_wallclock_fallback
FROM transfers;


-- ============================================================================
-- Q4 — Confirm Rankings "Transfer Buzz" is structurally empty
--
-- rankings.ts:124 filters status = 'rumor' and orders by probability_score.
-- The only writer sets status = 'confirmed' and never writes probability_score.
--
-- EXPECTED: one row, status='confirmed', with_probability_score = 0.
-- DECIDES: nothing - this is confirmation. If it matches, the panel has
-- always been empty and should be implemented or deleted.
-- ============================================================================

SELECT
  status,
  COUNT(*)                          AS rows,
  COUNT(probability_score)          AS with_probability_score
FROM transfers
GROUP BY status
ORDER BY rows DESC;


-- ============================================================================
-- Q5 — Untagged fixtures: how many, and why is each one visible?
--
-- routes/fixtures.ts:229-237 admits a fixture with no player links when it is
-- flagged national-team, OR when kickoff is in the past. The Fixtures page
-- requests scope="all", so there is no kickoff bound at all.
--
-- DECIDES: whether the untagged fixtures you see are the by-design NT ones
-- (a spec decision) or past-kickoff orphans (a reaper gap). The split tells
-- you which of the two problems to attack.
-- ============================================================================

SELECT
  CASE
    WHEN f.is_national_team           THEN 'NT flag - unconditional bypass (by design)'
    WHEN f.kickoff < now()            THEN 'past kickoff - bypass via lt(kickoff, now)'
    ELSE                                   'future non-NT - should NOT be visible'
  END                                 AS why_visible,
  f.status,
  COUNT(*)                            AS fixtures,
  MIN(f.kickoff)                      AS earliest,
  MAX(f.kickoff)                      AS latest
FROM fixtures f
WHERE NOT EXISTS (
  SELECT 1 FROM fixture_players fp WHERE fp.fixture_id = f.id
)
GROUP BY why_visible, f.status
ORDER BY fixtures DESC;


-- ============================================================================
-- Q5b — The untagged fixtures currently on screen, listed
--
-- Narrowed to what a user actually sees now: upcoming, or finished within
-- the last 7 days (the Recent Results window in Fixtures.tsx).
--
-- DECIDES: gives you the concrete rows to eyeball against the live page.
-- ============================================================================

SELECT
  f.id,
  f.home_team,
  f.away_team,
  f.competition,
  f.kickoff,
  f.status,
  f.is_national_team,
  f.api_football_fixture_id
FROM fixtures f
WHERE NOT EXISTS (SELECT 1 FROM fixture_players fp WHERE fp.fixture_id = f.id)
  AND (
        f.kickoff >= now() - interval '2 hours'
     OR (f.status = 'finished' AND f.kickoff >= now() - interval '7 days')
      )
ORDER BY f.kickoff;


-- ============================================================================
-- Q6 — Fixtures that ARE tagged but render with zero player chips
--
-- Row visibility uses EXISTS on a link row (fixtures.ts:234).
-- Chip display additionally drops links whose club_id no longer matches the
-- player's current club, on scheduled fixtures (queries.ts:392-393).
-- A fixture where EVERY link is stale passes the first test and fails the
-- second: a card with no players on it.
--
-- DECIDES: whether the "fixtures without tagged players" you see are actually
-- this - fixtures that DO have tags, all of them stale. Different root cause
-- from Q5, and it is downstream of the club_id problem in Q2.
-- ============================================================================

SELECT
  f.id,
  f.home_team,
  f.away_team,
  f.kickoff,
  f.status,
  COUNT(*)                                     AS total_links,
  COUNT(*) FILTER (
    WHERE fp.club_id IS NOT NULL AND fp.club_id <> p.club_id
  )                                            AS stale_links,
  COUNT(*) FILTER (WHERE fp.club_id IS NULL)   AS null_club_links_never_purgeable
FROM fixtures f
JOIN fixture_players fp ON fp.fixture_id = f.id
JOIN players p          ON p.id = fp.player_id
WHERE f.status = 'scheduled'
GROUP BY f.id
HAVING COUNT(*) = COUNT(*) FILTER (
  WHERE fp.club_id IS NOT NULL AND fp.club_id <> p.club_id
)
ORDER BY f.kickoff;


-- ============================================================================
-- Q6b — Link rows with a NULL club_id
--
-- purgeStaleTransferredPlayerLinks only deletes rows where
-- club_id IS NOT NULL AND club_id <> players.club_id. A NULL club_id link is
-- therefore permanently immune to purging, and the chip filter at
-- queries.ts:392 also requires club_id IS NOT NULL to consider it stale.
--
-- DECIDES: the size of the permanently-unreconcilable link population.
-- ============================================================================

SELECT
  COUNT(*)                                            AS total_links,
  COUNT(*) FILTER (WHERE fp.club_id IS NULL)          AS null_club_id,
  ROUND(100.0 * COUNT(*) FILTER (WHERE fp.club_id IS NULL) / NULLIF(COUNT(*), 0), 1)
                                                      AS pct_null
FROM fixture_players fp;


-- ============================================================================
-- Q7 — Players whose pool-tier badge differs between the profile and the list
--
-- List/dashboard/rankings/search use computePoolTier (queries.ts:42-46),
-- driven by world_cup_roster and national_team_caps.
-- The player profile uses category (PlayerProfile.tsx:111-112).
-- These are different rules. This query names every player they disagree on.
--
-- DECIDES: how visible §2.1 is. The code's own comment predicts Yunus Musah
-- appears here. Every name returned is a player whose badge changes when you
-- click into them.
-- ============================================================================

SELECT
  p.id,
  p.name,
  p.category,
  p.world_cup_roster,
  p.national_team_caps,
  CASE
    WHEN p.world_cup_roster        THEN 'Core Squad'
    WHEN p.national_team_caps >= 5 THEN 'In the Mix'
    ELSE                                'Prospect'
  END AS list_and_dashboard_show,
  CASE
    WHEN p.category = 'current' THEN 'Core Squad'
    WHEN p.category = 'fringe'  THEN 'In the Mix'
    ELSE                             'Prospect'
  END AS profile_shows
FROM players p
WHERE
  (CASE
     WHEN p.world_cup_roster        THEN 'Core Squad'
     WHEN p.national_team_caps >= 5 THEN 'In the Mix'
     ELSE                                'Prospect'
   END)
  <>
  (CASE
     WHEN p.category = 'current' THEN 'Core Squad'
     WHEN p.category = 'fringe'  THEN 'In the Mix'
     ELSE                             'Prospect'
   END)
ORDER BY p.name;


-- ============================================================================
-- Q8 — Profile vs Rankings: the two "season" aggregates
--
-- period_type 'season'     = current club only  -> used by Rankings
-- period_type 'season_all' = all clubs          -> headlines the profile
-- A player who moved mid-season legitimately shows different totals on the
-- two screens.
--
-- DECIDES: how many players are affected by §2.3, and therefore whether this
-- needs a UI labelling change or is currently invisible.
-- ============================================================================

SELECT
  p.id,
  p.name,
  s.season,
  s.goals      AS rankings_goals_current_club,
  sa.goals     AS profile_goals_all_clubs,
  s.minutes    AS rankings_minutes,
  sa.minutes   AS profile_minutes
FROM players p
JOIN player_stats s  ON s.player_id  = p.id AND s.period_type  = 'season'
JOIN player_stats sa ON sa.player_id = p.id AND sa.period_type = 'season_all'
                    AND sa.season = s.season
WHERE s.goals <> sa.goals OR s.minutes <> sa.minutes
ORDER BY (sa.goals - s.goals) DESC, p.name;


-- ============================================================================
-- Q9 — Orphaned link rows pointing at players that no longer exist
--
-- fixture_players.player_id has NO foreign key (schema/fixtures.ts:45), while
-- the chip query INNER JOINs players. An orphan link keeps EXISTS true - so
-- the fixture stays visible - while producing zero chips, permanently.
--
-- EXPECTED: 0. A non-zero answer is a third, previously unsuspected cause of
-- chipless fixture cards.
-- ============================================================================

SELECT COUNT(*) AS orphan_links_pointing_at_missing_players
FROM fixture_players fp
LEFT JOIN players p ON p.id = fp.player_id
WHERE p.id IS NULL;


-- ============================================================================
-- Q10 — Confirm the dead denormalised columns are in fact dead
--
-- players.performance_trend and players.trending are NOT NULL DEFAULT
-- 'steady' / false, with no live writer. The badge is computed at read time.
--
-- EXPECTED: everything 'steady' and trending = false, EXCEPT any rows an
-- older sync wrote before the column was abandoned.
-- DECIDES: whether the columns can simply be dropped, or hold residue worth
-- looking at first.
-- ============================================================================

SELECT
  performance_trend,
  trending,
  COUNT(*) AS players
FROM players
GROUP BY performance_trend, trending
ORDER BY players DESC;


-- ============================================================================
-- Q11 — Admin club overrides currently in force
--
-- club_override_id is a second club pointer that no public read route
-- consults. It is correct on screen only because two syncs copy it into
-- club_id. admin.ts:1052-1055 clears the override WITHOUT reverting club_id.
--
-- DECIDES: whether any player is currently pinned, and whether any pin has
-- drifted out of sync with the club_id it is supposed to be forcing.
-- ============================================================================

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


-- ============================================================================
-- Q12 — Match-log result format, confirming the colour-coding bug
--
-- PlayerProfile.tsx:347 tests match.result === 'W'.
-- playerStatsSync.ts:186 writes `${outcome} ${goals}-${goals}`, e.g. "W 2-1".
--
-- EXPECTED: bare_letter_rows = 0, which means the comparison never matches
-- and every match row renders in the yellow draw colour.
-- DECIDES: confirms Tier-1 fix 1 against real data rather than by reading.
-- ============================================================================

SELECT
  COUNT(*)                                              AS total_logs,
  COUNT(*) FILTER (WHERE result IN ('W', 'L', 'D'))     AS bare_letter_rows_would_colour_correctly,
  COUNT(*) FILTER (WHERE result ~ '^[WLD] ')            AS scoreline_rows_always_render_yellow,
  COUNT(*) FILTER (WHERE result = '')                   AS empty_result_rows
FROM match_logs;


-- ============================================================================
-- Q13 — Sync freshness, for context on everything above
--
-- If a sync has not run recently, some disagreements above are simply stale
-- rather than structurally broken. Read this before concluding anything is
-- permanently wrong.
-- ============================================================================

SELECT
  sync_name,
  last_run_at,
  now() - last_run_at AS age
FROM sync_metadata
ORDER BY last_run_at DESC NULLS LAST;
