---
name: Prospect quality score design
description: Design decisions behind the USMNT Tracker's prospect quality score (separate from eligibility confidence) — coefficient keying, formula shape, and seeding contract.
---

- Quality score answers "is he worth attention"; eligibility confidence answers "can he play for the US". Kept fully independent modules (`qualityScore.ts` vs `evaluateEligibility.ts`) — never share a number, never import from each other.
- League strength must key on API-Football's numeric `league.id`, never league name — the same league is spelled inconsistently elsewhere in this codebase (e.g. `clubs.league` holds both "MLS" and "Major League Soccer"). Verify ids live via `/leagues?search=`, never guess.
- `league_strength` seeding is insert-if-missing only (query existing ids, insert only the missing defaults) — never `onConflictDoUpdate`/upsert — so a hand-tuned coefficient always survives a restart. Verified via a live restart: second boot logged `inserted: 0, skipped: 21`.
- Formula: `quality = leagueStrength × ageMultiplier × performance` (raw range 0–2, scaled ×50 to get 0–100). Multiplicative on purpose so a strong league gates rather than just adds.
- Performance subtotal saturates minutes via `sqrt(minutes)/sqrt(3000)` (makes the 200→900 min gap matter far more than 2400→3100) and drops rating from the weighted mix entirely (not zeroing it) below a ~300-minute floor, redistributing its weight to minutes/starts.
- Quality scoring must be wrapped in try/catch at every call site inside `playerDiscovery.ts` (discovery insert, onConflictDoUpdate, rescoreAllCandidates) — a scoring failure (e.g. DB blip loading `league_strength`) must leave the candidate merely unscored (`qualityScore: null`), never abort eligibility discovery/rescoring, which runs in the same pass.
- A dry run over real production candidates surfaced cup competitions (DFB Pokal, Coppa Italia) and secondary competitions (NWSL Women, Leagues Cup) as unclassified/high-minutes primary-league picks — worth revisiting `selectPrimaryLeagueBlock`'s exclusion list beyond just friendlies/NT comps.
- Admin (`/admin/*`) endpoints are entirely absent from `lib/api-spec/openapi.yaml`/codegen — that pipeline only covers the public API. Don't add a single admin endpoint to the spec without also deciding the broader convention; flagged as a follow-up rather than done ad hoc.
