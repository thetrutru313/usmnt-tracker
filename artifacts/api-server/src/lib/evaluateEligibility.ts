// ---------------------------------------------------------------------------
// Eligibility scoring engine.
//
// Iterates the signal registry against a candidate's profile data, sums
// weighted contributions (clamped to 100), and returns a structured result
// that can be persisted to `eligibility_signals` and written back to the
// `player_candidates` row.
// ---------------------------------------------------------------------------

import { SIGNAL_REGISTRY, getResolvedWeights } from "./eligibilitySignalsConfig";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Stat block as returned by API-Football /players — re-declared here so
 *  evaluateEligibility is not coupled to the playerDiscovery internals. */
export interface StatBlock {
  team: { id?: number; name: string };
  league: { name: string; season?: number };
  games: {
    lineups: number | null;
    minutes: number | null;
    position?: string | null;
    rating?: string | null;
  };
}

/** All data the scoring engine uses to evaluate a candidate. */
export interface EligibilityProfile {
  /** API-Football nationality string (e.g. "USA", "England"). */
  nationality: string | null;
  /** API-Football birth.country (e.g. "USA", "Germany"). */
  birthCountry: string | null;
  /** Free-text birthplace, e.g. "Los Angeles, California" or "Chicago".
   *  Optional — signal is skipped when absent. */
  birthplace?: string | null;
  /** All stat blocks from the API-Football /players response. */
  statistics: StatBlock[];
}

export interface FiredSignal {
  signalType: string;
  signalValue: string | null;
  weight: number;
  /** Data source identifier stored in eligibility_signals.source. */
  source: string;
}

export type UsmntCandidateStatus =
  | "US_ELIGIBLE_PROSPECT"
  | "DUAL_NATIONAL"
  | "DECLARED_OTHER"
  | "UNKNOWN";

export interface EligibilityResult {
  score: number;
  status: UsmntCandidateStatus;
  signals: FiredSignal[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const NATIONAL_TEAM_RE =
  /world cup|nations league|euro\b|copa am[eé]rica|gold cup|concacaf|olympic|qualification|qualifier|continental championship|africa cup|asian cup|afcon/i;

const FRIENDLY_RE = /friendly|friendlies/i;

function isNationalTeamComp(leagueName: string): boolean {
  return NATIONAL_TEAM_RE.test(leagueName) && !FRIENDLY_RE.test(leagueName);
}

const US_TEAM_NAMES = new Set(["United States", "USA"]);

/** Matches any youth national team name regardless of country, e.g.
 *  "United States U20", "England U21", "Germany U17", "Brasil Sub-20". */
const ANY_YOUTH_NT_RE = /\bu[0-9]{2}\b|sub-[0-9]+|under-[0-9]+/i;

const US_YOUTH_RE =
  /^(united states|usa)\s+u[0-9]+$/i;

/** Detects any non-US *senior* caps (the player has committed to another country).
 *  Youth appearances (U17, U20, U21, etc.) for any country are explicitly
 *  excluded — they do not constitute a senior commitment. */
function detectSeniorNonUsCaps(statistics: StatBlock[]): boolean {
  return statistics.some(
    (s) =>
      isNationalTeamComp(s.league.name) &&
      !US_TEAM_NAMES.has(s.team.name) &&
      !US_YOUTH_RE.test(s.team.name) &&
      !ANY_YOUTH_NT_RE.test(s.team.name) &&
      (s.games.lineups ?? 0) > 0,
  );
}

/** True if the player appeared for a US youth NT (U17, U20, U23…) in any stat block. */
function detectUsYouthNt(statistics: StatBlock[]): boolean {
  return statistics.some(
    (s) =>
      US_YOUTH_RE.test(s.team.name) && (s.games.lineups ?? 0) > 0,
  );
}

/** True if the player appeared for the senior USMNT in any stat block. */
function detectUsSeniorNtCap(statistics: StatBlock[]): boolean {
  return statistics.some(
    (s) =>
      isNationalTeamComp(s.league.name) &&
      US_TEAM_NAMES.has(s.team.name) &&
      (s.games.lineups ?? 0) > 0,
  );
}

/** True if the player's stats include any MLS or USL league season. */
function detectMlsOrUsl(statistics: StatBlock[]): boolean {
  return statistics.some((s) =>
    /\b(mls|major league soccer|usl|united soccer league)\b/i.test(s.league.name),
  );
}

// US states + DC for birthplace matching
const US_STATES = new Set([
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut",
  "Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa",
  "Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan",
  "Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada",
  "New Hampshire","New Jersey","New Mexico","New York","North Carolina",
  "North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island",
  "South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont",
  "Virginia","Washington","West Virginia","Wisconsin","Wyoming",
  "District of Columbia","DC",
]);

const US_STATE_ABBREVS = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
]);

function detectUsStateBirthplace(birthplace: string): boolean {
  // Check if any token in the birthplace string matches a US state name or abbreviation.
  const parts = birthplace.split(/[\s,]+/);
  for (const part of parts) {
    if (US_STATES.has(part) || US_STATE_ABBREVS.has(part.toUpperCase())) {
      return true;
    }
  }
  // Also check multi-word state names (e.g. "New York", "North Carolina")
  for (const state of US_STATES) {
    if (birthplace.toLowerCase().includes(state.toLowerCase())) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main scoring function
// ---------------------------------------------------------------------------

/**
 * Evaluates all configured signals against the candidate's profile data.
 * Returns the computed score (0–100), derived status, and the list of signals
 * that fired.  Weights are loaded from the registry (with optional env-var
 * overrides) at the time of the call.
 */
export function evaluateEligibility(profile: EligibilityProfile): EligibilityResult {
  const weights = getResolvedWeights();
  const firedSignals: FiredSignal[] = [];

  for (const def of SIGNAL_REGISTRY) {
    const weight = weights[def.signalType] ?? def.defaultWeight;
    if (weight === 0) continue; // disabled by config

    let value: string | null = null;
    let fires = false;

    switch (def.signalType) {
      case "us_nationality": {
        const nat = (profile.nationality ?? "").toLowerCase();
        fires = nat === "usa" || nat === "american" || nat === "united states";
        value = fires ? profile.nationality : null;
        break;
      }

      case "us_birth_country":
        fires =
          profile.birthCountry === "USA" ||
          profile.birthCountry === "United States";
        value = fires ? profile.birthCountry : null;
        break;

      case "us_state_birthplace":
        if (profile.birthplace) {
          fires = detectUsStateBirthplace(profile.birthplace);
          value = fires ? profile.birthplace : null;
        }
        break;

      case "us_youth_nt":
        fires = detectUsYouthNt(profile.statistics);
        if (fires) {
          const match = profile.statistics.find(
            (s) => US_YOUTH_RE.test(s.team.name) && (s.games.lineups ?? 0) > 0,
          );
          value = match?.team.name ?? "US Youth NT";
        }
        break;

      case "us_senior_nt_cap":
        fires = detectUsSeniorNtCap(profile.statistics);
        if (fires) {
          const total = profile.statistics
            .filter(
              (s) =>
                isNationalTeamComp(s.league.name) &&
                US_TEAM_NAMES.has(s.team.name),
            )
            .reduce((n, s) => n + (s.games.lineups ?? 0), 0);
          value = String(total);
        }
        break;

      case "mls_usl_league":
        fires = detectMlsOrUsl(profile.statistics);
        if (fires) {
          const match = profile.statistics.find((s) =>
            /\b(mls|major league soccer|usl|united soccer league)\b/i.test(
              s.league.name,
            ),
          );
          value = match?.league.name ?? null;
        }
        break;
    }

    if (fires) {
      firedSignals.push({
        signalType: def.signalType,
        signalValue: value,
        weight: Math.min(weight, def.maxContribution),
        source: "api_football",
      });
    }
  }

  // Sum contributions, clamped to 100
  const rawScore = firedSignals.reduce((n, s) => n + s.weight, 0);
  const score = Math.min(100, rawScore);

  // Determine status
  const hasSeniorNonUs = detectSeniorNonUsCaps(profile.statistics);
  let status: UsmntCandidateStatus;
  if (hasSeniorNonUs) {
    status = "DUAL_NATIONAL";
  } else if (score >= 60) {
    status = "US_ELIGIBLE_PROSPECT";
  } else {
    status = "UNKNOWN";
  }

  return { score, status, signals: firedSignals };
}
