# Investigation: `detectSeniorNonUsCaps` False-Positive DUAL_NATIONAL Flags

**Status:** Report only — no code changes made.
**Scope:** Verifying the hypothesis that club competitions (CONCACAF Champions
League, FIFA Club World Cup) are being misread as national-team appearances.

## Hypothesis

`detectSeniorNonUsCaps` in `evaluateEligibility.ts` matches on competition
*name* only. Club competitions whose names contain matched keywords —
"CONCACAF Champions League," "FIFA Club World Cup" — get counted as
national-team appearances, with the player's *club* standing in for a
country. This was flagging capped USMNT internationals (Paul Arriola, Jordan
Morris, and others) as `DUAL_NATIONAL` in production — 53 candidates affected.

**Confirmed.**

## Evidence

Pulled live API-Football profiles for four candidates and inspected every
stat block `detectSeniorNonUsCaps` evaluates (league name, team name,
`league.country`, lineups).

### Candidate 26 — P. Arriola (api_football_id 50772)

| League | Team | league.country | lineups |
|---|---|---|---|
| CONCACAF Champions League | Seattle Sounders | World | 4 |

Fires as a "non-US senior cap" — Seattle Sounders is his MLS club, not a
country.

### Candidate 29 — J. Morris (api_football_id 51118)

| League | Team | league.country | lineups |
|---|---|---|---|
| CONCACAF Champions League | Seattle Sounders | World | 4 |

Same pattern. His real 2023 "CONCACAF Gold Cup" appearance is correctly
excluded, since `team.name` there is `"USA"`.

### Candidate 97 — M. Delgado (api_football_id 50814)

> Note: this DB id maps to M. Delgado, not "A. Long" as originally guessed.
> Reporting on the actual record.

| League | Team | league.country | lineups |
|---|---|---|---|
| FIFA Club World Cup | Los Angeles FC | World | 3 |
| CONCACAF Champions League | Los Angeles FC | World | 6 |
| FIFA Club World Cup - Play-In | Los Angeles FC | World | 1 |

Three separate club-competition blocks firing for the same false reason.

### Candidate 1 — J. David (api_football_id 8489) — contrast case, not a bug

| League | Team | league.country | lineups |
|---|---|---|---|
| CONCACAF Nations League | Canada | World | 3 |
| Copa America | Canada | World | 5 |
| CONCACAF Gold Cup | Canada | World | 2 |

These are real Canada senior caps — `team.name` is the actual country. This
shows the detector works correctly when the "team" genuinely is a national
team; the failure is specific to club competitions whose names happen to
contain a matched keyword.

## Root Cause

`NATIONAL_TEAM_RE` matches on substrings like `concacaf` and `world cup`
inside `league.name` alone. It fires identically for "CONCACAF Champions
League," "CONCACAF Gold Cup," "FIFA Club World Cup," and "FIFA Club World Cup
- Play-In" — nothing in the check inspects *who* is actually playing. When
the team on that stat block is a club (Seattle Sounders, LAFC) instead of a
country, `!US_TEAM_NAMES.has(team.name)` is trivially true, so it's misread
as "capped for a country other than the US."

## Can API-Football Reliably Distinguish National Team from Club?

- **`league.country == "World"`** — not reliable. Confirmed `league.country`
  is `"World"` for CONCACAF Champions League, FIFA Club World Cup, Leagues
  Cup, UEFA Champions League, and Friendlies Clubs — essentially every
  international *club* competition, not just national-team ones. This field
  cannot separate the two.
- **`league.type`** — does not exist in this response shape at all. Checked
  the raw JSON for every stat block across all profiles pulled; the `league`
  object only ever contains `id`, `name`, `country`, `logo`, `flag`,
  `season`. No `type` field is present on `/players?id=` responses.
- **`team.id` / `team.name` against a known national-team list** — the one
  field that is actually reliable in the data pulled. Every genuine
  national-team appearance has `team.name` equal to the literal country name
  ("USA" id 2384, "Canada" id 5529), while every false positive has a real
  club name and club `team.id` (Seattle Sounders id 1595, LAFC id 1616, FC
  Dallas id 1597). The code already special-cases this for the US side
  (`US_TEAM_NAMES`) — the general case needs the same treatment.

## Recommendation

Gate national-team detection on **team identity** (a maintained
national-team id/name allowlist, analogous to the existing `US_TEAM_NAMES`
set but covering all countries), rather than league-name keyword matching.
League-name matching should at most be a secondary signal — it cannot be
trusted alone, since club competitions freely reuse words like "CONCACAF"
and "World Cup" in their names.

No fixes have been applied. This report reflects investigation only.
