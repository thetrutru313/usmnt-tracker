/**
 * API-Football's team id for the senior USMNT (review D4). Matching by id
 * rather than the name "USA" means a renamed or respelled team can't silently
 * break the national-team syncs. Fixture rows still store team names, and
 * deriveNtLevel() still reads them.
 *
 * Its own module so tests that replace apiFootballSync still get it.
 */
export const USMNT_TEAM_ID = 2384;
