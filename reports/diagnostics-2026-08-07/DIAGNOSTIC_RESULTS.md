# USMNT Tracker — Data Consistency Diagnostics
**Run against:** production (neondb)  
**Schema at commit:** 784fdc6  
**Date:** 8 August 2026  
**All queries:** read-only SELECT — no writes performed

---

## Summary table

| Query | Verdict | Key number |
|---|---|---|
| Q1 — duplicate player_stats | ⚠️ duplicates exist | 64 `season_all` groups, 20 `national_team_cycle` groups |
| Q1b — duplicates that disagree | ✅ none | badge currently correct; bug is latent |
| Q1c — constraint pre-flight | ⚠️ blocked | 84 rows must be cleaned before UNIQUE can land |
| Q2 — transfer vs profile mismatch | ✅ none | |
| Q2b — guard skip reason | ✅ none | |
| Q3 — duplicate transfer rows | ✅ none | |
| Q3b — transfer date source | ✅ all real | 25/25 midnight UTC — zero wall-clock fallback |
| Q4 — Transfer Buzz panel | ⚠️ structurally empty | 25 confirmed, 0 probability_score, 0 rumor rows |
| Q5 — untagged fixtures, why visible | 🔴 44 should NOT be visible | 44 non-NT scheduled fixtures showing without player links |
| Q5b — untagged fixtures on screen | 🔴 confirmed | listed below |
| Q6 — tagged but zero chips | ✅ none | no fully-stale-linked scheduled fixtures |
| Q6b — NULL club_id links | ✅ low | 5 of 908 links (0.6%) permanently immune to purge |
| Q7 — pool-tier badge mismatch | ⚠️ 8 players | list/dashboard shows different tier than profile |
| Q8 — season aggregate split | ⚠️ 8 players | Rankings stats ≠ profile stats (mid-season movers) |
| Q9 — orphaned fixture links | 🔴 8 orphans | 8 links point at deleted players → permanent chipless cards |
| Q10 — dead denormalised columns | ✅ safe to drop | all 76 players: `steady / false` |
| Q11 — admin club overrides | ✅ none active | |
| Q12 — match-log result format | 🔴 all broken | 1,209/1,209 logs use scoreline format → colour coding never fires |
| Q13 — sync freshness | ✅ healthy | fixtures + usmntStats ~29 min ago; others ~18 h ago (normal) |

---

## Q1 — Duplicate `player_stats` rows

```
period_type,duplicate_groups,total_rows_involved,worst_case_copies
season_all,64,162,3
national_team_cycle,20,40,2
```

Duplicates exist for two period types. `season_all` is the most exposed: 64 player-period pairs have more than one row, with a worst case of 3 copies. `national_team_cycle` has 20 groups, worst case 2.

The missing `ORDER BY` at `queries.ts:111` means whichever copy Postgres returns first is used — a non-deterministic pick.

---

## Q1b — Duplicates that disagree on values

**(no rows)**

All duplicate rows hold **identical values** for both `minutes` and `avg_rating`. The badge is currently correct on every page load. The bug is latent — the race is reachable and the fix is still right — but it has not produced a wrong badge in production yet.

---

## Q1c — UNIQUE constraint pre-flight

```
rows_that_would_block_the_constraint
84
```

**84 rows** across those duplicate groups would cause `CREATE UNIQUE INDEX` to fail immediately. The duplicates must be deduplicated (keeping the newest row per `(player_id, period_type)`) before the constraint can be added. The operation is straightforward but must happen first.

---

## Q2 — Transfer page vs profile club mismatch

**(no rows)**

Every player's `transfers.to_club` text matches their `clubs.name` via `players.club_id`. No player is currently showing a different club on the Transfers page than on their profile. The structural risk documented in the audit (the guard's three silent skip paths) is real, but has not produced a visible mismatch in the live data.

---

## Q2b — Guard skip reason

**(no rows)**

Consistent with Q2 — no mismatches means no guard firings to diagnose.

---

## Q3 — Duplicate transfer rows

**(no rows)**

No player has more than one transfer row for the same `(player_id, from_club, to_club)` combination. The null-date daily-duplicate mechanism has not fired in production. All 25 transfers are distinct moves.

---

## Q3b — Transfer date source

```
total_transfers,midnight_utc_likely_real_api_date,non_midnight_likely_wallclock_fallback
25,25,0
```

All 25 transfer rows carry midnight-UTC timestamps — real API dates. The `new Date()` wall-clock fallback (which would produce a new row every day for the same move) has never triggered. The dedup key `(player_id, announced_at)` is safe in the current dataset.

---

## Q4 — Transfer Buzz panel

```
status,rows,with_probability_score
confirmed,25,0
```

The Transfer Buzz panel (`rankings.ts:124`) filters `status = 'rumor'`. There are **zero rumor rows**. The panel has always been empty. Additionally, `probability_score` is `NULL` on all 25 confirmed rows — the writer never sets it. The panel needs either a writer (rumor ingestion) or to be removed.

---

## Q5 — Untagged fixtures: why visible

```
why_visible,status,fixtures,earliest,latest
future non-NT - should NOT be visible,scheduled,44,2026-08-08 19:00:00+00,2026-09-04 23:00:00+00
NT flag - unconditional bypass (by design),finished,30,2025-02-11 01:00:00+00,2026-08-07 21:00:00+00
NT flag - unconditional bypass (by design),scheduled,8,2026-08-09 23:00:00+00,2026-11-25 15:00:00+00
```

**44 non-NT scheduled fixtures are currently visible on the Fixtures page without any player links.** These are upcoming real club fixtures (Eredivisie, MLS, Championship, Leagues Cup, Bundesliga, etc.) whose player tags have been lost. A user seeing these fixtures sees a card with no players and no streaming information.

The 30 finished NT fixtures and 8 scheduled NT fixtures are present by design (`is_national_team = true` unconditionally bypasses the link requirement).

---

## Q5b — Untagged fixtures currently on screen (selected rows)

Non-NT fixtures that should not be visible (44 total, sample):

| id | home_team | away_team | competition | kickoff | status |
|---|---|---|---|---|---|
| 103 | AZ Alkmaar | ADO Den Haag | Eredivisie | 2026-08-08 19:00 | scheduled |
| 606 | Barcelona | Nottingham Forest | Friendlies Clubs | 2026-08-08 19:00 | scheduled |
| 688 | Portland Timbers II | Los Angeles FC II | MLS Next Pro | 2026-08-08 20:00 | scheduled |
| 136 | Inter Miami | Monterrey | Leagues Cup | 2026-08-09 00:00 | scheduled |
| 256 | Tigres UANL | Vancouver Whitecaps | Leagues Cup | 2026-08-12 02:00 | scheduled |
| ... | | | | | |

NT fixtures visible by design (scheduled):

| id | home_team | away_team | kickoff | api_football_fixture_id |
|---|---|---|---|---|
| 1507 | United States U20 | Mexico U20 | 2026-08-09 23:00 | 1619051 |
| 1326 | USA | Peru | 2026-09-26 20:30 | -2001 (sentinel) |
| 1327 | USA | Chile | 2026-09-30 00:00 | -2002 (sentinel) |
| 1328 | USA | Mexico | 2026-10-04 02:00 | -2003 (sentinel) |
| 1329 | USA | Canada | 2026-10-07 00:00 | -2004 (sentinel) |
| 750 | United States U17 | Montenegro U17 | 2026-11-19 15:00 | 1546162 |
| 751 | United States U17 | Chile U17 | 2026-11-22 15:00 | 1546181 |
| 752 | Algeria U17 | United States U17 | 2026-11-25 15:00 | 1546185 |

The four Sept/Oct 2026 USMNT friendlies (IDs 1326–1329) still carry negative sentinel IDs — `promoteNtSentinelIds()` has not yet resolved them (correct: the matches have not been played).

---

## Q6 — Tagged fixtures with zero chips (fully stale)

**(no rows)**

No scheduled fixture has all of its player links stale simultaneously. The "fixture shows but no chips" problem from Q5 is explained entirely by Q9 (orphaned links) and Q5 (untagged fixtures) — not by this path.

---

## Q6b — NULL `club_id` in `fixture_players`

```
total_links,null_club_id,pct_null
908,5,0.6
```

5 of 908 link rows (0.6%) have `club_id = NULL`. These are permanently immune to `purgeStaleTransferredPlayerLinks` (which requires `club_id IS NOT NULL AND club_id <> players.club_id`). They are also invisible to the chip filter for the same reason. Low impact at current count.

---

## Q7 — Pool-tier badge mismatch (list vs profile)

```
name,category,world_cup_roster,national_team_caps,list_and_dashboard_show,profile_shows
Bajung Darboe,fringe,false,0,Prospect,In the Mix
Caleb Wiley,fringe,false,3,Prospect,In the Mix
Gaga Slonina,fringe,false,1,Prospect,In the Mix
Josh Sargent,current,false,29,In the Mix,Core Squad
Nimfasha Berchimas,prospect,false,5,In the Mix,Prospect
Paxten Aaronson,fringe,false,4,Prospect,In the Mix
Quinn Sullivan,fringe,false,3,Prospect,In the Mix
Yunus Musah,current,false,47,In the Mix,Core Squad
```

**8 players** show a different tier badge when you click into their profile vs. what the list, dashboard, rankings, and search show.

- **Josh Sargent and Yunus Musah**: list shows "In the Mix" (neither has `world_cup_roster = true`); profile shows "Core Squad" (`category = 'current'`). Both have `world_cup_roster = false` — the list rule is technically correct for the World Cup window, but the profile's `category` was never updated to reflect their current status.
- **Bajung Darboe, Caleb Wiley, Gaga Slonina, Paxten Aaronson, Quinn Sullivan**: list shows "Prospect" (caps < 5, not on World Cup roster); profile shows "In the Mix" (`category = 'fringe'`).
- **Nimfasha Berchimas**: inverse — 5 caps qualifies for "In the Mix" on the list, but `category = 'prospect'` shows "Prospect" on the profile.

The code's own comment predicted Yunus Musah would appear here. All 8 are confirmed.

---

## Q8 — Season aggregate split (Rankings vs profile)

```
name,season,rankings_goals_current_club,profile_goals_all_clubs,rankings_minutes,profile_minutes
Zavier Gozo,2025,0,4,90,2108
Yunus Musah,2025,0,2,119,951
Benjamin Cremaschi,2025,0,1,230,2046
Damion Downs,2025,0,0,395,945
Giovanni Reyna,2025,1,1,594,606
Matai Akinmboni,2024,0,0,0,221
Ruben Ramos Jr.,2025,4,4,718,919
Timothy Weah,2025,3,3,3139,3184
```

8 players where `period_type='season'` (current club only, used by Rankings) and `period_type='season_all'` (all clubs, used by the profile) diverge.

**Zavier Gozo is the most extreme case:** the Rankings show 0 goals / 90 minutes (current club only), while the profile shows 4 goals / 2,108 minutes (all clubs). A user checking Rankings and then the profile sees completely different stats. This is structurally correct behaviour for a mid-season transfer — the numbers measure different things — but there is no label on either screen explaining the difference.

---

## Q9 — Orphaned `fixture_players` links

```
orphan_links_pointing_at_missing_players
8
```

**8 `fixture_players` rows reference player IDs that no longer exist in the `players` table.** Because `fixture_players.player_id` has no foreign key, these rows survive player deletion.

Effect: `EXISTS (SELECT 1 FROM fixture_players fp WHERE fp.fixture_id = f.id)` returns `true` for these fixtures, keeping them visible. But the `INNER JOIN players` in the chip query returns zero rows. Result: fixture cards that are permanently visible with zero chips, with no path to resolution short of manually deleting the orphan rows.

This is a previously unsuspected third cause of chipless fixture cards (distinct from Q5 and Q6).

---

## Q10 — Dead denormalised columns

```
performance_trend,trending,players
steady,f,76
```

All 76 players carry `performance_trend = 'steady'` and `trending = false` — the `NOT NULL DEFAULT` values, never overwritten by any live writer. Both columns are safe to drop. No residue from an older sync that would be lost.

---

## Q11 — Admin club overrides

**(no rows)**

No player currently has `club_override_id IS NOT NULL`. The pin mechanism is not in use. No drift to investigate.

---

## Q12 — Match-log result format

```
total_logs,bare_letter_rows_would_colour_correctly,scoreline_rows_always_render_yellow,empty_result_rows
1209,0,1209,0
```

**Every single match log uses the scoreline format** (`"W 2-1"`, `"L 0-1"`, etc.). `PlayerProfile.tsx:347` compares `match.result === 'W'` — a comparison that can never be true against a scoreline string.

Consequence: **all 1,209 match log rows render in the yellow "draw" colour** regardless of actual outcome. The Win (green) and Loss (red) colours have never displayed in production. This is the highest-priority visual bug confirmed by data.

---

## Q13 — Sync freshness

```
sync_name,last_run_at,age
usmntStats,2026-08-08 18:04:09,00:29:02
fixtures,2026-08-08 18:04:09,00:29:02
playerClub,2026-08-08 00:23:56,18:09:15
nationalTeamCaps,2026-08-08 00:23:56,18:09:15
playerStats,2026-08-08 00:23:56,18:09:15
```

All syncs are healthy relative to their configured intervals. `usmntStats` and `fixtures` ran ~29 minutes before query time (hourly cadence). `playerClub`, `nationalTeamCaps`, and `playerStats` ran ~18 hours ago (daily cadence). No staleness that would explain the disagreements found above — the data is current.

---

## Priority ranking

| Priority | Finding | Impact |
|---|---|---|
| 🔴 High | **Q12** — all 1,209 match logs render yellow | Every player profile shows wrong colours on every match row |
| 🔴 High | **Q5/Q9** — 44 untagged + 8 orphan fixtures visible | Users see empty fixture cards with no player or streaming info |
| ⚠️ Medium | **Q7** — 8 players with split badge | Clicking a player changes their displayed tier |
| ⚠️ Medium | **Q1c** — 84 duplicate rows block the stats UNIQUE constraint | Constraint cannot be added until cleaned; latent non-determinism remains |
| ⚠️ Medium | **Q8** — 8 players with unlabelled stat split | Rankings and profile show different numbers with no explanation |
| ℹ️ Low | **Q4** — Transfer Buzz panel always empty | Feature is present in the UI but has never shown data |
| ℹ️ Low | **Q6b** — 5 NULL club_id links | Permanently unreconcilable but low count |
| ℹ️ Low | **Q10** — dead `performance_trend` / `trending` columns | Schema noise; safe to drop at any time |
