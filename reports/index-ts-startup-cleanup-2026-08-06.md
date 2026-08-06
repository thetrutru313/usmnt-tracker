# `index.ts` startup block cleanup — 2026-08-06

`artifacts/api-server/src/index.ts`: 555 lines → 407 lines (−148)

---

## Step 1 — Inventory (as of cleanup date)

| Block | Lines (before) | Description |
|---|---|---|
| A | 40–65 | Schedule event date correction — UPDATE `schedule_events` for Sept/Oct 2026 slugs |
| B | 67–218 | Sept/Oct 2026 USMNT friendly seed — inserts sentinels −2001 to −2004, corrects, deduplicates, purges retired |
| C | 236–238 | Weight-drift check — `checkAndApplyWeightDrift()` — recurring, untouched |
| D | 240–308 | NT fixture ID backfill — promotes NULL/negative IDs to real API IDs via match log lookup |
| E | 310–331 | Obed Vargas removal — deletes player and all child rows |
| F | 333–359 | Phantom CONCACAF Nations League cleanup — deletes NULL-id USA vs Jamaica/T&T fixtures |
| G | 361–386 | `is_national_team` flag backfill — sets flag true on unflagged USA/US youth fixtures |
| H | 388–406 | Fox One streaming backfill — sets streaming on `CONCACAF U20` fixtures |
| I | 408–426 | FIFA+ streaming backfill — sets streaming on `World Cup - U17` fixtures |
| J | 428–491 | Six youth fixtures seed — inserts 6 US U20/U17 fixtures ON CONFLICT DO NOTHING |
| — | 493–554 | Schedule starts — `startRss…`, `startApiFootball…`, etc. — untouched |

---

## Step 2 — Recurrence analysis

### Block A — Schedule event date correction

**Dev:** `friendlies-sept-2026` → start `2026-09-26`, end `2026-09-29`, status `confirmed` ✅  
**Prod:** identical ✅

**Can it recur?** No. `schedule_events` is a hand-curated table. No sync pipeline writes to it. Once the correction lands it cannot revert without a manual change.

---

### Block B — Sept/Oct 2026 USMNT friendly seed

**Dev:** 4 sentinel rows (−2001 to −2004), all `status=scheduled` ✅  
**Prod:** same 4 rows ✅

**Can it recur?** This block is **active duty**, not a one-time repair. The matches are in the future (Sept/Oct 2026, today is 2026-08-06). Sentinels are the live data. The dedup and purge logic within the block manages the sentinel → real-ID transition once match logs arrive.

*Removable when:* all 4 sentinels have been promoted to positive `api_football_fixture_id` values and the NT sync takes over management.

---

### Block C — Weight-drift check

Recurring by design. Untouched.

---

### Block D — NT fixture ID backfill

**Dev:** 4 rows with negative IDs (the 4 sentinels from Block B) — no unexpected NULL-id rows ✅  
**Prod:** same 4 rows ✅

**Can it recur?** This block is **active duty**. It is the only mechanism that promotes a sentinel ID to a real `api_football_fixture_id` once match logs exist. Removing it now would leave the sentinels stuck at −2001/−2002/−2003/−2004 forever.

*Removable when:* same condition as Block B — all 4 sentinels replaced by real IDs.

---

### Block E — Obed Vargas removal

**Dev:** `SELECT id, slug FROM players WHERE slug='obed-vargas'` → 0 rows ✅  
**Prod:** 0 rows ✅

**Can it recur?** No. `runCommitmentSweep()` (`commitmentTracker.ts:44–46`) explicitly never inserts into `players` and skips `CAP_TIED_OTHER` status rows. The player discovery pipeline adds *candidates* only; promotion to `players` requires manual operator action. An operator would have to deliberately re-promote him for the row to reappear.

---

### Block F — Phantom CONCACAF Nations League cleanup

**Dev:** query for NULL-id USA vs Jamaica/T&T CNL fixtures → 0 rows ✅  
**Prod:** 0 rows ✅

**Can it recur?** No. `syncNationalTeamFixtures()` (`apiFootballSync.ts:1662–1710`) only *updates* existing seeded USA rows — it never inserts new ones. No sync path produces NULL-id senior CONCACAF Nations League rows. `purgePhantomNtFixtures()` (1597–1645) is an additional backstop for any that appeared with real IDs.

---

### Block G — `is_national_team` flag backfill

**Dev:** `SELECT COUNT(*) … WHERE is_national_team=false AND (home_team='USA' OR …)` → 0 ✅  
**Prod:** 0 ✅

**Can it recur?** No. The "upsert path is now fixed" claim in the comment is verified: `apiFootballSync.ts:1434–1440` sets `isNationalTeam: true` when either participant matches `isUsMensNationalTeamName()`. New fixtures arrive correctly flagged.

---

### Block H — Fox One streaming backfill

**Dev:** `SELECT COUNT(*) … WHERE competition='CONCACAF U20' AND streaming_service != 'Fox One'` → 0 ✅  
**Prod:** 0 ✅

**Can it recur?** No. `BROADCAST_BY_LEAGUE` at `apiFootballSync.ts:183` maps `'CONCACAF U20' → { tvNetwork:'FOX Sports', streamingService:'Fox One' }`. All 3 CONCACAF U20 fixtures are `finished`; new fixtures inserted by `syncYouthNtFixtures()` receive the value at insert time.

---

### Block I — FIFA+ streaming backfill

**Dev:** `SELECT COUNT(*) … WHERE competition='World Cup - U17' AND streaming_service != 'FIFA+'` → 0 ✅  
**Prod:** 0 ✅

**Can it recur?** No. `BROADCAST_BY_LEAGUE` at `apiFootballSync.ts:187` maps `'World Cup - U17' → { streamingService:'FIFA+' }`. New fixtures from `syncYouthNtFixtures()` receive the value at insert time.

---

### Block J — Six youth fixtures seed (Step 4)

**Dev:** 3 of 6 present — only CONCACAF U20 rows (1544720, 1544726, 1544732); U17 World Cup 2026 fixtures (1546162, 1546181, 1546185) absent ⚠️  
**Prod:** all 6 present ✅

**Does the sync create these automatically?** Yes. `syncYouthNtFixtures()` (`apiFootballSync.ts:1973+`) fetches current and prior-year fixtures for each US youth NT team and inserts them with `isNationalTeam: true`. Dev already has CONCACAF U20 fixture 1610882 (Guatemala) and 7 U17 World Cup rows from prior cycles — all from sync. The 3 U17 World Cup 2026 fixtures are absent from dev because the tournament has not started (Nov 2026) and API-Football has not returned them for the current sync window yet.

**Bootstrap gap if block is deleted:** a freshly rebuilt database would be missing the 3 future U17 fixtures until the first sync run.

**Recommendation:** Delete Block J from `index.ts` and create a standalone `scripts/src/seedYouthNtFixtures.ts` using `ON CONFLICT (api_football_fixture_id) DO NOTHING` — no TRUNCATE. Document it in `lib/db/README.md` as the bootstrap step for a fresh environment. `scripts/src/seedUsmnt.ts` must NOT be used as a template (it opens with `TRUNCATE … RESTART IDENTITY CASCADE`). Do not implement in this task.

---

## Step 3 — Classification summary

| Block | Verdict | One-line reason |
|---|---|---|
| A | **DELETED** | Taken effect both; schedule_events is hand-curated |
| B | **KEPT** | Active duty — future matches, sentinels are live data |
| C | **KEPT** | Recurring by design |
| D | **KEPT** | Active duty — only thing that promotes sentinels to real IDs |
| E | **DELETED** | Taken effect both; commitment tracker can never re-add |
| F | **DELETED** | Taken effect both; sync path confirmed insert-free for this case |
| G | **DELETED** | Taken effect both; upsert fix confirmed at apiFootballSync.ts:1434–1440 |
| H | **DELETED** | Taken effect both; BROADCAST_BY_LEAGUE confirmed |
| I | **DELETED** | Taken effect both; BROADCAST_BY_LEAGUE confirmed |
| J | **KEPT** (pending Step 4) | Bootstrap gap until dedicated seed script created |

---

## Verification

| Check | Result |
|---|---|
| `pnpm run lint` | ✅ 0 errors (4 pre-existing warnings) |
| `pnpm run typecheck` | ✅ all packages clean |
| `pnpm run build` | ✅ |
| `pnpm --filter @workspace/api-server run test` | ✅ 84 files, 712 tests |
| `pnpm --filter @workspace/usmnt-tracker run test` | ✅ 11 files, 212 tests |

Four now-unused imports removed from `index.ts`: `playerStatsTable`, `injuriesTable`, `transfersTable`, `playersTable`.
