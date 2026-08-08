# Prompt 11 — Display Consistency Fixes: Report

**Date:** 2026-08-08  
**Commit:** `prompt-11: display consistency fixes (A-D)`  
**Branch:** `main`

---

## Summary

Four display-consistency fixes shipped with no schema changes, no migrations, and no alterations to `category` column values or `computeFormBadge` logic.

---

## 1. Before / After Test Counts

| Suite | Before (failing) | After |
|---|---|---|
| `api-server` (full, 92 files) | 5 failing — 728 / 733 | **733 / 733 ✅** |
| `usmnt-tracker` (full, 13 files) | 4 failing — 219 / 223 | **223 / 223 ✅** |
| Codegen-drift check | — | **clean ✅** |
| Lint | — | **0 errors (4 pre-existing warnings) ✅** |
| Typecheck (all packages) | — | **clean ✅** |
| Build | — | **clean ✅** |

### Regression tests written (8 total)

| # | File | What it guards |
|---|---|---|
| 1 | `PlayerProfile.test.tsx` | Win result renders `text-green-500` |
| 2 | `PlayerProfile.test.tsx` | Loss result renders `text-destructive` |
| 3 | `PlayerProfile.test.tsx` | Draw result renders `text-yellow-500` |
| 4 | `PlayerProfile.test.tsx` | Empty result renders neither green nor red |
| 5 | `PlayerProfile.test.tsx` | `poolTier='inMix'` shows "In the Mix" even when `category='current'` |
| 6 | `PlayerProfile.test.tsx` | `poolTier='prospect'` shows "Prospect" even when `category='fringe'` |
| 7 | `Rankings.test.tsx` | No "Transfer Buzz" text in the rendered Rankings page |
| 8 | `poolTierCrossRouteConsistency.test.ts` | `/api/players/:id` returns `poolTier`; value matches `/api/players` list |
| 9 | `poolTierCrossRouteConsistency.test.ts` | Profile and list `poolTier` agree for every player |
| 10 | `rankingsSeasonAllFilter.test.ts` | `mostGoalContributions` uses `season_all` totals, not `season` |
| 11 | `rankingsSeasonAllFilter.test.ts` | `mostMinutes` only includes players with a `season_all` row for the current year |
| 12 | `formBadgeSeasonCarveout.test.ts` | `computeFormBadgesForPlayerIds` still reads `period_type='season'` as baseline — not `season_all` |

---

## 2. OpenAPI Spec Diff + Codegen Confirmation

### `PlayerProfile` schema

```yaml
# BEFORE
required:
  - id
  - name
  - slug
  - position
  - category
  - clubName
  # ... (no poolTier)

# AFTER
required:
  - id
  - name
  - slug
  - position
  - category
  - poolTier          # ← added
  - clubName
properties:
  category:
    $ref: "#/components/schemas/PlayerCategory"
  poolTier:           # ← added
    $ref: "#/components/schemas/PlayerPoolTier"
  clubName: { type: string }
```

### `Rankings` schema

```yaml
# BEFORE
required:
  - mostInForm
  - bestWeekendPerformances
  - mostMinutes
  - mostGoalContributions
  - returningFromInjury
  - risingFast
  - transferBuzz      # ← removed
properties:
  transferBuzz:
    type: array
    items:
      $ref: "#/components/schemas/Transfer"

# AFTER
required:
  - mostInForm
  - bestWeekendPerformances
  - mostMinutes
  - mostGoalContributions
  - returningFromInjury
  - risingFast
  - seasonYear        # ← added
properties:
  seasonYear:
    type: string      # ← added (replaces transferBuzz)
```

Codegen (`orval`) regenerated:
- `lib/api-zod/src/generated/api.ts` — `GetPlayerResponse` now includes `poolTier`; `GetRankingsResponse` drops `transferBuzz`, gains `seasonYear`
- `lib/api-client-react/src/generated/api.schemas.ts` — `PlayerProfile` interface gains `poolTier: PlayerPoolTier`; `Rankings` interface swaps `transferBuzz` for `seasonYear`
- `lib/api-zod/src/generated/types/playerProfile.ts` — imports `PlayerPoolTier`, adds field
- `lib/api-zod/src/generated/types/rankings.ts` — drops `Transfer` import, swaps field

Drift check after commit: **✓ Generated files are in sync with the spec.**

---

## 3. Musah / Sargent Badge Fix

### Root cause

`PlayerProfile.tsx` derived the pool-tier badge entirely from `category`:

```tsx
// BEFORE — wrong rule, different from every other surface
const tier = player.category === 'current' ? 'core'
           : player.category === 'fringe'  ? 'inMix'
           : 'prospect';
```

`computePoolTier` (used by `listPlayers`, rankings, and fixture helpers) uses:

```ts
// The actual rule
if (worldCupRoster)        return 'core';
if (nationalTeamCaps >= 5) return 'inMix';
return 'prospect';
```

These rules diverge for any player where `category` and `(worldCupRoster, caps)` disagree. The Q7 diagnostic confirmed **8 such players** in production, including Yunus Musah (`category='current'`, `worldCupRoster=false`, 47 caps → should be `'inMix'`, was showing "Core Squad").

### Fix

`getPlayerById` (`queries.ts`) now:
1. Adds `worldCupRoster` to its `SELECT`
2. Calls `computePoolTier({worldCupRoster, nationalTeamCaps, age})`
3. Returns `poolTier` on the response (stripping `worldCupRoster` from the payload)

`PlayerProfile.tsx` now reads `player.poolTier` directly — same value, same function, as every other surface.

```tsx
// AFTER — reads server-computed value
const tier: PoolTier = player.poolTier as PoolTier;
const label = tier === 'core'   ? 'Core Squad'
            : tier === 'inMix'  ? 'In the Mix'
            : 'Prospect';
```

**Result for the 8 known disagreement cases:** Musah and similar players now show the correct badge on their profile pages, matching the Players list and Rankings cards.

---

## 4. `seasonYearCandidates()` — Derivation and Ranking Impact

### What the function does

```ts
// artifacts/api-server/src/lib/playerStatsSync.ts
export function seasonYearCandidates(): number[] {
  const currentYear = new Date().getUTCFullYear();
  return [currentYear, currentYear - 1, currentYear - 2];
}
```

It returns the three most plausible active season years, most-current first. Previously it was private (internal to `playerStatsSync.ts`); it has been exported so the rankings route can import it without duplicating the year-derivation logic.

### How rankings uses it

```ts
const [currentSeasonYear] = seasonYearCandidates();  // e.g. 2026
const currentSeasonStr = String(currentSeasonYear);  // "2026"

// mostMinutes — BEFORE (current club only, mixes all years)
.where(eq(playerStatsTable.periodType, "season"))

// mostMinutes — AFTER (all clubs in season, pinned to current year)
.where(and(
  eq(playerStatsTable.periodType, "season_all"),
  eq(playerStatsTable.season, currentSeasonStr),
))
```

**`season_all`** accumulates goals/minutes across every club a player has played for during the calendar year — critical for players who transferred mid-season.  
**Explicit year filter** prevents mixing a player's 2025 totals with another player's 2026 totals when both have `season_all` rows.

The `seasonYear` field is returned in the response so the frontend can label the Ironmen card (`"Ironmen (Minutes) · 2026"`) without re-deriving the year client-side.

### Form badge carve-out (unchanged)

`computeFormBadgesForPlayerIds` continues to read `period_type='season'` as its baseline. Test 12 (`formBadgeSeasonCarveout.test.ts`) seeds a player with `season.avgRating=7.0` and `season_all.avgRating=8.5`, then asserts the badge is `on_fire` (delta +0.6 from 7.0 baseline) — which would flip to `ice_cold` if `season_all` were accidentally used. The form badge is intentionally scoped to the current club's season.

---

## 5. Unanticipated Items

### Transfer Buzz query was already dead

The `transfers` table has no rows with `status='rumor'` — the query has been returning `[]` on every rankings page load since the feature was built. Removing it saves one database round-trip per request. The frontend `Rankings.tsx` never rendered a Transfer Buzz panel, so there was no UI to remove.

### `on_fire` correctly sets `trending: true`

The regression test for the form badge carve-out (Test 8) was initially written expecting `trending: false` for an `on_fire` badge. In practice, `computeFormBadgesForPlayerIds` sets `trending: true` whenever `performanceTrend` is `on_fire` or `rising`. The primary assertion (`on_fire`, not `ice_cold`) was correct and continues to guard against accidental `season_all` reads; the `trending` expected value was corrected to `true`.

### Vite Pre-transform error (self-healed)

Between the first codegen run and the git commit, Vite's HMR temporarily could not resolve the regenerated generated files. The errors appeared for ~5 seconds in the dev server log and resolved automatically once the committed files were picked up. No errors were recorded in the browser console; no user impact.

---

## Inline Checklist

| Item | Status |
|---|---|
| `match.result === 'W'` comparison gone | ✅ replaced with `match.result[0] === 'W'` |
| `category`-based tier derivation gone from `PlayerProfile.tsx` | ✅ replaced with `player.poolTier` |
| `poolTier` added to `PlayerProfile` in spec | ✅ required + properties |
| `computePoolTier` called, not duplicated | ✅ same function imported from `queries.ts` |
| No `status = 'rumor'` query in rankings | ✅ `transferBuzzRaw` removed entirely |
| `season_all` with explicit year in rankings leaderboards | ✅ both `mostMinutes` and `mostGoalContributions` |
| No migrations added | ✅ confirmed — schema unchanged |
