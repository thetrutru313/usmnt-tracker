---
name: Men's-only scope exclusion (USMNT Tracker)
description: How and where women's teams/leagues are excluded from the candidate pipeline, and the trap of defining a filter without wiring it everywhere it applies.
---

- API-Football's `/teams`, `/leagues`, and `/players` endpoints expose no gender field on any response shape this app parses. Name-pattern matching is the only available signal — don't waste time re-checking for a gender field on future sync work.
- The name patterns: `isWomensTeamName` (end-anchored `/\sW$/` suffix, e.g. "USA W", "Houston Dash W" — never a substring match, to avoid false positives like "Wimbledon") and `isWomensLeagueName` (case-insensitive regex over Women/Feminine/Femenil/Frauen/Femminile/Damallsvenskan/NWSL). Both live in `apiFootballSync.ts` and are exported.
- There were exactly two independent structured-data admission points into the pool: `ensureClubForTeam` (inserts/backfills `clubs` rows) and `discoverUSProspects` (squad-scans every row in `clubs_table`). Both must filter independently — a filter on one does not protect the other, since a legacy or future row can reach the second path without going through the first.
- Trap encountered: `isWomensLeagueName` was defined and exported but not wired into either admission point on the first pass (only the team-name check was used). A helper existing in the codebase does not mean it's actually protecting anything — grep for real call sites, not just the export, before assuming a defense is live. It's now wired into `discoverUSProspects` as a second signal against each club's stored `league` field (catches a women's-league club whose own name gives no signal, e.g. a hypothetical NWSL side without a "W" suffix).
- Known unaudited surfaces (not yet covered, filed as a follow-up task): RSS news ingestion and the `transfers` table's free-text `fromClub`/`toClub` columns don't go through `clubs` at all, so the same name-leak risk could exist there independently.
