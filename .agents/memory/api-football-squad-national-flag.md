---
name: API-Football squad national flag unreliability
description: /players/squads during international windows omits national:true for national-team entries; name-based filter required.
---

## Rule
Never rely solely on `team.national === true` to identify national-team entries from `/players/squads?player={id}`. During international windows the flag is frequently omitted or absent entirely, so a name-based secondary check is required.

**Current filter in `fetchPlayerCurrentTeam` (apiFootballSync.ts):**
```
data.find((e) => e.team.national !== true && !isLikelyNationalTeamName(e.team.name))
```

`isLikelyNationalTeamName` rejects:
- Any name containing `\bU(15–23)\b` (youth national teams, all countries)
- Exact matches: "USA", "United States", "USA W" (senior USMNT squads)

Return `null` (fall back to stored `club_id`) when no club entry passes the filter.

**Why:** During the 2026 Gold Cup window the API returned USA, Germany U18, United States U23, etc. without `national: true`, causing 39 players to be mis-assigned to auto-created national-team club rows (ids 1863–1874). Those rows had `league: 'Unknown', country: 'Unknown'` and corrupted all fixture_players links.

**How to apply:** If this filter ever misses a new national team, add its name pattern to `isLikelyNationalTeamName`. The function is a named export so it can be unit-tested in isolation. Keep the pattern conservative — over-blocking a legitimate club name is worse than under-blocking a national team (both fall back to stored club_id, but mis-blocking a real club means no fixture sync for that player).
