// ---------------------------------------------------------------------------
// Eligibility signal registry.
//
// Each entry defines:
//   signalType   – machine-readable key, used as the PK component in
//                  `eligibility_signals(signal_type, source)`.
//   label        – human-readable description for UI/logs.
//   defaultWeight – points this signal contributes when it fires.
//   maxContribution – cap on how much this signal can contribute
//                     (usually equal to defaultWeight; can be higher for
//                     signals that scale, e.g. per-cap counts).
//
// At server startup the registry is loaded and each defaultWeight can be
// overridden via a matching environment variable:
//   ELIGIBILITY_WEIGHT_<SIGNAL_TYPE_UPPERCASE>
// e.g. ELIGIBILITY_WEIGHT_US_NATIONALITY=40
// ---------------------------------------------------------------------------

export interface SignalDefinition {
  signalType: string;
  label: string;
  defaultWeight: number;
  maxContribution: number;
}

/** Canonical registry.  Weights sum to 120 so that two strong signals alone
 *  clear the US_ELIGIBLE_PROSPECT threshold (≥60) without needing all of them.
 *
 *  maxContribution is the hard ceiling for a signal's per-firing contribution.
 *  It is intentionally set above defaultWeight so that operators can boost
 *  individual signals via env-var overrides without hitting the cap
 *  (e.g. ELIGIBILITY_WEIGHT_US_BIRTH_COUNTRY=30 is valid). */
export const SIGNAL_REGISTRY: SignalDefinition[] = [
  {
    signalType: "us_nationality",
    label: "US nationality on API-Football profile",
    defaultWeight: 35,
    maxContribution: 50,
  },
  {
    signalType: "us_birth_country",
    label: "Born in the United States (birth.country)",
    defaultWeight: 25,
    maxContribution: 40,
  },
  {
    signalType: "us_state_birthplace",
    label: "Birthplace text matches a US state or US city",
    defaultWeight: 15,
    maxContribution: 25,
  },
  {
    signalType: "us_youth_nt",
    label: "Prior appearance for a US youth national team",
    defaultWeight: 15,
    maxContribution: 25,
  },
  {
    signalType: "us_senior_nt_cap",
    label: "Prior USMNT senior cap (lineups > 0)",
    defaultWeight: 20,
    maxContribution: 35,
  },
  {
    signalType: "mls_usl_league",
    label: "Plays in MLS or USL (soft US-nexus signal)",
    defaultWeight: 10,
    maxContribution: 20,
  },
];

/** Signal weights resolved at module load, with optional env-var overrides. */
export type ResolvedWeights = Record<string, number>;

let _resolvedWeights: ResolvedWeights | null = null;

export function getResolvedWeights(): ResolvedWeights {
  if (_resolvedWeights) return _resolvedWeights;

  const weights: ResolvedWeights = {};
  for (const def of SIGNAL_REGISTRY) {
    const envKey = `ELIGIBILITY_WEIGHT_${def.signalType.toUpperCase()}`;
    const envVal = process.env[envKey];
    if (envVal !== undefined) {
      const parsed = parseInt(envVal, 10);
      weights[def.signalType] =
        Number.isFinite(parsed) && parsed >= 0 ? parsed : def.defaultWeight;
    } else {
      weights[def.signalType] = def.defaultWeight;
    }
  }
  _resolvedWeights = weights;
  return weights;
}

/** Resets the resolved-weights cache so the next call to getResolvedWeights()
 *  recomputes from current env vars.  Exposed for unit tests only — do not
 *  call this in production code. */
export function _resetWeightsCacheForTesting(): void {
  _resolvedWeights = null;
}

/** Min confidence score to store a candidate (default 30, env-overridable). */
export function getMinEligibilityScore(): number {
  const raw = process.env["ELIGIBILITY_MIN_SCORE"];
  if (raw !== undefined) {
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 30;
}

/** Maximum age for a player to be stored as a candidate (default 23, env-overridable via DISCOVERY_MAX_AGE). */
export function getMaxCandidateAge(): number {
  const raw = process.env["DISCOVERY_MAX_AGE"];
  if (raw !== undefined) {
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 23;
}
