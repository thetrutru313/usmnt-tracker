# Men's-Only Scope Fix — Investigation & Remediation Report

**Date:** August 26, 2026
**Scope:** USMNT Tracker — exclusion of women's teams/players/leagues from the candidate pipeline

---

## 1. Investigation findings (read-only, before any changes)

### Which candidates were female, and how did they get there?

10 candidates traced to two clubs in `clubs_table`:

- **`id 1869` "USA W"** (API-Football team 1718): M. Cooper, Jameese Joseph, T. Rodman, E. Sears, A. Thompson, S. Smith (all `pending`), S. Coffey (`dismissed`)
- **`id 1883` "Houston Dash W"** (API-Football team 2998): P. Nielsen, K. van Zanten, D. Colaprico (all `dismissed`)

A wider scan of `player_candidates` for any row pointing at either club found **26 rows total** (16 under "USA W", 10 under "Houston Dash W"), including additional real players (e.g. N. Girma, R. Lavelle, L. Horan) beyond the 10 initially sampled.

**Root cause — two separate admission points, not one:**

1. **`discoverUSProspects()`** (`playerDiscovery.ts`) treats every row in `clubs_table` with a non-null `apiFootballTeamId` as a trackable club and calls `/players/squads?team=...` on it — with no gender or team-type check at all. Once "USA W" and "Houston Dash W" existed as rows in `clubs_table`, their full rosters were scanned exactly like any men's club and ran straight through the quality gate, age gate, and eligibility scorer, none of which check gender.
2. **`ensureClubForTeam()`** (`apiFootballSync.ts`) is how "USA W"/"Houston Dash W" got into `clubs_table` in the first place — it's called when a squad/stats lookup resolves a tracked player's "current club" to one of these teams, and it inserted a minimal club row with no name/gender check.

### Does API-Football expose gender on /teams, /leagues, or /players?

**No.** Checked every response type this codebase parses (`AfTeamSearchResult`, `AfSquadEntry`, `AfDiscoveryResponse`, league blocks) — none include a gender field, and API-Football's schema doesn't expose one on these endpoints. The only available signal is name-based: team names suffixed `" W"` (e.g. "USA W", "Houston Dash W") and league names containing "Women" (e.g. "NWSL Women"). The codebase already had a partial name check (`isLikelyNationalTeamName`'s `" W"` suffix test), but it was only used for club-resolution/national-team-id caching, not at either admission point, and there was no league-name check anywhere.

### Which code path admitted them?

Both `ensureClubForTeam` (club-table insertion) and `discoverUSProspects`'s squad scan (candidate insertion) — confirmed as the two independent gaps above.

---

## 2. Fix implemented

### Name-pattern rules (`apiFootballSync.ts`, exported for reuse)

- **`isWomensTeamName(name)`** — matches ONLY an end-anchored `" W"` suffix (regex `/\sW$/`), never a substring match anywhere in the name. Verified against plausible men's club names ("Wimbledon AFC", "Watford", "West Ham United", "Cardiff City", "BW Lienen") to confirm no false positives.
- **`isWomensLeagueName(leagueName)`** — matches "Women", "Feminine", "Femenil", "Frauen", "Femminile", "Damallsvenskan", "NWSL" case-insensitively.

### Both admission points now filter independently

- **`ensureClubForTeam`** refuses to insert or return a row for a women's-side team name — returns `null` instead of a club, and logs a `warn` naming the team with "men's-only" in the message. Both call sites (`playerClubSync.ts` transfer handling, `apiFootballSync.ts` squad-registration sync) were updated to treat `null` as "could not resolve, fall back to the stored club" rather than assuming a club is always returned.
- **`discoverUSProspects`** independently drops any women's-side club from its scan list before ever calling `/players/squads`, even if one already exists in `clubs_table` (e.g. a legacy row from before this fix, or an admission point this filter doesn't cover) — logs the same way. This check does not depend on `ensureClubForTeam` having run.

Both filters log loudly (`logger.warn`, naming the team/club) on rejection so the behavior is visible in production logs.

`discoverUSProspects` also checks `isWomensLeagueName` against each club's stored `league` field, in addition to the team-name check — catching a club whose league reads as a women's competition (e.g. "NWSL") even if the club's own name gives no signal.

### Regression test — `womensTeamExclusion.test.ts` (10 tests)

- Unit tests for `isWomensTeamName` / `isWomensLeagueName`, including explicit false-positive checks against men's club names.
- Three integration tests across the two admission points:
  - `ensureClubForTeam` rejects "Houston Dash W" — returns `null`, never touches the DB, and logs with "men's-only" in the message.
  - `discoverUSProspects` skips a women's club ("USA W") already present in a seeded `clubs_table`, while still scanning a men's club ("Columbus Crew") normally in the same run.
  - `discoverUSProspects` skips a club whose `league` field reads "NWSL" even though the club's own name ("Riverside FC") gives no signal — confirming the league-name check is a real, independent backstop and not dead code.

Failure messages explicitly state this is a men's-only tracker, per the requirement that the fix path is "exclude the data," not "weaken the test."

### Documentation — `replit.md`

Added a **"Scope — read this first"** section near the top, stating the men's-only scope, that women's teams/players/competitions are out of scope everywhere in the codebase, that a regression test enforces it at both admission points, and that the fix for a failing test is to exclude data, never weaken or delete the test.

### Verification

- `pnpm run typecheck` — clean
- `pnpm run lint` — clean (0 errors; only pre-existing unrelated warnings)
- `pnpm --filter @workspace/api-server run test` — **813/813 passing** (3 pre-existing test files that mock `apiFootballSync.js` wholesale needed `isWomensTeamName` added to their mock exports — no behavior changes, just kept in sync with the new export)
- API server workflow restarted cleanly with the fix live

---

## 3. Open questions answered

**Does `clubs_table` contain any other women's teams beyond these two?**
No. Ran the exact pattern (name `" W"` suffix + the league regex) against all 96 rows in `clubs_table` — only "USA W" (id 1869) and "Houston Dash W" (id 1883) match.

**FK dependents on clubs 1869/1883 (checked before writing cleanup SQL):**
Only `player_candidates` — **26 rows** (16 under 1869, 10 under 1883; mix of `pending`/`dismissed`). Zero rows in `players`, zero in `fixture_players` reference either club — no promoted player is pinned to either, so there is no cascade risk.

---

## 4. Cleanup SQL (hand-run only — NOT included in a migration, per the DDL-only production constraint)

```sql
-- Run in this exact order (candidates first, due to the FK).
BEGIN;

DELETE FROM player_candidates WHERE club_id IN (1869, 1883);
-- expect 26 rows deleted

DELETE FROM clubs WHERE id IN (1869, 1883);
-- expect 2 rows deleted

COMMIT;
```

This was **not run** by the agent — it is provided for you to execute against the dev database when ready. It intentionally does not touch production; per project convention, production data changes are applied by hand through the Replit database console, not via migration files.
