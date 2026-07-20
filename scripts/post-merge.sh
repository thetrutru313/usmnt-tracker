#!/bin/bash
set -e
pnpm install --frozen-lockfile

# Backfill invoice_url → invoice_urls before the schema push drops the old column.
# This is idempotent: skips backfill if invoice_url column no longer exists.
psql "$DATABASE_URL" <<'EOSQL'
ALTER TABLE transparency_months
  ADD COLUMN IF NOT EXISTS invoice_urls jsonb NOT NULL DEFAULT '[]';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transparency_months' AND column_name = 'invoice_url'
  ) THEN
    UPDATE transparency_months
    SET invoice_urls = json_build_array(
      json_build_object('label', 'Invoice', 'url', invoice_url)
    )
    WHERE invoice_url IS NOT NULL
      AND invoice_urls = '[]'::jsonb;
  END IF;
END $$;
EOSQL

# Backfill: correct Cole Campbell's api_football_player_id and club assignment
# after the re-pin from Houston Dash W (false-positive) to SV Elversberg.
# Idempotent: WHERE guards ensure no-op when already correct.
psql "$DATABASE_URL" <<'EOSQL'
-- 1. Apply the KNOWN_PLAYER_IDS pin: correct id (328617, SV Elversberg)
--    overrides the old false-positive (102301, Houston Dash W).
UPDATE players
SET
  api_football_player_id = 328617,
  club_id = 41,
  photo_url = 'https://media.api-sports.io/football/players/328617.png'
WHERE id = 47
  AND (api_football_player_id IS DISTINCT FROM 328617 OR club_id IS DISTINCT FROM 41);

-- 2. Remove stale fixture_players links that still point to Houston Dash W
--    for scheduled/live fixtures — the fixture sync will recreate them under
--    the correct club (SV Elversberg, club_id=41) on the next sweep.
DELETE FROM fixture_players fp
USING fixtures f
WHERE fp.fixture_id = f.id
  AND fp.player_id = 47
  AND fp.club_id = 1883
  AND f.status IN ('scheduled', 'live');

-- 3. Tag Cole Campbell on all upcoming SV Elversberg fixtures not already linked.
INSERT INTO fixture_players (fixture_id, player_id, club_id)
SELECT f.id, 47, 41
FROM fixtures f
WHERE (f.home_team = 'SV Elversberg' OR f.away_team = 'SV Elversberg')
  AND f.is_national_team = false
  AND f.status IN ('scheduled', 'live')
  AND NOT EXISTS (
    SELECT 1 FROM fixture_players fp2
    WHERE fp2.fixture_id = f.id AND fp2.player_id = 47
  );
EOSQL

# Use push-force so drizzle-kit doesn't hang on confirmation prompts in CI.
pnpm --filter db push-force
