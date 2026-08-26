-- Backfill (data, not schema) for migration 0006_api_football_teams_cache.
--
-- Every row in `clubs` is, by definition, a club — never a national team —
-- so this seeds the new `api_football_teams` cache with `is_national = false`
-- for every club whose API-Football team id is already known, at zero
-- API-Football calls. This is the "common case" the cache is meant to make
-- free: club appearances in club competitions never need a live lookup.
--
-- Safe to run multiple times (ON CONFLICT DO NOTHING) and safe to run
-- against production independently of the schema migration, per
-- lib/db/README.md (Publish only diffs schema, not data).
INSERT INTO api_football_teams (api_football_team_id, name, country, is_national, fetched_at)
SELECT api_football_team_id, name, country, false, now()
FROM clubs
WHERE api_football_team_id IS NOT NULL
ON CONFLICT (api_football_team_id) DO NOTHING;
