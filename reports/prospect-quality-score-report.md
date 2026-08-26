# Prospect Quality Score — Implementation & Dry-Run Report

**Date:** August 26, 2026
**Scope:** USMNT Tracker admin review queue

## Summary

Added a prospect **quality score** (0–100) to the candidate pipeline, fully separate from the existing eligibility confidence score. Quality score answers "is this player worth attention"; eligibility confidence still answers "can he play for the US." Eligibility scoring, weights, `ELIGIBILITY_MIN_SCORE`, `DUAL_NATIONAL` logic, age-gate dismissal, and discovery scope were not touched.

## Formula

```
quality = leagueStrength × ageMultiplier × performance   (raw range 0–2)
score   = round(quality / 2 × 100), clamped 0–100
```

- **League strength** — a coefficient (1.00 → 0.25) keyed on API-Football's numeric `league.id`, never on league name strings (names are spelled inconsistently across the data). Seeded from a version-controlled defaults table on server startup, **insert-if-missing only** — a hand-tuned coefficient in the database always survives a restart/reseed. Unknown leagues default to 0.25 and log a warning naming the league so it can be classified.
- **Age multiplier** — 2.0 at age ≤16, decreasing to 0.9 at age ≥23 (clamped at both ends; neutral 1.0 if age is unknown).
- **Performance** — a weighted blend of:
  - saturating minutes (`sqrt(minutes)/sqrt(3000)`, so the jump from 200→900 minutes matters far more than 2400→3100)
  - starts-to-appearances ratio
  - average rating — **only** counted once a player has ≥300 minutes in the season; below that floor its weight is redistributed to minutes/starts rather than penalizing small samples with a noisy rating.

Score inputs (league id, league name, coefficient, age multiplier, performance subtotal, minutes) are persisted per-candidate for future retuning transparency.

## Where it shows up

- `player_candidates.quality_score`, `.quality_scored_at`, `.quality_score_inputs` — computed at discovery insert, on every re-sync upsert, and in the periodic full rescore pass.
- `GET /admin/review-queue` now returns the score alongside eligibility confidence.
- The admin Review Queue UI shows a quality score bar next to the existing eligibility confidence bar (league, coefficient, age multiplier, and minutes are shown for transparency), and now **defaults to sorting by quality score, descending** (eligibility confidence remains visible but no longer drives the default order).

## Verification performed

- `pnpm run typecheck` — clean across all workspace projects
- `pnpm run lint` — 0 errors
- `pnpm --filter @workspace/api-server run test` — **795/795 passing** (100 test files), including 8 new scenarios specific to quality scoring (age-vs-league ranking, unknown-league fallback + warning, rating-ignored-below-300-minutes, hand-tuned coefficient survives reseed, age-multiplier boundaries, primary-league selection excludes friendlies/national-team competitions)
- `scripts/check-codegen-drift.sh` — clean, no OpenAPI/codegen drift
- Confirmed live on server restart: league strength seeding logged `inserted: 0, skipped: 21` on the second boot, proving hand-tuned coefficients aren't clobbered by reseeding
- Quality scoring is wrapped in try/catch at every call site so a scoring failure (e.g. a transient DB hiccup) never blocks eligibility discovery or rescoring — the candidate is simply left unscored (`null`) until the next pass

## Read-only dry run (no database writes)

Ran the scorer across all **111** pending/needs-review candidates using their live API-Football stats, without persisting any results. **111 scored, 0 failures.**

### Top 20 by quality score

| Rank | Score | Age | Name | Club | League | Coefficient | Minutes |
|---|---|---|---|---|---|---|---|
| 1 | 29 | 18 | C. Sanchez | Atlanta United | Major League Soccer | 0.55 | 1422 |
| 2 | 28 | 19 | D. Ferree | San Diego FC | Major League Soccer | 0.55 | 1375 |
| 3 | 27 | 19 | S. Brunell | Seattle Sounders FC | Major League Soccer | 0.55 | 1640 |
| 4 | 27 | 20 | M. Corcoran | United States U20 | Major League Soccer | 0.55 | 1969 |
| 5 | 26 | 20 | J. Badwal | Vancouver Whitecaps | Major League Soccer | 0.55 | 1615 |
| 6 | 25 | 19 | Harbor Miller | LA Galaxy | Major League Soccer | 0.55 | 1310 |
| 7 | 25 | 26 | J. David | Juventus | Serie A | 1.00 | 428 |
| 8 | 24 | 21 | T. Johnson | Vancouver Whitecaps | Major League Soccer | 0.55 | 2019 |
| 9 | 23 | 20 | O. Verhoeven | San Diego FC | Major League Soccer | 0.55 | 1568 |
| 10 | 21 | 21 | G. Valenzuela | FC Cincinnati | Major League Soccer | 0.55 | 1517 |
| 11 | 21 | 29 | N. Tafari | Los Angeles FC | Major League Soccer | 0.55 | 2457 |
| 12 | 21 | 31 | M. Delgado | Los Angeles FC | Major League Soccer | 0.55 | 2357 |
| 13 | 21 | 21 | N. Norris | United States U20 | Major League Soccer | 0.55 | 1581 |
| 14 | 21 | 22 | R. Roberts | San Jose Earthquakes | Major League Soccer | 0.55 | 1641 |
| 15 | 20 | 22 | Beau Leroux | San Jose Earthquakes | Major League Soccer | 0.55 | 1477 |
| 16 | 20 | 29 | J. Marcinkowski | LA Galaxy | Major League Soccer | 0.55 | 2060 |
| 17 | 20 | 21 | R. Baker-Whiting | United States U20 | Major League Soccer | 0.55 | 1308 |
| 18 | 20 | 19 | S. Hawkins | Seattle Sounders FC | Major League Soccer | 0.55 | 577 |
| 19 | 19 | 20 | J. Bartlett | Sporting Kansas City | Major League Soccer | 0.55 | 940 |
| 20 | 19 | 31 | E. Horvath | New York Red Bulls | Major League Soccer | 0.55 | 1912 |

**Reading the ranking:** young players (18–22) with heavy, undiluted minutes in MLS dominate the top of the list — exactly the profile the formula is meant to surface. The one outlier, a 26-year-old Juventus player, ranks highly on the strength of Serie A's top coefficient despite a small 428-minute sample, which is a reasonable trade-off given the formula's design but worth an eye if it recurs often.

During the dry run, four competitions were logged as **unclassified** (defaulted to the 0.25 fallback coefficient): DFB Pokal, Coppa Italia, NWSL Women, and Leagues Cup. This has been filed as a follow-up task (#666) to add real coefficients for them and reconsider whether cup competitions should ever be picked as a candidate's "primary" league.

## Known follow-ups (filed as project tasks)

- **#666** — Classify additional leagues/cup competitions seen in production data and consider excluding cup runs from "primary league" selection.
- **#667** — Decide whether `/admin/review-queue` (and admin endpoints generally) should join the OpenAPI/codegen contract, or formally document that admin endpoints are intentionally excluded.
