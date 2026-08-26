// ---------------------------------------------------------------------------
// Version-controlled defaults for `league_strength`, seeded on server
// startup (see `seedLeagueStrengthDefaults` in `qualityScore.ts`) —
// insert-if-missing only. A hand-tuned coefficient in the DB must never be
// overwritten by a restart.
//
// Keyed on API-Football's numeric league id (verified live against
// `/leagues?search=` on 2026-08-26 — not guessed). Ids used:
//
//   Premier League (England)        39
//   La Liga (Spain)                140
//   Bundesliga (Germany)            78
//   Serie A (Italy)                135
//   Ligue 1 (France)                61
//   Eredivisie (Netherlands)        88
//   Primeira Liga (Portugal)        94
//   Championship (England)          40
//   Jupiler Pro League (Belgium)   144
//   Bundesliga (Austria)           218
//   Super League (Switzerland)     207
//   Superliga (Denmark)            119
//   2. Bundesliga (Germany)         79
//   Serie B (Italy)                136
//   Ligue 2 (France)                62
//   Segunda División (Spain)       141
//   Liga MX (Mexico)               262
//   Major League Soccer (USA)      253
//   USL Championship (USA)         255
//   MLS Next Pro (USA)             909
//   USL League One (USA)           489
// ---------------------------------------------------------------------------

export interface LeagueStrengthDefault {
  apiFootballLeagueId: number;
  name: string;
  coefficient: number;
}

/** Coefficient applied to any league id not present in `league_strength` —
 *  the MLS Next Pro level. Never zero: an unclassified league should not
 *  bury a player, it should surface with a visible warning instead (see
 *  `resolveLeagueCoefficient` in `qualityScore.ts`). */
export const UNKNOWN_LEAGUE_COEFFICIENT = 0.25;

export const LEAGUE_STRENGTH_DEFAULTS: LeagueStrengthDefault[] = [
  // Tier 1 — top five European leagues
  { apiFootballLeagueId: 39, name: "Premier League", coefficient: 1.0 },
  { apiFootballLeagueId: 140, name: "La Liga", coefficient: 1.0 },
  { apiFootballLeagueId: 78, name: "Bundesliga", coefficient: 1.0 },
  { apiFootballLeagueId: 135, name: "Serie A", coefficient: 1.0 },
  { apiFootballLeagueId: 61, name: "Ligue 1", coefficient: 1.0 },

  // Tier 2
  { apiFootballLeagueId: 88, name: "Eredivisie", coefficient: 0.75 },
  { apiFootballLeagueId: 94, name: "Primeira Liga", coefficient: 0.75 },
  { apiFootballLeagueId: 40, name: "Championship", coefficient: 0.75 },

  // Tier 3
  { apiFootballLeagueId: 144, name: "Jupiler Pro League", coefficient: 0.65 },
  { apiFootballLeagueId: 218, name: "Bundesliga (Austria)", coefficient: 0.65 },
  { apiFootballLeagueId: 207, name: "Super League (Switzerland)", coefficient: 0.65 },
  { apiFootballLeagueId: 119, name: "Superliga (Denmark)", coefficient: 0.65 },

  // Tier 4
  { apiFootballLeagueId: 79, name: "2. Bundesliga", coefficient: 0.6 },
  { apiFootballLeagueId: 136, name: "Serie B", coefficient: 0.6 },
  { apiFootballLeagueId: 62, name: "Ligue 2", coefficient: 0.6 },
  { apiFootballLeagueId: 141, name: "La Liga 2 (Segunda División)", coefficient: 0.6 },
  { apiFootballLeagueId: 262, name: "Liga MX", coefficient: 0.6 },

  // Tier 5 — MLS
  { apiFootballLeagueId: 253, name: "Major League Soccer", coefficient: 0.55 },

  // Tier 6 — US second/third division
  { apiFootballLeagueId: 255, name: "USL Championship", coefficient: 0.3 },
  { apiFootballLeagueId: 909, name: "MLS Next Pro", coefficient: 0.25 },
  { apiFootballLeagueId: 489, name: "USL League One", coefficient: 0.25 },
];
