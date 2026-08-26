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

/**
 * True when a league name looks like a national-team competition (as opposed
 * to a club league). This is the single source of truth for that check —
 * `playerDiscovery.ts` used to duplicate this logic in a second, subtly
 * different `looksLikeNationalTeamCompetition`/`NATIONAL_TEAM_RE` pair; that
 * copy has been deleted and callers there now import this one.
 */
export function isNationalTeamComp(leagueName: string): boolean {
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
 *  excluded — they do not constitute a senior commitment.
 *
 *  Exported as the single source of truth: `playerDiscovery.ts` used to have
 *  its own copy (`hasSeniorNonUsCaps`) that did not exclude youth caps; that
 *  copy has been deleted and callers there now import this one. */
export function detectSeniorNonUsCaps(statistics: StatBlock[]): boolean {
  return statistics.some(
    (s) =>
      isNationalTeamComp(s.league.name) &&
      !US_TEAM_NAMES.has(s.team.name) &&
      !US_YOUTH_RE.test(s.team.name) &&
      !ANY_YOUTH_NT_RE.test(s.team.name) &&
      (s.games.lineups ?? 0) > 0,
  );
}

/**
 * Counts national-team appearances (any country) split into senior vs youth
 * buckets, based on lineup appearances in national-team competitions.
 * Used by `playerDiscovery.ts` to populate `priorNationalTeamCaps` (senior
 * only) and `priorYouthNtCaps` (youth only) as two separate counters instead
 * of folding youth caps into the "senior" total.
 */
export function countNationalTeamCaps(statistics: StatBlock[]): {
  seniorCaps: number;
  youthCaps: number;
} {
  let seniorCaps = 0;
  let youthCaps = 0;
  for (const s of statistics) {
    if (!isNationalTeamComp(s.league.name)) continue;
    const lineups = s.games.lineups ?? 0;
    if (lineups <= 0) continue;
    if (ANY_YOUTH_NT_RE.test(s.team.name)) {
      youthCaps += lineups;
    } else {
      seniorCaps += lineups;
    }
  }
  return { seniorCaps, youthCaps };
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

/** Matches "USA", "U.S.A.", "United States[ of America]", "America" as a
 *  whole comma-segment — used to recognize a trailing country name. */
const US_COUNTRY_INDICATOR_RE = /^(usa|u\.s\.a\.?|united states( of america)?|america)$/i;

function isUsCountryIndicatorSegment(segment: string): boolean {
  return US_COUNTRY_INDICATOR_RE.test(segment.trim());
}

// Precompiled word-boundary regexes for full state names, built once at
// module load rather than per call.
const US_STATE_NAME_PATTERNS = [...US_STATES].map(
  (state) => ({ state, re: new RegExp(`\\b${state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i") }),
);

/**
 * Detects whether free-text birthplace evidence points to a US state.
 *
 * Rewritten to close three false-positive classes that previously fired on
 * non-English place names:
 *   - "Rio de Janeiro" → "de" is not accepted as the Delaware abbreviation
 *     unless it is the final comma-segment (or immediately precedes a
 *     trailing country name) AND was uppercase in the original string.
 *   - "La Plata" / "La Paz" → same positional + case rule rules out "La".
 *   - "Al Rayyan" → same rule rules out "Al".
 *   - "Tbilisi, Georgia" → "Georgia" is ambiguous between the US state and
 *     the country, so it only counts as the US state when the string itself
 *     carries independent US evidence (a trailing "USA"/"United States"
 *     segment) or the candidate's confirmed birth country is the USA.
 *
 * `birthCountry` (API-Football's `birth.country`) is only used to help
 * disambiguate the "Georgia" special case above — it is not a blanket gate
 * on the whole signal, since free-text birthplace is independent evidence
 * that can legitimately fire even when `birthCountry` is unset or disagrees
 * (e.g. a player whose recorded nationality/birth country reflects heritage
 * rather than birthplace).
 */
function detectUsStateBirthplace(birthplace: string, birthCountry: string | null): boolean {
  const segments = birthplace
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) return false;

  const last = segments[segments.length - 1]!;
  const hasTrailingCountry = isUsCountryIndicatorSegment(last);
  // The segment eligible for a two-letter abbreviation match: the final
  // segment, or — when the final segment is itself a trailing country name
  // like "USA" — the segment immediately before it.
  const abbrevCandidate = hasTrailingCountry ? (segments[segments.length - 2] ?? null) : last;

  if (
    abbrevCandidate != null &&
    abbrevCandidate.length === 2 &&
    abbrevCandidate === abbrevCandidate.toUpperCase() &&
    US_STATE_ABBREVS.has(abbrevCandidate)
  ) {
    return true;
  }

  const hasUsIndicator =
    hasTrailingCountry ||
    segments.some((seg) => isUsCountryIndicatorSegment(seg)) ||
    birthCountry === "USA" ||
    birthCountry === "United States";

  for (const { state, re } of US_STATE_NAME_PATTERNS) {
    if (!re.test(birthplace)) continue;
    if (state === "Georgia" && !hasUsIndicator) {
      // Ambiguous with the country of Georgia — needs corroborating US
      // evidence before it counts as the US state.
      continue;
    }
    return true;
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
          fires = detectUsStateBirthplace(profile.birthplace, profile.birthCountry);
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
